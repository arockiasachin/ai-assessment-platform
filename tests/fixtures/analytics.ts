import type { PrismaClient } from "@/lib/generated/prisma/client"
import type { AuthUser } from "@/lib/session"

import { createSpineFixture } from "./spine"

/**
 * Spine fixture plus an eligible roster and a four-question quiz, for the
 * analytics pod. Attempts are recorded through `recordAnalyticsAttempt` so each
 * test controls exactly which questions a student got right, wrong, or left
 * unanswered.
 */

export type AnalyticsStudent = {
  userId: string
  email: string
  profileId: string
  fullName: string
  registerNumber: string
}

export type AnalyticsQuestion = {
  id: string
  order: number
  options: { id: string; isCorrect: boolean }[]
}

export async function createAnalyticsFixture(
  prisma: PrismaClient,
  options: { studentCount?: number; questionCount?: number } = {},
) {
  const spine = await createSpineFixture(prisma)
  const studentCount = options.studentCount ?? 20
  const questionCount = options.questionCount ?? 4
  const students: AnalyticsStudent[] = []

  for (let index = 0; index < studentCount; index += 1) {
    const user = await prisma.user.create({
      data: {
        email: `analytics-student-${index}@test.local`,
        passwordHash: "test-only-not-a-real-hash",
        role: "STUDENT",
        studentProfile: {
          create: {
            fullName: `Analytics Student ${index}`,
            registerNumber: `REG-ANALYTICS-${index}`,
          },
        },
      },
      include: { studentProfile: true },
    })
    const profile = user.studentProfile!
    students.push({
      userId: user.id,
      email: user.email,
      profileId: profile.id,
      fullName: profile.fullName,
      registerNumber: profile.registerNumber,
    })
    await prisma.enrollment.create({
      data: { studentId: profile.id, offeringId: spine.offering.id, status: "active" },
    })
  }

  const questions: AnalyticsQuestion[] = []
  for (let order = 1; order <= questionCount; order += 1) {
    const question = await prisma.question.create({
      data: {
        assessmentId: spine.assessment.id,
        order,
        prompt: `Question ${order}`,
        type: "MULTIPLE_CHOICE",
        points: 1,
        options: {
          create: [1, 2, 3, 4].map((optionOrder) => ({
            order: optionOrder,
            text: `Q${order} option ${optionOrder}`,
            isCorrect: optionOrder === 1,
          })),
        },
      },
      include: { options: { orderBy: { order: "asc" } } },
    })
    questions.push({
      id: question.id,
      order,
      options: question.options.map((option) => ({ id: option.id, isCorrect: option.isCorrect })),
    })
  }

  return { ...spine, students, questions }
}

export type AttemptFlags = (boolean | null)[]

/**
 * Record a finalized attempt. A `null` flag means the question was left
 * unanswered, so no `QuizResponse` row is created for it — matching how a real
 * skipped question appears.
 */
export async function recordAnalyticsAttempt(
  prisma: PrismaClient,
  args: {
    assessmentId: string
    studentId: string
    questions: AnalyticsQuestion[]
    flags: AttemptFlags
    attemptNumber?: number
  },
): Promise<{ id: string }> {
  const { assessmentId, studentId, questions, flags, attemptNumber = 1 } = args
  const responses = questions.flatMap((question, index) => {
    const flag = flags[index]
    if (flag === undefined || flag === null) return []
    const correct = question.options.find((option) => option.isCorrect)
    const wrong = question.options.find((option) => !option.isCorrect)
    if (!correct || !wrong) return []
    return [
      {
        questionId: question.id,
        selectedOptionIds: [flag ? correct.id : wrong.id],
        isCorrect: flag,
        pointsAwarded: flag ? 1 : 0,
      },
    ]
  })

  const attempt = await prisma.quizAttempt.create({
    data: {
      assessmentId,
      studentId,
      attemptNumber,
      status: "SUBMITTED",
      score: flags.filter((flag) => flag === true).length,
      maxScore: questions.length,
      submittedAt: new Date(),
      responses: { create: responses },
    },
    select: { id: true },
  })
  return attempt
}

export async function createPendingReview(
  prisma: PrismaClient,
  args: { assessmentId: string; studentId: string; status?: "PENDING" | "NEEDS_REVIEW" },
) {
  return prisma.gradeReview.create({
    data: {
      assessmentId: args.assessmentId,
      studentId: args.studentId,
      status: args.status ?? "PENDING",
    },
  })
}

export function analyticsTeacherSession(spine: {
  teacher: { id: string; email: string }
}): AuthUser {
  return { id: spine.teacher.id, email: spine.teacher.email, role: "teacher" }
}

export function analyticsStudentSession(student: AnalyticsStudent): AuthUser {
  return { id: student.userId, email: student.email, role: "student" }
}
