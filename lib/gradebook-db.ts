import "server-only"

import { releasedAssessmentWhere } from "@/lib/assessment-visibility"
import { isLiveEnrollmentStatus } from "@/lib/enrollment-scope"
import type { AssessmentType } from "@/lib/generated/prisma/enums"
import type { CreateAssessmentRequest, UpdateAssessmentRequest } from "@/lib/contracts"
import { writeAuditLog } from "@/lib/grading/audit"
import { prisma } from "@/lib/prisma"
import { recordManualMark } from "@/lib/grading/review-service"
import { quizDeliveryStatus } from "@/lib/quiz-attempts/metadata"
import type { AuthUser } from "@/lib/session"
import { teacherOwnsAssessment } from "@/lib/teacher-staff"
import {
  markKey,
  toAssessmentScale,
  type Assessment,
  type Course,
  type MarksMap,
  type Offering,
  type Quiz,
  type Student,
  type UpcomingEvent,
} from "@/lib/gradebook"

type GradebookPayload = {
  students: Student[]
  courses: Course[]
  assessments: Assessment[]
  marks: MarksMap
  quizzes: Quiz[]
  upcomingEvents: UpcomingEvent[]
  selectedStudentId: string | null
  /**
   * Server-computed average percentage per assessment id. It is the only
   * class-level signal a student payload may carry: aggregates, never the
   * per-student rows they are derived from.
   */
  classAverages: Record<string, number | null>
  /** Teacher-owned offerings the create-assessment flow can target. */
  offerings: Offering[]
}

function toAssessmentUpcomingEvent(assessment: {
  id: string
  title: string
  dueDate: Date
  courseId: string
  classId: string
  type: AssessmentType
  course: { name: string }
}): UpcomingEvent {
  return {
    id: `assessment-${assessment.id}`,
    title: assessment.title,
    description: `Due: ${assessment.title}`,
    eventType: "ASSESSMENT",
    date: assessment.dueDate.toISOString(),
    endDate: null,
    courseId: assessment.courseId,
    courseName: assessment.course.name,
    classId: assessment.classId,
    assessmentId: assessment.id,
    assessmentType: assessment.type,
  }
}

function emptyPayload(): GradebookPayload {
  return {
    students: [],
    courses: [],
    assessments: [],
    marks: {},
    quizzes: [],
    upcomingEvents: [],
    selectedStudentId: null,
    classAverages: {},
    offerings: [],
  }
}

function uniqById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>()
  const result: T[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    result.push(item)
  }
  return result
}

/** The modern `Question` / `QuestionOption` columns the key-free projection needs. */
type GradebookQuizQuestionRow = {
  id: string
  order: number
  prompt: string
  status: string | null
  metadata: unknown
  options: Array<{ order: number; text: string; isCorrect: boolean }>
}

/**
 * Project modern `Question` / `QuestionOption` rows onto the key-free quiz shape
 * the gradebook payload exposes.
 *
 * Only a *deliverable* question set is included, using the same
 * `quizDeliveryStatus` rule the attempt pipeline enforces (published, at least
 * two options, exactly one correct). That keeps a generated draft from ever
 * reaching the client, and the correct option is deliberately absent from the
 * projection — `lib/gradebook.ts`'s `QuizQuestion` has no answer-key field.
 */
function toUiQuizzes(
  assessments: Array<{ id: string; questions: GradebookQuizQuestionRow[] }>,
): Quiz[] {
  const quizzes: Quiz[] = []
  for (const assessment of assessments) {
    if (assessment.questions.length === 0) continue
    if (!quizDeliveryStatus(assessment.questions).deliverable) continue
    quizzes.push({
      assessmentId: assessment.id,
      questions: [...assessment.questions]
        .sort((a, b) => a.order - b.order)
        .map((question) => ({
          id: question.id,
          prompt: question.prompt,
          options: [...question.options]
            .sort((a, b) => a.order - b.order)
            .map((option) => option.text),
        })),
    })
  }
  return quizzes
}

/**
 * Only a published `Grade` is a real mark: an unpublished row is a pending AI
 * draft that no teacher has approved, so it is neither a gradebook mark nor a
 * class-average input.
 */
const PUBLISHED_GRADE_SELECT = {
  where: { publishedAt: { not: null } },
  select: { studentId: true, points: true, maxPoints: true },
}

