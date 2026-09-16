import type {
  AgsDryRunResponse,
  AgsLineItemPayload,
  AgsScorePayload,
  FinalGradeConfig,
  LmsAssessment,
  LmsOffering,
  LtiConfigStatus,
  StudentFinalGrade,
} from "@/lib/contracts/lms-export"
import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

import {
  assertActiveEnrollment,
  loadOfferingMeta,
  loadOwnedOffering,
  resolveStudentProfile,
  resolveTeacherStaffId,
  type OwnedOffering,
} from "./authz"
import {
  computeFinalGrade,
  resolveMarks,
  type GradeCandidateInput,
  type ResolvedMarks,
} from "./final-grade"
import {
  AGS_LINE_ITEM_CONTENT_TYPE,
  AGS_RESULT_CONTENT_TYPE,
  AGS_SCORE_CONTENT_TYPE,
  buildAgsLineItemPayload,
  buildAgsScorePayload,
  requireLtiAgsConfig,
  validateLtiAgsConfig,
} from "./lti"
import { createDryRunLtiAgsClient, type DryRunLtiAgsClient } from "./lti-client"
import { getActiveLtiRegistration, resolveLtiUserIds } from "./registrations"
import {
  buildOneRosterGradebook,
  lineItemSourcedId,
  serializeOneRosterCsv,
  type OneRosterAssessment,
  type OneRosterGradebook,
  type OneRosterInput,
} from "./oneroster"
import { categoryForAssessment, defaultFinalGradeConfig, validateFinalGradeConfig } from "./weights"

/**
 * DB-backed LMS-export service.
 *
 * This is the only module that reads `Grade`, `Assessment`, `Enrollment`, and
 * `CourseOffering` for export. It never reads `AIGradeSuggestion`: the
 * published-only rule lives entirely in `resolveMarks`, which this service feeds
 * with `Grade.publishedAt`.
 *
 * Every function takes the signed-in `AuthUser` and resolves ownership through
 * `./authz` before reading anything, so a teacher cannot export another
 * teacher's offering and a student only ever sees their own rows.
 */

// ---------------------------------------------------------------------------
// Row shapes (decimals converted to numbers at load)
// ---------------------------------------------------------------------------

type AssessmentRow = {
  id: string
  title: string
  type: string
  dueDate: Date
  maxMarks: number
  updatedAt: Date
}

type StudentRow = {
  id: string
  fullName: string
  registerNumber: string
}

type ModernGradeRow = {
  assessmentId: string
  studentId: string
  points: number
  maxPoints: number
  publishedAt: Date | null
  updatedAt: Date
}

type ExportContext = {
  offering: OwnedOffering
  assessments: AssessmentRow[]
  students: StudentRow[]
  modernByKey: Map<string, ModernGradeRow>
  config: FinalGradeConfig
  generatedAt: string
}

function gradeKey(assessmentId: string, studentId: string): string {
  return `${assessmentId}:${studentId}`
}

function toAssessmentRow(assessment: {
  id: string
  title: string
  type: string
  dueDate: Date
  maxMarks: number
  updatedAt: Date
}): AssessmentRow {
  return {
    id: assessment.id,
    title: assessment.title,
    type: assessment.type,
    dueDate: assessment.dueDate,
    maxMarks: assessment.maxMarks,
    updatedAt: assessment.updatedAt,
  }
}

/**
 * Load every input the export needs for one offering, then validate the weight
 * configuration against the offering's real assessment ids. Throws a 400 on an
 * incoherent configuration *before* any grade is computed.
 */
