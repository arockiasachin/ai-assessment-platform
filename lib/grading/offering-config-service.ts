import "server-only"

import type {
  GradingAssessmentOption,
  OfferingCatEligibilityRow,
  OfferingGradingConfigValue,
  OfferingGradingResponse,
} from "@/lib/contracts/courses"
import type { AssessmentType } from "@/lib/generated/prisma/client"
import { writeAuditLog } from "@/lib/grading/audit"
import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

import { resolveMarks, type GradeCandidateInput } from "@/lib/lms-export/final-grade"

import {
  derivedGradingMembership,
  resolveGradingPolicy,
  type StoredGradingConfig,
} from "./offering-config"
import { buildCatEligibility, type EligibilityStudent } from "./offering-eligibility"

/**
 * Read and write an offering's grading policy.
 *
 * ## Authorization
 *
 * A teacher owns *offerings*, so the rule is the offering's `teacherId` matching the caller's
 * staff profile. An offering the caller does not teach reports `not-found` rather than `403`,
 * so the endpoint never confirms that another teacher's offering exists — the same convention
 * `setCourseCategoryForTeacher` and the assessment release action use.
 *
 * ## Why the final-assessment id is validated on write but tolerated on read
 *
 * The asymmetry is deliberate and is the interesting part of this module.
 *
 * - **On write, an id that is not one of this offering's assessments is rejected.** Without
 *   that check a caller could name another offering's assessment as this course's final one,
 *   and the weighted total would silently include a mark that belongs to a different class.
 *   It is a client error and it should be reported as one.
 * - **On read, a stale id is tolerated** and falls back to the due-date heuristic. A stored
 *   policy can outlive the assessment it names — the assessment is deleted, or a policy is
 *   copied between offerings — and a stale id must not stop a teacher exporting their grades.
 *   `resolveFinalGradeConfig` handles that, and `derivedGradingMembership` reports it so the
 *   editor can show "derived" rather than implying the teacher chose it.
 */

export type OfferingGradingReadResult =
  { kind: "ok"; payload: OfferingGradingResponse } | { kind: "not-found" }

export type OfferingGradingWriteResult =
  | { kind: "ok"; payload: OfferingGradingResponse }
  | { kind: "not-found" }
  | { kind: "invalid-final-assessment" }

/** The caller's staff id, or `null` when they have no staff profile. */
async function staffIdFor(user: AuthUser): Promise<string | null> {
  const staff = await prisma.staffProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  return staff?.id ?? null
}

/**
 * Load the offering together with the assessments the policy resolves against.
 *
 * Scoped by `teacherId` in the query itself rather than fetched-then-compared, so a
 * non-owner's offering is indistinguishable from one that does not exist.
 */
async function loadOwnedOfferingForGrading(offeringId: string, staffId: string) {
  return prisma.courseOffering.findFirst({
    where: { id: offeringId, teacherId: staffId },
    select: {
      id: true,
      gradingConfig: true,
      course: { select: { code: true, name: true } },
      assessments: {
        orderBy: { dueDate: "asc" },
        select: { id: true, title: true, type: true, dueDate: true, maxMarks: true },
      },
    },
  })
}

function toAssessmentOption(assessment: {
  id: string
  title: string
  type: AssessmentType
  dueDate: Date
  maxMarks: number
}): GradingAssessmentOption {
  return {
    id: assessment.id,
    title: assessment.title,
    type: assessment.type,
    dueDate: assessment.dueDate.toISOString(),
    maxMarks: assessment.maxMarks,
  }
}

/** Build the response payload from a loaded offering and an effective policy. */
function toPayload(
  offering: {
    id: string
    course: { code: string; name: string }
    assessments: {
      id: string
      title: string
      type: AssessmentType
      dueDate: Date
      maxMarks: number
    }[]
  },
  config: OfferingGradingConfigValue,
  source: "stored" | "defaults" | "stored-invalid",
  roster: OfferingCatEligibilityRow[],
): OfferingGradingResponse {
  const assessments = offering.assessments.map((assessment) => ({
    id: assessment.id,
    type: assessment.type,
    dueDate: assessment.dueDate,
  }))
  const membership = derivedGradingMembership(config, assessments)

  return {
    success: true,
    offeringId: offering.id,
    courseCode: offering.course.code,
    courseName: offering.course.name,
    config,
    // A stored-but-unusable policy is reported as defaulted, because that is what is in
    // force. The editor shows a warning distinguishing it from a never-configured offering.
    usingDefaults: source !== "stored",
    assessments: offering.assessments.map(toAssessmentOption),
    derived: membership,
    roster,
  }
}

/**
 * Per-student CAT standing for an offering, for the eligibility panel.
 *
 * **The marks come from the export's own resolver** (`resolveMarks`), not from a second query
 * written here. That matters more than it looks: the gate's verdict and the exported grand
 * total are about the same marks, and two independent implementations of "which marks count"
 * would eventually disagree — one saying a student cleared the CAT gate while the other
 * excluded the very marks that cleared it.
 *
 * `resolveMarks` already applies the published-only rule, so unpublished marks are excluded
 * rather than zero-filled here too.
 */