export async function getGradebookPayloadForSessionUser(
  sessionUser: AuthUser,
): Promise<GradebookPayload> {
  if (sessionUser.role === "admin") {
    // Admin has a separate workspace and should not consume teacher gradebook payloads.
    return emptyPayload()
  }

  if (sessionUser.role === "teacher") {
    const staff = await prisma.staffProfile.findUnique({ where: { userId: sessionUser.id } })
    if (!staff) return emptyPayload()

    const offerings = await prisma.courseOffering.findMany({
      where: { teacherId: staff.id },
      include: {
        course: true,
        classRoom: { select: { name: true, section: true } },
        enrollments: {
          include: {
            student: {
              include: { user: true },
            },
          },
        },
        assessments: {
          where: { createdById: staff.id },
          include: {
            course: true,
            questions: {
              orderBy: { order: "asc" },
              include: { options: { orderBy: { order: "asc" } } },
            },
            finalGrades: PUBLISHED_GRADE_SELECT,
          },
          orderBy: { dueDate: "asc" },
        },
      },
      orderBy: [{ academicYear: "desc" }, { term: "asc" }],
    })

    const coursePool: Course[] = uniqById(
      offerings.map((o) => ({ id: o.course.id, code: o.course.code, name: o.course.name })),
    )

    // The create-assessment picker must show every offering (same course can be
    // taught in several classes/terms); the class label is what disambiguates.
    const offeringPool: Offering[] = offerings.map((o) => ({
      id: o.id,
      courseId: o.courseId,
      courseCode: o.course.code,
      courseName: o.course.name,
      className: `${o.classRoom.name}${o.classRoom.section ? ` ${o.classRoom.section}` : ""}`,
      term: o.term,
      academicYear: o.academicYear,
    }))

    const studentPool: Student[] = uniqById(
      offerings.flatMap((offering) =>
        offering.enrollments.map((e) => ({
          id: e.student.id,
          name: e.student.fullName,
          email: e.student.user.email,
          registerNumber: e.student.registerNumber,
          profilePicUrl: e.student.profilePicUrl,
        })),
      ),
    )

    const assessmentPool = offerings.flatMap((offering) => offering.assessments)

    const assessments: Assessment[] = assessmentPool.map((a) => ({
      id: a.id,
      title: a.title,
      courseId: a.courseId,
      courseName: a.course.name,
      type: a.type,
      date: a.dueDate.toISOString().slice(0, 10),
      maxMarks: a.maxMarks,
      offeringId: a.offeringId,
      classId: a.classId,
    }))

    const marks: MarksMap = {}
    for (const a of assessmentPool) {
      for (const g of a.finalGrades) {
        marks[markKey(g.studentId, a.id)] = toAssessmentScale(
          Number(g.points),
          Number(g.maxPoints),
          a.maxMarks,
        )
      }
    }

    const quizzes: Quiz[] = toUiQuizzes(assessmentPool)

    const offeringIds = offerings.map((o) => o.id)
    const upcomingRows = offeringIds.length
      ? await prisma.calendarEvent.findMany({
          where: {
            offeringId: { in: offeringIds },
            isUpcoming: true,
            OR: [{ assessmentId: null }, { assessment: { is: { createdById: staff.id } } }],
          },
          include: {
            assessment: {
              include: {
                course: true,
              },
            },
            offering: {
              include: {
                course: true,
              },
            },
          },
          orderBy: { startAt: "asc" },
          take: 100,
        })
      : []

    const calendarEvents: UpcomingEvent[] = upcomingRows.map((event) => ({
      id: event.id,
      title: event.title,
      description: event.description,
      eventType: event.eventType,
      date: event.startAt.toISOString(),
      endDate: event.endAt?.toISOString() ?? null,
      courseId: event.assessment?.courseId ?? event.offering?.courseId ?? null,
      courseName: event.assessment?.course.name ?? event.offering?.course.name ?? null,
      classId: event.classId,
      assessmentId: event.assessmentId,
      assessmentType: event.assessment ? event.assessment.type : null,
    }))

    const calendarAssessmentIds = new Set(
      calendarEvents
        .map((event) => event.assessmentId)
        .filter((value): value is string => Boolean(value)),
    )

    const fallbackAssessmentEvents: UpcomingEvent[] = assessmentPool
      .filter((assessment) => !calendarAssessmentIds.has(assessment.id))
      .map((assessment) =>
        toAssessmentUpcomingEvent({
          id: assessment.id,
          title: assessment.title,
          dueDate: assessment.dueDate,
          courseId: assessment.courseId,
          classId: assessment.classId,
          type: assessment.type,
          course: { name: assessment.course.name },
        }),
      )

    const upcomingEvents = [...calendarEvents, ...fallbackAssessmentEvents]

    return {
      students: studentPool,
      courses: coursePool,
      assessments,
      marks,
      quizzes,
      upcomingEvents,
      selectedStudentId: studentPool[0]?.id ?? null,
      // Teachers already receive the full cohort marks they are entitled to,
      // so they compute averages client-side; no server aggregate is needed.
      classAverages: {},
      offerings: offeringPool,
    }
  }

  const studentProfile = await prisma.studentProfile.findUnique({
    where: { userId: sessionUser.id },
    include: {
      enrollments: {
        include: {
          offering: {
            include: {
              course: true,
              assessments: {
                // Release governs visibility, and this is the *projection* half of that rule.
                // Filtering here, not in the renderer, is the point: this payload is embedded
                // in the RSC script payload of every `(dashboard)` route, so an assessment
                // filtered out of the visible table but present here is still readable in the
                // page source. The events page hides an unreleased assessment's row correctly;
                // without this filter its id, title, type, date, marks and class were still in
                // the payload — the SN-29 leak. The predicate is imported from
                // `lib/assessment-visibility.ts`, the one definition.
                where: releasedAssessmentWhere(),
                include: {
                  course: true,
                  questions: {
                    orderBy: { order: "asc" },
                    include: { options: { orderBy: { order: "asc" } } },
                  },
                  finalGrades: PUBLISHED_GRADE_SELECT,
                },
                orderBy: { dueDate: "asc" },
              },
            },
          },
        },
      },
    },
  })

  if (!studentProfile) return emptyPayload()

  // A dropped or withdrawn student keeps no live course workspace: without this the projection
  // served their course names, assessment titles and class averages anyway (SN-37). The rule is
  // the shared live-enrollment predicate, not a second local copy.
  const offerings = studentProfile.enrollments
    .filter((enrollment) => isLiveEnrollmentStatus(enrollment.status))
    .map((e) => e.offering)

  const courses: Course[] = uniqById(
    offerings.map((o) => ({ id: o.course.id, code: o.course.code, name: o.course.name })),
  )

  // Object-level authorization: a student's payload carries only their own
  // identity and marks. Classmates' rows must never leave the server. The
  // "vs class average" view is served by the aggregate `classAverages` map
  // computed below, so no per-student row is needed on the client.
  const students: Student[] = [
    {
      id: studentProfile.id,
      name: studentProfile.fullName,
      email: sessionUser.email,
      registerNumber: studentProfile.registerNumber,
      profilePicUrl: studentProfile.profilePicUrl,
    },
  ]

  const assessmentPool = offerings.flatMap((offering) => offering.assessments)

  const assessments: Assessment[] = assessmentPool.map((a) => ({
    id: a.id,
    title: a.title,
    courseId: a.courseId,
    courseName: a.course.name,
    type: a.type,
    date: a.dueDate.toISOString().slice(0, 10),
    maxMarks: a.maxMarks,
    offeringId: a.offeringId,
    classId: a.classId,
  }))

  const marks: MarksMap = {}
  const classAverages: Record<string, number | null> = {}
  for (const a of assessmentPool) {
    const percentages: number[] = []
    for (const g of a.finalGrades) {
      const points = Number(g.points)
      const maxPoints = Number(g.maxPoints)
      const percentage = maxPoints > 0 ? (points / maxPoints) * 100 : Number.NaN
      if (Number.isFinite(percentage)) percentages.push(percentage)
      if (g.studentId === studentProfile.id) {
        marks[markKey(g.studentId, a.id)] = toAssessmentScale(points, maxPoints, a.maxMarks)
      }
    }
    classAverages[a.id] = percentages.length
      ? percentages.reduce((sum, value) => sum + value, 0) / percentages.length
      : null
  }

  const quizzes: Quiz[] = toUiQuizzes(assessmentPool)

  const offeringIds = offerings.map((o) => o.id)
  const upcomingRows = offeringIds.length
    ? await prisma.calendarEvent.findMany({
        where: {
          offeringId: { in: offeringIds },
          isUpcoming: true,
          // Same release rule as the assessments filter above, applied to events: an event
          // hanging off an unreleased assessment is not a student-facing fact. Without this the
          // due event was the other half of the SN-29 leak — the assessment row was filtered
          // out, but its calendar event still travelled in the payload. The release predicate
          // is imported; the `OR` keeps its separate fact that an event may hang off no
          // assessment at all.
          OR: [{ assessmentId: null }, { assessment: { is: releasedAssessmentWhere() } }],
        },
        include: {
          assessment: {
            include: {
              course: true,
            },
          },
          offering: {
            include: {
              course: true,
            },
          },
        },
        orderBy: { startAt: "asc" },
        take: 100,
      })
    : []

  const calendarEvents: UpcomingEvent[] = upcomingRows.map((event) => ({
    id: event.id,
    title: event.title,
    description: event.description,
    eventType: event.eventType,
    date: event.startAt.toISOString(),
    endDate: event.endAt?.toISOString() ?? null,
    courseId: event.assessment?.courseId ?? event.offering?.courseId ?? null,
    courseName: event.assessment?.course.name ?? event.offering?.course.name ?? null,
    classId: event.classId,
    assessmentId: event.assessmentId,
    assessmentType: event.assessment ? event.assessment.type : null,
  }))

  const calendarAssessmentIds = new Set(
    calendarEvents
      .map((event) => event.assessmentId)
      .filter((value): value is string => Boolean(value)),
  )

  const fallbackAssessmentEvents: UpcomingEvent[] = assessmentPool
    .filter((assessment) => !calendarAssessmentIds.has(assessment.id))
    .map((assessment) =>
      toAssessmentUpcomingEvent({
        id: assessment.id,
        title: assessment.title,
        dueDate: assessment.dueDate,
        courseId: assessment.courseId,
        classId: assessment.classId,
        type: assessment.type,
        course: { name: assessment.course.name },
      }),
    )

  const upcomingEvents = [...calendarEvents, ...fallbackAssessmentEvents]

  return {
    students,
    courses,
    assessments,
    marks,
    quizzes,
    upcomingEvents,
    selectedStudentId: studentProfile.id,
    classAverages,
    // Authoring an assessment is a teacher action; students never see it.
    offerings: [],
  }
}