async function loadExportContext(
  offering: OwnedOffering,
  options: { config?: FinalGradeConfig; studentId?: string } = {},
): Promise<ExportContext> {
  const [assessmentRows, enrollmentRows, modernRows] = await Promise.all([
    prisma.assessment.findMany({
      where: { offeringId: offering.id },
      orderBy: { dueDate: "asc" },
      select: {
        id: true,
        title: true,
        type: true,
        dueDate: true,
        maxMarks: true,
        updatedAt: true,
      },
    }),
    prisma.enrollment.findMany({
      where: {
        offeringId: offering.id,
        status: "active",
        ...(options.studentId ? { studentId: options.studentId } : {}),
      },
      orderBy: { student: { registerNumber: "asc" } },
      select: { student: { select: { id: true, fullName: true, registerNumber: true } } },
    }),
    prisma.grade.findMany({
      where: { assessment: { offeringId: offering.id } },
      select: {
        assessmentId: true,
        studentId: true,
        points: true,
        maxPoints: true,
        publishedAt: true,
        updatedAt: true,
      },
    }),
  ])

  const assessments = assessmentRows.map(toAssessmentRow)
  const modernByKey = new Map<string, ModernGradeRow>()
  for (const row of modernRows) {
    modernByKey.set(gradeKey(row.assessmentId, row.studentId), {
      assessmentId: row.assessmentId,
      studentId: row.studentId,
      points: Number(row.points),
      maxPoints: Number(row.maxPoints),
      publishedAt: row.publishedAt,
      updatedAt: row.updatedAt,
    })
  }

  const config = options.config ?? defaultFinalGradeConfig(assessments)
  validateFinalGradeConfig(config, { knownAssessmentIds: assessments.map((a) => a.id) })

  return {
    offering,
    assessments,
    students: enrollmentRows.map((row) => row.student),
    modernByKey,
    config,
    generatedAt: new Date().toISOString(),
  }
}

function buildStudentFinalGrade(context: ExportContext, student: StudentRow): StudentFinalGrade {
  const titleById = new Map(context.assessments.map((a) => [a.id, a.title]))
  const candidates: GradeCandidateInput[] = context.assessments.map((assessment) => ({
    assessmentId: assessment.id,
    modern: context.modernByKey.get(gradeKey(assessment.id, student.id)) ?? null,
  }))

  const resolved: ResolvedMarks = resolveMarks(candidates)
  const computation = computeFinalGrade(context.config, resolved)

  return {
    studentId: student.id,
    fullName: student.fullName,
    registerNumber: student.registerNumber,
    percentage: computation.percentage,
    completedWeight: computation.completedWeight,
    totalWeight: computation.totalWeight,
    incomplete: computation.incomplete,
    categories: computation.categories,
    marks: resolved.marks.map((mark) => ({
      assessmentId: mark.assessmentId,
      assessmentTitle: titleById.get(mark.assessmentId) ?? mark.assessmentId,
      points: mark.points,
      maxPoints: mark.maxPoints,
      percentage: mark.percentage,
      origin: mark.origin,
      publishedAt: mark.publishedAt,
    })),
    excludedUnpublishedAssessmentIds: resolved.excludedUnpublishedAssessmentIds,
  }
}

function toLmsOffering(offering: OwnedOffering): LmsOffering {
  return {
    id: offering.id,
    courseCode: offering.courseCode,
    courseName: offering.courseName,
    className: offering.className,
    term: offering.term,
    academicYear: offering.academicYear,
  }
}

function toLmsAssessments(context: ExportContext): LmsAssessment[] {
  return context.assessments.map((assessment) => ({
    id: assessment.id,
    title: assessment.title,
    type: assessment.type,
    dueDate: assessment.dueDate.toISOString(),
    maxMarks: assessment.maxMarks,
    category: categoryForAssessment(context.config, assessment.id)?.name ?? "Uncategorized",
  }))
}

export function ltiConfigStatus(
  env: Record<string, string | undefined> = process.env,
): LtiConfigStatus {
  const status = validateLtiAgsConfig(env)
  if (!status.configured) {
    return { configured: false, missing: status.missing, message: status.message, scopes: [] }
  }
  return {
    configured: true,
    missing: [],
    message: null,
    scopes: status.config.scopes,
  }
}

// ---------------------------------------------------------------------------
// Teacher reads
// ---------------------------------------------------------------------------

