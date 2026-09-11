import "server-only"

import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"
import {
  markKey,
  type Assessment,
  type Course,
  type MarksMap,
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
}

type DbAssessmentType = "QUIZ" | "ASSIGNMENT"

function toUiAssessmentType(type: DbAssessmentType) {
  return type === "QUIZ" ? "Quiz" : "Assignment"
}

function toAssessmentUpcomingEvent(assessment: {
  id: string
  title: string
  dueDate: Date
  courseId: string
  classId: string
  type: DbAssessmentType
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
    assessmentType: toUiAssessmentType(assessment.type),
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
            quiz: {
              include: {
                questions: { orderBy: { order: "asc" } },
              },
            },
            grades: true,
          },
          orderBy: { dueDate: "asc" },
        },
      },
      orderBy: [{ academicYear: "desc" }, { term: "asc" }],
    })

    const coursePool: Course[] = uniqById(
      offerings.map((o) => ({ id: o.course.id, code: o.course.code, name: o.course.name })),
    )

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
      type: toUiAssessmentType(a.type as DbAssessmentType),
      date: a.dueDate.toISOString().slice(0, 10),
      maxMarks: a.maxMarks,
      offeringId: a.offeringId,
      classId: a.classId,
    }))

    const marks: MarksMap = {}
    for (const a of assessmentPool) {
      for (const g of a.grades) {
        marks[markKey(g.studentId, a.id)] = Number(g.marksObtained)
      }
    }

    const quizzes: Quiz[] = assessmentPool
      .filter((a) => a.quiz)
      .map((a) => ({
        assessmentId: a.id,
        questions: (a.quiz?.questions ?? []).map((q) => ({
          id: q.id,
          prompt: q.prompt,
          options: Array.isArray(q.optionsJson) ? (q.optionsJson as string[]) : [],
        })),
      }))

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
      assessmentType: event.assessment
        ? toUiAssessmentType(event.assessment.type as DbAssessmentType)
        : null,
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
          type: assessment.type as DbAssessmentType,
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
              enrollments: {
                include: {
                  student: {
                    include: { user: true },
                  },
                },
              },
              assessments: {
                include: {
                  course: true,
                  quiz: {
                    include: {
                      questions: { orderBy: { order: "asc" } },
                    },
                  },
                  grades: true,
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

  const students: Student[] = uniqById(
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
    type: toUiAssessmentType(a.type as DbAssessmentType),
    date: a.dueDate.toISOString().slice(0, 10),
    maxMarks: a.maxMarks,
    offeringId: a.offeringId,
    classId: a.classId,
  }))

  const marks: MarksMap = {}
  for (const a of assessmentPool) {
    for (const g of a.grades) {
      marks[markKey(g.studentId, a.id)] = Number(g.marksObtained)
    }
  }

  const quizzes: Quiz[] = assessmentPool
    .filter((a) => a.quiz)
    .map((a) => ({
      assessmentId: a.id,
      questions: (a.quiz?.questions ?? []).map((q) => ({
        id: q.id,
        prompt: q.prompt,
        options: Array.isArray(q.optionsJson) ? (q.optionsJson as string[]) : [],
      })),
    }))

  const offeringIds = offerings.map((o) => o.id)
  const upcomingRows = offeringIds.length
    ? await prisma.calendarEvent.findMany({
        where: {
          offeringId: { in: offeringIds },
          isUpcoming: true,
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
    assessmentType: event.assessment
      ? toUiAssessmentType(event.assessment.type as DbAssessmentType)
      : null,
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
        type: assessment.type as DbAssessmentType,
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
    await prisma.assessmentGrade.deleteMany({
      where: {
        studentId: input.studentId,
        assessmentId: input.assessmentId,
      },
    })
    return
  }

  const normalized = Math.max(0, Math.min(assessment.maxMarks, input.score))

  await prisma.assessmentGrade.upsert({
    where: {
      assessmentId_studentId: {
        assessmentId: input.assessmentId,
        studentId: input.studentId,
      },
    },
    create: {
      assessmentId: input.assessmentId,
      studentId: input.studentId,
      marksObtained: normalized,
    },
    update: {
      marksObtained: normalized,
      gradedAt: new Date(),
    },
  })
}

export async function createAssessmentForSessionUser(
  input: {
    title: string
    courseId: string
    type: "Quiz" | "Assignment"
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

  const offering = await prisma.courseOffering.findFirst({
    where: { courseId: input.courseId, teacherId: staff.id },
    orderBy: [{ academicYear: "desc" }, { term: "asc" }],
  })

  if (!offering) throw new Error("No matching course offering")

  const created = await prisma.$transaction(async (tx) => {
    const assessment = await tx.assessment.create({
      data: {
        title: input.title.trim(),
        type: input.type === "Quiz" ? "QUIZ" : "ASSIGNMENT",
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
    type: toUiAssessmentType(created.type as DbAssessmentType),
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

  const courseId = toStringValue(metadata?.courseId)
  const courseNameOrCode = toStringValue(metadata?.course)

  const staff = await prisma.staffProfile.findUnique({
    where: { userId: sessionUser.id },
    select: { id: true },
  })
  if (!staff) throw new Error("Teacher profile not found")

  const offerings = await prisma.courseOffering.findMany({
    where: { teacherId: staff.id },
    include: {
      course: { select: { id: true, name: true, code: true } },
    },
    orderBy: [{ academicYear: "desc" }, { term: "asc" }],
  })

  if (!offerings.length) {
    throw new Error("No course offerings found for this teacher.")
  }

  let offering = offerings.find((item) => item.courseId === courseId)
  if (!offering && courseNameOrCode) {
    const needle = courseNameOrCode.toLowerCase()
    offering = offerings.find((item) => {
      return item.course.name.toLowerCase() === needle || item.course.code.toLowerCase() === needle
    })
  }

  if (!offering) {
    throw new Error(
      "Unable to match quizMetadata.courseId or quizMetadata.course to one of your courses.",
    )
  }

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

    const quiz = await tx.quiz.create({
      data: {
        assessmentId: assessment.id,
      },
    })

    await tx.quizQuestion.createMany({
      data: questions.map((question, index) => ({
        quizId: quiz.id,
        prompt: question.prompt,
        optionsJson: question.options,
        correctIndex: question.correctIndex,
        order: index + 1,
      })),
    })

    return { assessmentId: assessment.id }
  })

  return {
    id: created.assessmentId,
    title,
    courseName: offering.course.name,
    courseId: offering.courseId,
    questionCount: questions.length,
    maxMarks: resolvedMaxMarks,
    dueDate: dueDate.toISOString().slice(0, 10),
  }
}