export async function upsertAssessmentGrade(
  input: {
    studentId: string
    assessmentId: string
    score: number | null
  },
  actor: AuthUser,
) {
  // Only staff may write marks; a student can never grade their own work.
  if (actor.role !== "teacher" && actor.role !== "admin") {
    throw new Error("Forbidden")
  }

  const assessment = await prisma.assessment.findUnique({
    where: { id: input.assessmentId },
    include: {
      offering: {
        select: {
          id: true,
          teacherId: true,
        },
      },
    },
  })
  if (!assessment) throw new Error("Assessment not found")

  const enrollment = await prisma.enrollment.findUnique({
    where: {
      studentId_offeringId: {
        studentId: input.studentId,
        offeringId: assessment.offering.id,
      },
    },
    select: { id: true },
  })

  if (!enrollment) {
    throw new Error("Student not enrolled in assessment offering")
  }

  // Object-level authorization: a teacher may only write marks for assessments
  // in their own offerings. Admins may write any.
  if (actor.role === "teacher") {
    const staff = await prisma.staffProfile.findUnique({ where: { userId: actor.id } })
    if (!staff || assessment.offering.teacherId !== staff.id) {
      throw new Error("Forbidden")
    }
  }

  if (input.score === null) {
    // Clearing is deliberate: the modern grade is removed and audited rather
    // than voided, so a cleared mark cannot be mistaken for a pending AI draft.
    await recordManualMark({
      studentId: input.studentId,
      assessmentId: input.assessmentId,
      points: null,
      maxPoints: assessment.maxMarks,
      actor: { id: actor.id, role: actor.role },
    })
    return
  }

  // Reject out-of-range marks instead of silently clamping: a client that sends
  // 9999 used to receive `200 success` while a different value (maxMarks) was
  // stored, so the response could not be trusted.
  if (!Number.isFinite(input.score) || input.score < 0 || input.score > assessment.maxMarks) {
    throw new Error(`Score must be between 0 and ${assessment.maxMarks}.`)
  }

  // A teacher typing a mark is the human approval: publish it into the audited
  // modern pipeline (one `Grade` + one `AuditLog` row) instead of the legacy
  // `AssessmentGrade` store.
  await recordManualMark({
    studentId: input.studentId,
    assessmentId: input.assessmentId,
    points: input.score,
    maxPoints: assessment.maxMarks,
    actor: { id: actor.id, role: actor.role },
  })
}

