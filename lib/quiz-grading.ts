import type { AuthUser } from "@/lib/auth"
import type { QuizGradeRequest, QuizGradeResponse } from "@/lib/contracts/quiz"
import { quizGradeRequestSchema } from "@/lib/contracts/quiz"
import { prisma } from "@/lib/prisma"

import { scoreQuiz, QuizScoringError, type ScorableQuizQuestion } from "./quiz-scoring"

/**
 * Server-authoritative grading for the legacy quiz path.
 *
 * The gradebook payload no longer carries `correctIndex`; a browser can only
 * learn the answer key by submitting answers to this service, which grades
 * against the server's copy and enforces that the caller may grade for the
 * requested student. Grade persistence and partial credit are Phase 2 work;
 * this closes the answer-key leak without pre-empting that pod.
 */

export class QuizGradingError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409,
    message: string,
  ) {
    super(message)
    this.name = "QuizGradingError"
  }
}

type GradableAssessment = {
  id: string
  title: string
  type: string
  maxMarks: number
  createdById: string
  offering: { id: string; teacherId: string } | null
  quiz: {
    questions: Array<{
      id: string
      prompt: string
      optionsJson: unknown
      correctIndex: number
    }>
  } | null
}

async function resolveStudentId(requested: string | undefined, requester: AuthUser) {
  if (requester.role === "student") {
    // Students can only ever be graded as themselves, whatever the body says.
    const own = await prisma.studentProfile.findUnique({
      where: { userId: requester.id },
      select: { id: true },
    })
    if (!own) throw new QuizGradingError(403, "Student profile not found.")
    if (requested && requested !== own.id) throw new QuizGradingError(403, "Forbidden")
    return own.id
  }

  if (!requested) throw new QuizGradingError(400, "studentId is required.")
  return requested
}

async function assertCanGradeForStudent(
  assessment: GradableAssessment,
  studentId: string,
  requester: AuthUser,
) {
  if (!assessment.offering) throw new QuizGradingError(409, "Assessment has no offering.")

  if (requester.role === "teacher") {
    const staff = await prisma.staffProfile.findUnique({
      where: { userId: requester.id },
      select: { id: true },
    })
    if (!staff || assessment.offering.teacherId !== staff.id) {
      throw new QuizGradingError(403, "Forbidden")
    }
  }

  const student = await prisma.studentProfile.findUnique({
    where: { id: studentId },
    select: { id: true },
  })
  if (!student) throw new QuizGradingError(404, "Student not found.")

  const enrollment = await prisma.enrollment.findUnique({
    where: {
      studentId_offeringId: { studentId, offeringId: assessment.offering.id },
    },
    select: { status: true },
  })
  if (!enrollment || (enrollment.status !== "active" && enrollment.status !== "waitlisted")) {
    throw new QuizGradingError(403, "Student is not enrolled in this assessment.")
  }
}

export async function gradeQuizSubmission(
  input: QuizGradeRequest,
  requester: AuthUser,
): Promise<Omit<QuizGradeResponse, "success">> {
  const data = quizGradeRequestSchema.parse(input)

  const assessment = (await prisma.assessment.findUnique({
    where: { id: data.assessmentId },
    select: {
      id: true,
      title: true,
      type: true,
      maxMarks: true,
      createdById: true,
      offering: { select: { id: true, teacherId: true } },
      quiz: {
        select: {
          questions: {
            orderBy: { order: "asc" },
            select: { id: true, prompt: true, optionsJson: true, correctIndex: true },
          },
        },
      },
    },
  })) as GradableAssessment | null

  if (!assessment) throw new QuizGradingError(404, "Assessment not found.")
  if (assessment.type !== "QUIZ" || !assessment.quiz) {
    throw new QuizGradingError(409, "Assessment does not have a quiz.")
  }

  const studentId = await resolveStudentId(data.studentId, requester)
  await assertCanGradeForStudent(assessment, studentId, requester)

  // The legacy `QuizQuestion` model has no per-question weight, so every
  // question keeps the kernel's default weight of 1. That is the same default a
  // Phase-2 `Question` uses when `points` is absent, so both paths score a quiz
  // the same way.
  const questions: ScorableQuizQuestion[] = assessment.quiz.questions.map((question) => ({
    id: question.id,
    prompt: question.prompt,
    options: Array.isArray(question.optionsJson) ? (question.optionsJson as string[]) : [],
    correctIndex: question.correctIndex,
  }))

  let scored
  try {
    scored = scoreQuiz(questions, data.answers, assessment.maxMarks)
  } catch (error) {
    if (error instanceof QuizScoringError) throw new QuizGradingError(400, error.message)
    throw error
  }

  return {
    assessmentId: assessment.id,
    title: assessment.title,
    score: scored.score,
    maxScore: scored.maxScore,
    correctCount: scored.correctCount,
    totalQuestions: scored.totalQuestions,
    results: scored.results,
  }
}