/**
 * OneRoster gradebook rows for a whole offering. Only published modern grades
 * appear as results; the weighted final grade is emitted as its own line item.
 */
function buildOneRoster(context: ExportContext, students: StudentFinalGrade[]): OneRosterGradebook {
  const assessments: OneRosterAssessment[] = context.assessments.map((assessment) => ({
    id: assessment.id,
    title: assessment.title,
    dueDate: assessment.dueDate.toISOString(),
    maxMarks: assessment.maxMarks,
    category: categoryForAssessment(context.config, assessment.id)?.name ?? "Uncategorized",
  }))

  const results: OneRosterInput["results"][number][] = []
  const finalGrades: OneRosterInput["finalGrades"][number][] = []

  for (const student of students) {
    for (const mark of student.marks) {
      const key = gradeKey(mark.assessmentId, student.studentId)
      const dateLastModified =
        context.modernByKey.get(key)?.updatedAt.toISOString() ?? context.generatedAt
      results.push({
        assessmentId: mark.assessmentId,
        studentId: student.studentId,
        points: mark.points,
        maxPoints: mark.maxPoints,
        dateLastModified,
        comment: "",
      })
    }
    if (student.percentage !== null) {
      finalGrades.push({
        studentId: student.studentId,
        percentage: student.percentage,
        dateLastModified: context.generatedAt,
      })
    }
  }

  return buildOneRosterGradebook({
    offering: {
      id: context.offering.id,
      courseId: context.offering.courseId,
      courseCode: context.offering.courseCode,
      courseName: context.offering.courseName,
      className: context.offering.className,
    },
    assessments,
    students: context.students.map((student) => ({
      id: student.id,
      fullName: student.fullName,
      registerNumber: student.registerNumber,
    })),
    results,
    finalGrades,
    lastModified: context.generatedAt,
  })
}

export type TeacherGradeExport = {
  offering: LmsOffering
  config: FinalGradeConfig
  assessments: LmsAssessment[]
  students: StudentFinalGrade[]
  lti: LtiConfigStatus
  generatedAt: string
}

export async function getTeacherGradeExport(
  user: AuthUser,
  options: { offeringId: string; config?: FinalGradeConfig },
): Promise<TeacherGradeExport> {
  const offering = await loadOwnedOffering(user, options.offeringId)
  const context = await loadExportContext(offering, { config: options.config })
  return {
    offering: toLmsOffering(context.offering),
    config: context.config,
    assessments: toLmsAssessments(context),
    students: context.students.map((student) => buildStudentFinalGrade(context, student)),
    lti: ltiConfigStatus(),
    generatedAt: context.generatedAt,
  }
}

export type OneRosterDownload = {
  filename: string
  contentType: string
  csv: string
  generatedAt: string
  rowCount: number
}

function sanitizeFilenamePart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "export"
}

export async function getTeacherOneRosterCsv(
  user: AuthUser,
  options: { offeringId: string; config?: FinalGradeConfig; file: keyof OneRosterGradebook },
): Promise<OneRosterDownload> {
  const offering = await loadOwnedOffering(user, options.offeringId)
  const context = await loadExportContext(offering, { config: options.config })
  const students = context.students.map((student) => buildStudentFinalGrade(context, student))
  const gradebook = buildOneRoster(context, students)
  const csv = serializeOneRosterCsv(options.file, gradebook)
  return {
    filename: `oneroster-${options.file}-${sanitizeFilenamePart(context.offering.courseCode)}-${sanitizeFilenamePart(context.offering.term)}.csv`,
    contentType: "text/csv; charset=utf-8",
    csv,
    generatedAt: context.generatedAt,
    rowCount: gradebook[options.file].length,
  }
}

// ---------------------------------------------------------------------------
// Student reads (own data only)
// ---------------------------------------------------------------------------