/**
 * The natural key two "identical" create requests share.
 *
 * The contract has no idempotency-key field, so identity has to come from the request itself:
 * the same teacher, offering, title, kind, due date and ceiling. Two concurrent submissions of
 * the same form are a double-click or a retry; treating them as one assessment is what stops the
 * indistinguishable duplicate the audit found (TN-55). A teacher who genuinely wants a second
 * assessment varies one of these (usually the title).
 */
function assessmentCreationLockKey(input: {
  staffId: string
  offeringId: string
  title: string
  type: string
  date: string
  maxMarks: number
}): string {
  return [
    "assessment-create",
    input.staffId,
    input.offeringId,
    input.title.trim().toLowerCase(),
    input.type,
    input.date,
    String(input.maxMarks),
  ].join(":")
}

export async function createAssessmentForSessionUser(
  input: {
    title: string
    offeringId: string
    /** The contract's vocabulary, which since the widening is the `AssessmentType` enum's. */
    type: CreateAssessmentRequest["type"]
    date: string
    maxMarks: number
  },
  sessionUser: AuthUser,
): Promise<Assessment & { created: boolean }> {
  if (sessionUser.role !== "teacher") {
    throw new Error("Forbidden")
  }

  const staff = await prisma.staffProfile.findUnique({ where: { userId: sessionUser.id } })
  if (!staff) throw new Error("Staff profile missing")

  // The offering is the single source of truth for course/class. Filtering by
  // `teacherId` makes a missing offering and another teacher's offering the same
  // 403, so the endpoint never confirms that someone else's offering exists —
  // and a teacher who teaches the same course twice can no longer land in the
  // wrong class because the client never sends a bare `courseId`.
  const offering = await prisma.courseOffering.findFirst({
    where: { id: input.offeringId, teacherId: staff.id },
    select: { id: true, courseId: true, classId: true },
  })
  if (!offering) {
    throw new Error("Offering not found or not owned by you.")
  }

  const title = input.title.trim()
  const dueDate = new Date(input.date)
  const lockKey = assessmentCreationLockKey({
    staffId: staff.id,
    offeringId: offering.id,
    title,
    type: input.type,
    date: input.date,
    maxMarks: input.maxMarks,
  })

  const result = await prisma.$transaction(async (tx) => {
    // Serialize identical creates, then check-then-insert inside the lock. Without the
    // lock the check is a race: two requests both find nothing and both insert, which is
    // exactly the TN-55 reproduction. The lock is per natural key, so distinct creates
    // still run in parallel. `hashtextextended` maps the key to the bigint the advisory
    // lock takes; a hash collision only costs a little serialization.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`

    const existing = await tx.assessment.findFirst({
      where: {
        offeringId: offering.id,
        createdById: staff.id,
        title,
        type: input.type,
        dueDate,
        maxMarks: input.maxMarks,
      },
      include: { course: true },
    })
    if (existing) return { row: existing, created: false }

    const assessment = await tx.assessment.create({
      data: {
        title,
        // Identity: the request carries the enum's own vocabulary (see the contract).
        type: input.type,
        dueDate,
        maxMarks: input.maxMarks,
        offeringId: offering.id,
        courseId: offering.courseId,
        classId: offering.classId,
        createdById: staff.id,
      },
      include: {
        course: true,
      },
    })

    await tx.calendarEvent.create({
      data: {
        classId: offering.classId,
        offeringId: offering.id,
        assessmentId: assessment.id,
        title: assessment.title,
        description: `Due: ${assessment.title}`,
        eventType: "ASSESSMENT",
        startAt: assessment.dueDate,
        isUpcoming: true,
      },
    })

    await writeAuditLog(tx, {
      entityType: "Assessment",
      entityId: assessment.id,
      action: "assessment.created",
      actor: { id: sessionUser.id, role: sessionUser.role },
      after: {
        offeringId: offering.id,
        title: assessment.title,
        type: assessment.type,
        dueDate: assessment.dueDate.toISOString(),
        maxMarks: assessment.maxMarks,
      },
    })

    return { row: assessment, created: true }
  })

  return {
    id: result.row.id,
    title: result.row.title,
    courseId: result.row.courseId,
    courseName: result.row.course.name,
    type: result.row.type,
    date: result.row.dueDate.toISOString().slice(0, 10),
    maxMarks: result.row.maxMarks,
    offeringId: result.row.offeringId,
    classId: result.row.classId,
    created: result.created,
  }
}