async function loadCatEligibility(
  offeringId: string,
  stored: StoredGradingConfig,
): Promise<OfferingCatEligibilityRow[]> {
  const [assessmentRows, enrollmentRows, gradeRows] = await Promise.all([
    prisma.assessment.findMany({
      where: { offeringId },
      orderBy: { dueDate: "asc" },
      select: { id: true, title: true, type: true, dueDate: true },
    }),
    prisma.enrollment.findMany({
      where: { offeringId, status: "active" },
      orderBy: { student: { registerNumber: "asc" } },
      select: { student: { select: { id: true, fullName: true, registerNumber: true } } },
    }),
    prisma.grade.findMany({
      where: { assessment: { offeringId } },
      select: {
        assessmentId: true,
        studentId: true,
        points: true,
        maxPoints: true,
        publishedAt: true,
      },
    }),
  ])

  const byStudent = new Map<string, GradeCandidateInput[]>()
  for (const enrollment of enrollmentRows) {
    byStudent.set(
      enrollment.student.id,
      assessmentRows.map((assessment) => ({ assessmentId: assessment.id, modern: null })),
    )
  }
  for (const grade of gradeRows) {
    const candidates = byStudent.get(grade.studentId)
    if (!candidates) continue
    const index = candidates.findIndex((candidate) => candidate.assessmentId === grade.assessmentId)
    if (index === -1) continue
    candidates[index] = {
      assessmentId: grade.assessmentId,
      modern: {
        points: Number(grade.points),
        maxPoints: Number(grade.maxPoints),
        publishedAt: grade.publishedAt,
      },
    }
  }

  const students: EligibilityStudent[] = enrollmentRows.map((enrollment) => ({
    id: enrollment.student.id,
    name: enrollment.student.fullName,
    registerNumber: enrollment.student.registerNumber,
    marks: resolveMarks(byStudent.get(enrollment.student.id) ?? []).marks.map((mark) => ({
      assessmentId: mark.assessmentId,
      percentage: mark.percentage,
      publishedAt: mark.publishedAt,
    })),
  }))

  const rows = buildCatEligibility(stored, assessmentRows, students)

  return rows.map((row) => ({
    studentId: row.studentId,
    name: row.name,
    registerNumber: row.registerNumber,
    catPercent: row.progress.percent,
    markedCount: row.progress.markedCount,
    totalCount: row.progress.totalCount,
    completionRatio: row.progress.completionRatio,
    status: row.status,
  }))
}

/** The policy in force for an offering, plus what it resolves to against its assessments. */
export async function getOfferingGradingForTeacher(
  user: AuthUser,
  offeringId: string,
): Promise<OfferingGradingReadResult> {
  const staffId = await staffIdFor(user)
  if (!staffId) return { kind: "not-found" }

  const offering = await loadOwnedOfferingForGrading(offeringId, staffId)
  if (!offering) return { kind: "not-found" }

  const resolved = resolveGradingPolicy(offering.gradingConfig)
  // No roster without a stored policy: reporting "below the CAT minimum" against a gate the
  // teacher never set would fail students on a rule the course does not have. An unconfigured
  // offering shows the default as a starting point and no verdicts.
  const roster =
    resolved.source === "stored" ? await loadCatEligibility(offering.id, resolved.config) : []
  return { kind: "ok", payload: toPayload(offering, resolved.config, resolved.source, roster) }
}

/**
 * Store a new policy for an offering.
 *
 * Audited, because this changes how every student's final grade is computed. The row records
 * the before and after policies so "why did the total change" is answerable later — the same
 * reason a manual mark publishes through the audited pipeline rather than writing `Grade`
 * directly.
 */
export async function setOfferingGradingForTeacher(
  user: AuthUser,
  offeringId: string,
  config: OfferingGradingConfigValue,
): Promise<OfferingGradingWriteResult> {
  const staffId = await staffIdFor(user)
  if (!staffId) return { kind: "not-found" }

  const offering = await loadOwnedOfferingForGrading(offeringId, staffId)
  if (!offering) return { kind: "not-found" }

  // A named final assessment must belong to this offering. See the module docblock for why
  // this is stricter than the read path.
  if (
    config.finalAssessmentId !== null &&
    !offering.assessments.some((assessment) => assessment.id === config.finalAssessmentId)
  ) {
    return { kind: "invalid-final-assessment" }
  }

  const before = resolveGradingPolicy(offering.gradingConfig)

  await prisma.$transaction(async (tx) => {
    await tx.courseOffering.update({
      where: { id: offering.id },
      data: { gradingConfig: config },
    })
    await writeAuditLog(tx, {
      entityType: "CourseOffering",
      entityId: offering.id,
      action: "offering.grading_config.updated",
      actor: { id: user.id, role: user.role },
      before: { gradingConfig: before.config, source: before.source },
      after: { gradingConfig: config, source: "stored" },
    })
  })

  const roster = await loadCatEligibility(offering.id, config)
  return { kind: "ok", payload: toPayload(offering, config, "stored", roster) }
}