export type StudentGradeExport = {
  offering: LmsOffering
  config: FinalGradeConfig
  finalGrade: StudentFinalGrade
  lti: LtiConfigStatus
  generatedAt: string
}

export async function getStudentGradeExport(
  user: AuthUser,
  options: { offeringId: string },
): Promise<StudentGradeExport> {
  const student = await resolveStudentProfile(user)
  await assertActiveEnrollment(student.studentId, options.offeringId)
  const offering = await loadOfferingMeta(options.offeringId)
  const context = await loadExportContext(offering, { studentId: student.studentId })
  return {
    offering: toLmsOffering(context.offering),
    config: context.config,
    finalGrade: buildStudentFinalGrade(context, {
      id: student.studentId,
      fullName: student.fullName,
      registerNumber: student.registerNumber,
    }),
    lti: ltiConfigStatus(),
    generatedAt: context.generatedAt,
  }
}

export async function getStudentOneRosterCsv(
  user: AuthUser,
  options: { offeringId: string; file: keyof OneRosterGradebook },
): Promise<OneRosterDownload> {
  const student = await resolveStudentProfile(user)
  await assertActiveEnrollment(student.studentId, options.offeringId)
  const offering = await loadOfferingMeta(options.offeringId)
  const context = await loadExportContext(offering, { studentId: student.studentId })
  const finalGrade = buildStudentFinalGrade(context, {
    id: student.studentId,
    fullName: student.fullName,
    registerNumber: student.registerNumber,
  })
  const gradebook = buildOneRoster(context, [finalGrade])
  const csv = serializeOneRosterCsv(options.file, gradebook)
  return {
    filename: `oneroster-${options.file}-${sanitizeFilenamePart(student.registerNumber)}.csv`,
    contentType: "text/csv; charset=utf-8",
    csv,
    generatedAt: context.generatedAt,
    rowCount: gradebook[options.file].length,
  }
}

// ---------------------------------------------------------------------------
// LTI 1.3 AGS dry run (never a network call)
// ---------------------------------------------------------------------------

export type AgsDryRunOptions = {
  offeringId: string
  config?: FinalGradeConfig
  ltiUserIds?: Record<string, string>
  env?: Record<string, string | undefined>
  /** Tests can inject any implementation; the default is the in-memory client. */
  client?: DryRunLtiAgsClient
}

/**
 * Build the line items and score payloads a live AGS integration would send,
 * then hand them to the injected client. Only **published** grades produce a
 * score; an unpublished modern grade is reported in `skippedUnpublished` and
 * never sent. The default client is in-memory, so this performs no network I/O.
 */