// ---------------------------------------------------------------------------
// Assessment registry: list, edit and delete (TN-39)
//
// The create form produced a bare `Assessment` row and nothing in the app could list, rename or
// remove one. These three are that missing write path. The row shape carries what each kind's
// authoring surface needs to link to, plus a completeness signal ("a QUIZ with no questions"),
// so the page can say what still has to be authored instead of pretending the row is finished.
// ---------------------------------------------------------------------------

export type TeacherAssessmentRow = {
  id: string
  title: string
  type: AssessmentType
  dueDate: string
  maxMarks: number
  offeringId: string
  offeringLabel: string
  courseName: string
  className: string
  releasedAt: string | null
  /** Questions authored on the modern store, drafts and published. */
  questionCount: number
  publishedQuestionCount: number
  hasRubric: boolean
  hasCodeTask: boolean
  /** Published marks recorded against this assessment. */
  gradedCount: number
  submissionCount: number
}

const ASSESSMENT_REGISTRY_SELECT = {
  id: true,
  title: true,
  type: true,
  dueDate: true,
  maxMarks: true,
  offeringId: true,
  releasedAt: true,
  course: { select: { code: true, name: true } },
  offering: {
    select: {
      term: true,
      academicYear: true,
      classRoom: { select: { name: true, section: true } },
    },
  },
  questions: { select: { status: true } },
  rubric: { select: { id: true } },
  codeTask: { select: { id: true } },
  _count: { select: { submissions: true, finalGrades: true } },
} as const

