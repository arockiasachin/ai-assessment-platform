import "server-only"

import type { AssessmentType } from "@/lib/generated/prisma/enums"
import type { CreateAssessmentRequest } from "@/lib/contracts"
import { prisma } from "@/lib/prisma"
import { recordManualMark } from "@/lib/grading/review-service"
import { quizDeliveryStatus } from "@/lib/quiz-attempts/metadata"
import type { AuthUser } from "@/lib/session"
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
                // the payload — the SN-29 leak.
                where: { releasedAt: { not: null } },
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

  const offerings = studentProfile.enrollments.map((e) => e.offering)

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
          // out, but its calendar event still travelled in the payload.
          OR: [{ assessmentId: null }, { assessment: { is: { releasedAt: { not: null } } } }],
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
) {
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

  const created = await prisma.$transaction(async (tx) => {
    const assessment = await tx.assessment.create({
      data: {
        title: input.title.trim(),
        // Identity: the request carries the enum's own vocabulary (see the contract).
        type: input.type,
        dueDate: new Date(input.date),
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

    return assessment
  })

  return {
    id: created.id,
    title: created.title,
    courseId: created.courseId,
    courseName: created.course.name,
    type: created.type,
    date: created.dueDate.toISOString().slice(0, 10),
    maxMarks: created.maxMarks,
    offeringId: created.offeringId,
    classId: created.classId,
  } as Assessment
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