export async function dryRunAgsPublishForTeacher(
  user: AuthUser,
  options: AgsDryRunOptions,
): Promise<AgsDryRunResponse> {
  const offering = await loadOwnedOffering(user, options.offeringId)
  const env = options.env ?? process.env
  // Throws an actionable 422 when the registration env is incomplete.
  const ltiConfig = requireLtiAgsConfig(env)

  const context = await loadExportContext(offering, { config: options.config })
  const client: DryRunLtiAgsClient = options.client ?? createDryRunLtiAgsClient()

  // A persisted registration is the durable source of the non-secret config
  // (issuer/client/deployment/key id/line-items URL/scopes). The private key is
  // never stored; it is still read from the environment through `privateKeyRef`
  // by `requireLtiAgsConfig` above.
  const registration = await getActiveLtiRegistration()
  const persistedLtiUserIds = await resolveLtiUserIds(context.students.map((student) => student.id))
  const scopes =
    registration && registration.scopes.length > 0 ? registration.scopes : ltiConfig.scopes

  const lineItemPayloads: AgsLineItemPayload[] = []
  const scorePayloads: AgsScorePayload[] = []
  const skippedUnpublished: { assessmentId: string; studentId: string }[] = []

  const lineItemIdByAssessment = new Map<string, string>()
  for (const assessment of context.assessments) {
    const payload = buildAgsLineItemPayload({
      id: assessment.id,
      title: assessment.title,
      type: assessment.type,
      maxMarks: assessment.maxMarks,
      dueDate: assessment.dueDate,
    })
    const record = await client.lineItems.createLineItem(payload)
    lineItemPayloads.push(payload)
    lineItemIdByAssessment.set(assessment.id, record.id)
  }

  for (const assessment of context.assessments) {
    const lineItemId = lineItemIdByAssessment.get(assessment.id)
    if (!lineItemId) continue
    for (const student of context.students) {
      const modern = context.modernByKey.get(gradeKey(assessment.id, student.id))
      if (!modern) continue
      if (modern.publishedAt === null) {
        skippedUnpublished.push({ assessmentId: assessment.id, studentId: student.id })
        continue
      }
      // Explicit request override > persisted LtiUserMapping > internal id.
      const ltiUserId =
        options.ltiUserIds?.[student.id] ?? persistedLtiUserIds.get(student.id) ?? student.id
      const payload = buildAgsScorePayload({
        grade: {
          assessmentId: assessment.id,
          studentId: student.id,
          points: modern.points,
          maxPoints: modern.maxPoints,
          publishedAt: modern.publishedAt,
        },
        ltiUserId,
        timestamp: new Date(context.generatedAt),
        comment: `Assessment "${assessment.title}" (${lineItemSourcedId(assessment.id)}).`,
      })
      await client.scores.putScore(lineItemId, payload)
      scorePayloads.push(payload)
    }
  }

  const log = client.log

  return {
    success: true,
    mode: "dry-run",
    offering: toLmsOffering(context.offering),
    contentTypes: {
      score: AGS_SCORE_CONTENT_TYPE,
      lineItem: AGS_LINE_ITEM_CONTENT_TYPE,
      result: AGS_RESULT_CONTENT_TYPE,
    },
    scopes,
    lineItems: lineItemPayloads,
    scores: scorePayloads,
    skippedUnpublished,
    log: [...log],
    userIdMapping: options.ltiUserIds
      ? "provided"
      : persistedLtiUserIds.size > 0
        ? "persisted"
        : "internal-id-fallback",
    generatedAt: context.generatedAt,
  }
}

/** Offering summaries for the teacher export picker. */
export async function listTeacherExportOfferings(user: AuthUser): Promise<LmsOffering[]> {
  const staffId = await resolveTeacherStaffId(user)
  const offerings = await prisma.courseOffering.findMany({
    where: { teacherId: staffId },
    orderBy: [{ academicYear: "desc" }, { term: "asc" }],
    select: {
      id: true,
      term: true,
      academicYear: true,
      course: { select: { code: true, name: true } },
      classRoom: { select: { name: true, section: true } },
    },
  })
  return offerings.map((offering) => ({
    id: offering.id,
    courseCode: offering.course.code,
    courseName: offering.course.name,
    className: offering.classRoom.section
      ? `${offering.classRoom.name} ${offering.classRoom.section}`
      : offering.classRoom.name,
    term: offering.term,
    academicYear: offering.academicYear,
  }))
}

/** A student's own active enrollments, for the student export picker. */
export async function listStudentExportOfferings(user: AuthUser): Promise<LmsOffering[]> {
  const student = await resolveStudentProfile(user)
  const enrollments = await prisma.enrollment.findMany({
    where: { studentId: student.studentId, status: "active" },
    orderBy: { offering: { academicYear: "desc" } },
    select: {
      offering: {
        select: {
          id: true,
          term: true,
          academicYear: true,
          course: { select: { code: true, name: true } },
          classRoom: { select: { name: true, section: true } },
        },
      },
    },
  })
  return enrollments.map(({ offering }) => ({
    id: offering.id,
    courseCode: offering.course.code,
    courseName: offering.course.name,
    className: offering.classRoom.section
      ? `${offering.classRoom.name} ${offering.classRoom.section}`
      : offering.classRoom.name,
    term: offering.term,
    academicYear: offering.academicYear,
  }))
}