type AssessmentRegistryRecord = {
  id: string
  title: string
  type: AssessmentType
  dueDate: Date
  maxMarks: number
  offeringId: string
  releasedAt: Date | null
  course: { code: string; name: string }
  offering: {
    term: string
    academicYear: number
    classRoom: { name: string; section: string | null }
  }
  questions: Array<{ status: string | null }>
  rubric: { id: string } | null
  codeTask: { id: string } | null
  _count: { submissions: number; finalGrades: number }
}

function toTeacherAssessmentRow(record: AssessmentRegistryRecord): TeacherAssessmentRow {
  const room = record.offering.classRoom.section
    ? `${record.offering.classRoom.name} ${record.offering.classRoom.section}`
    : record.offering.classRoom.name
  return {
    id: record.id,
    title: record.title,
    type: record.type,
    dueDate: record.dueDate.toISOString(),
    maxMarks: record.maxMarks,
    offeringId: record.offeringId,
    offeringLabel: `${record.course.code} · ${record.course.name} — ${room} · ${record.offering.academicYear} ${record.offering.term}`,
    courseName: record.course.name,
    className: room,
    releasedAt: record.releasedAt?.toISOString() ?? null,
    questionCount: record.questions.length,
    publishedQuestionCount: record.questions.filter((question) => question.status === "published")
      .length,
    hasRubric: record.rubric !== null,
    hasCodeTask: record.codeTask !== null,
    gradedCount: record._count.finalGrades,
    submissionCount: record._count.submissions,
  }
}

/** Every assessment the caller created or teaches, with its authoring completeness. */
export async function listAssessmentsForSessionUser(
  sessionUser: AuthUser,
): Promise<TeacherAssessmentRow[]> {
  if (sessionUser.role !== "teacher") return []
  const staff = await prisma.staffProfile.findUnique({ where: { userId: sessionUser.id } })
  if (!staff) return []

  const assessments = await prisma.assessment.findMany({
    where: {
      OR: [{ createdById: staff.id }, { offering: { teacherId: staff.id } }],
    },
    select: ASSESSMENT_REGISTRY_SELECT,
    orderBy: { dueDate: "desc" },
    take: 500,
  })
  return assessments.map(toTeacherAssessmentRow)
}

/** A write-path failure carrying the HTTP status the registry routes return. */
export class AssessmentWriteError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message)
    this.name = "AssessmentWriteError"
  }
}

type OwnedAssessmentRecord = {
  id: string
  title: string
  createdById: string
  offeringId: string
  offering: { teacherId: string } | null
}

async function loadOwnedAssessmentForWrite(
  sessionUser: AuthUser,
  assessmentId: string,
): Promise<OwnedAssessmentRecord> {
  if (sessionUser.role !== "teacher") throw new AssessmentWriteError(403, "Forbidden")
  const staff = await prisma.staffProfile.findUnique({ where: { userId: sessionUser.id } })
  if (!staff) throw new AssessmentWriteError(403, "Staff profile missing")

  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      id: true,
      title: true,
      createdById: true,
      offeringId: true,
      offering: { select: { teacherId: true } },
    },
  })
  if (!assessment) throw new AssessmentWriteError(404, "Assessment not found")
  if (!teacherOwnsAssessment(assessment, staff.id)) {
    throw new AssessmentWriteError(403, "Forbidden")
  }
  return assessment
}

/**
 * Rename an assessment or move its deadline. `maxMarks` is accepted only while the assessment
 * has no marks and no submissions: changing the ceiling of a graded assessment would rescale
 * nothing (each `Grade` stores its own `maxPoints`) while making the column disagree with it.
 */
export async function updateAssessmentForSessionUser(
  sessionUser: AuthUser,
  assessmentId: string,
  input: UpdateAssessmentRequest,
): Promise<TeacherAssessmentRow> {
  await loadOwnedAssessmentForWrite(sessionUser, assessmentId)

  if (input.maxMarks !== undefined) {
    const [gradeCount, submissionCount] = await Promise.all([
      prisma.grade.count({ where: { assessmentId } }),
      prisma.submission.count({ where: { assessmentId } }),
    ])
    if (gradeCount > 0 || submissionCount > 0) {
      throw new AssessmentWriteError(
        409,
        "Max marks cannot change once the assessment has marks or submissions. Create a new assessment instead.",
      )
    }
  }

  await prisma.$transaction(async (tx) => {
    const before = await tx.assessment.findUniqueOrThrow({
      where: { id: assessmentId },
      select: { title: true, dueDate: true, maxMarks: true },
    })
    const updated = await tx.assessment.update({
      where: { id: assessmentId },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.date !== undefined ? { dueDate: new Date(input.date) } : {}),
        ...(input.maxMarks !== undefined ? { maxMarks: input.maxMarks } : {}),
      },
      select: ASSESSMENT_REGISTRY_SELECT,
    })
    // The due calendar event mirrors the deadline. Without this an edited assessment's
    // event kept the old date, so the planner and the assessment disagreed (the same
    // shape as TN-25's stale-event family).
    if (input.date !== undefined) {
      await tx.calendarEvent.updateMany({
        where: { assessmentId },
        data: { startAt: new Date(input.date), title: updated.title },
      })
    }
    await writeAuditLog(tx, {
      entityType: "Assessment",
      entityId: assessmentId,
      action: "assessment.edited",
      actor: { id: sessionUser.id, role: sessionUser.role },
      before: {
        title: before.title,
        dueDate: before.dueDate.toISOString(),
        maxMarks: before.maxMarks,
      },
      after: {
        title: updated.title,
        dueDate: updated.dueDate.toISOString(),
        maxMarks: updated.maxMarks,
      },
    })
    return updated
  })

  const refreshed = await prisma.assessment.findUniqueOrThrow({
    where: { id: assessmentId },
    select: ASSESSMENT_REGISTRY_SELECT,
  })
  return toTeacherAssessmentRow(refreshed)
}

/**
 * Delete an assessment the caller owns, with its calendar event.
 *
 * Refuses once student work or a released mark exists: the audit's complaint was that a *bare*
 * row could not be removed, and erasing a graded assessment would destroy the academic record.
 * A bare row — no questions, rubric, task, submission or grade — deletes cleanly and cascades
 * its children.
 */
export async function deleteAssessmentForSessionUser(
  sessionUser: AuthUser,
  assessmentId: string,
): Promise<{ id: string; title: string }> {
  const assessment = await loadOwnedAssessmentForWrite(sessionUser, assessmentId)

  const [gradeCount, submissionCount, attemptCount] = await Promise.all([
    prisma.grade.count({ where: { assessmentId } }),
    prisma.submission.count({ where: { assessmentId } }),
    prisma.quizAttempt.count({ where: { assessmentId } }),
  ])
  if (gradeCount > 0 || submissionCount > 0 || attemptCount > 0) {
    throw new AssessmentWriteError(
      409,
      "This assessment has student work or marks and cannot be deleted. Archive it by leaving it unreleased.",
    )
  }

  const removed = await prisma.$transaction(async (tx) => {
    // `CalendarEvent.assessmentId` is `onDelete: SetNull`, so a cascade would leave the due
    // event behind with no assessment and visible to every student. Remove it explicitly.
    await tx.calendarEvent.deleteMany({ where: { assessmentId } })
    const row = await tx.assessment.delete({
      where: { id: assessmentId },
      select: { id: true, title: true },
    })
    await writeAuditLog(tx, {
      entityType: "Assessment",
      entityId: assessmentId,
      action: "assessment.deleted",
      actor: { id: sessionUser.id, role: sessionUser.role },
      before: { title: assessment.title, offeringId: assessment.offeringId },
    })
    return row
  })

  return removed
}

type ParsedQuizQuestion = {
  prompt: string
  options: string[]
  correctIndex: number
  marks: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function toNumber(value: unknown) {
  return typeof value === "number" ? value : Number.NaN
}

function toStringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function parseImportedQuestions(input: unknown): ParsedQuizQuestion[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("Quiz must include at least one question.")
  }

  return input.map((item, index) => {
    const row = asRecord(item)
    if (!row) throw new Error(`Question ${index + 1} has an invalid shape.`)

    const prompt = toStringValue(row.questionText)
    if (!prompt) throw new Error(`Question ${index + 1} is missing questionText.`)

    if (!Array.isArray(row.options) || row.options.length < 2) {
      throw new Error(`Question ${index + 1} must include at least two options.`)
    }

    const options = row.options.map((option, optionIndex) => {
      const value = asRecord(option)
      if (!value)
        throw new Error(
          `Question ${index + 1} has an invalid option at position ${optionIndex + 1}.`,
        )
      const text = toStringValue(value.text)
      if (!text)
        throw new Error(`Question ${index + 1} has an empty option at position ${optionIndex + 1}.`)
      const optionIdRaw = toStringValue(value.optionId)
      return {
        optionId: optionIdRaw || String.fromCharCode(65 + optionIndex),
        text,
      }
    })

    let correctIndex = Number.isInteger(row.correctIndex) ? (row.correctIndex as number) : -1

    if (correctIndex < 0) {
      const correctAnswerId = toStringValue(row.correctAnswerId)
      if (!correctAnswerId) {
        throw new Error(`Question ${index + 1} must include correctAnswerId or correctIndex.`)
      }
      const found = options.findIndex(
        (option) => option.optionId.toLowerCase() === correctAnswerId.toLowerCase(),
      )
      if (found < 0) {
        throw new Error(`Question ${index + 1} correctAnswerId does not match any optionId.`)
      }
      correctIndex = found
    }

    if (correctIndex >= options.length) {
      throw new Error(`Question ${index + 1} has a correct answer index out of range.`)
    }

    const marksRaw = toNumber(row.marks)
    const marks = Number.isFinite(marksRaw) && marksRaw > 0 ? marksRaw : 1

    return {
      prompt,
      options: options.map((option) => option.text),
      correctIndex,
      marks,
    }
  })
}

export async function createQuizFromImportForSessionUser(payload: unknown, sessionUser: AuthUser) {
  if (sessionUser.role !== "teacher") throw new Error("Forbidden")

  const body = asRecord(payload)
  if (!body) throw new Error("Invalid payload.")

  const metadata = asRecord(body.quizMetadata)
  const title = toStringValue(metadata?.title)
  if (!title) throw new Error("quizMetadata.title is required.")

  const questions = parseImportedQuestions(body.questions)
  const totalMarksFromQuestions = questions.reduce((sum, question) => sum + question.marks, 0)
  const metadataTotalMarks = toNumber(metadata?.totalMarks)
  const resolvedMaxMarks =
    Number.isFinite(metadataTotalMarks) && metadataTotalMarks > 0
      ? Math.round(metadataTotalMarks)
      : Math.max(1, Math.round(totalMarksFromQuestions))

  const dueDateValue = toStringValue(metadata?.dueDate) || new Date().toISOString().slice(0, 10)
  const dueDate = new Date(dueDateValue)
  if (Number.isNaN(dueDate.getTime())) throw new Error("quizMetadata.dueDate is invalid.")

  // The offering is the single source of truth for course/class, exactly as in
  // `createAssessmentForSessionUser`. A teacher who teaches the same course in
  // two offerings can no longer import into the wrong class: the client sends
  // the offering id, never a bare course id/name.
  const offeringId = toStringValue(body.offeringId)
  if (!offeringId) throw new Error("offeringId is required.")

  const staff = await prisma.staffProfile.findUnique({
    where: { userId: sessionUser.id },
    select: { id: true },
  })
  if (!staff) throw new Error("Teacher profile not found")

  const offering = await prisma.courseOffering.findFirst({
    where: { id: offeringId, teacherId: staff.id },
    select: {
      id: true,
      courseId: true,
      classId: true,
      course: { select: { name: true } },
    },
  })
  // A missing offering and another teacher's offering are deliberately the same
  // error, so the endpoint never confirms that someone else's offering exists.
  if (!offering) {
    throw new Error("Offering not found or not owned by you.")
  }

  const publishedAt = new Date()

  const created = await prisma.$transaction(async (tx) => {
    const assessment = await tx.assessment.create({
      data: {
        title,
        type: "QUIZ",
        dueDate,
        maxMarks: resolvedMaxMarks,
        offeringId: offering.id,
        courseId: offering.courseId,
        classId: offering.classId,
        createdById: staff.id,
      },
    })

    await tx.calendarEvent.create({
      data: {
        classId: offering.classId,
        offeringId: offering.id,
        assessmentId: assessment.id,
        title: assessment.title,
        description: `Due: ${assessment.title}`,
        eventType: "ASSESSMENT",
        startAt: assessment.dueDate,
        isUpcoming: true,
      },
    })

    // Write the modern store: one *published* `Question` per imported question,
    // attributed to the importing teacher, with its `QuestionOption` rows. The
    // teacher is explicitly providing the quiz, so it lands published (not a
    // draft) and is immediately delivered and scored by the modern pipeline.
    for (const [index, question] of questions.entries()) {
      await tx.question.create({
        data: {
          assessmentId: assessment.id,
          type: "MULTIPLE_CHOICE",
          order: index,
          prompt: question.prompt,
          explanation: null,
          points: question.marks,
          status: "published",
          publishedAt,
          publishedById: staff.id,
          options: {
            create: question.options.map((text, optionIndex) => ({
              order: optionIndex,
              text,
              isCorrect: optionIndex === question.correctIndex,
            })),
          },
        },
      })
    }

    return { assessmentId: assessment.id }
  })

  return {
    id: created.assessmentId,
    title,
    courseName: offering.course.name,
    courseId: offering.courseId,
    offeringId: offering.id,
    questionCount: questions.length,
    maxMarks: resolvedMaxMarks,
    dueDate: dueDate.toISOString().slice(0, 10),
  }
}
