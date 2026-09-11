import type { AuthUser } from "@/lib/session"
import { prisma } from "@/lib/prisma"
import {
  scoreQuiz,
  QuizScoringError,
  type ScorableQuizQuestion,
  type ScoredQuiz,
} from "@/lib/quiz-scoring"
import {
  quizGradeRequestSchema,
  type QuizGradeRequest,
  type PublishedQuizQuestion,
  type PublishedQuizResponse,
  type QuizGradeResponse,
} from "@/lib/contracts"

import { QuizGenerationError } from "./errors"
import { readQuestionState } from "./state"
import { serializeQuestionForStudent, type QuestionWithOptions } from "./serialize"

/**
 * Learner-facing delivery and server-authoritative grading for generated
 * quizzes.
 *
 * Two rules from the product spec drive this module:
 *
 *  - **Correct answers never reach the client.** The delivery view is built by
 *    `serializeQuestionForStudent`, which carries only option id/order/text.
 *  - **Grading is server-authoritative and reuses the existing path.** This
 *    module does not re-implement correctness: it maps published
 *    `Question`/`QuestionOption` rows onto the shared `scoreQuiz` kernel from
 *    `lib/quiz-scoring.ts` (the same kernel `lib/quiz-grading.ts` uses), so the
 *    key is disclosed only in the post-submission result.
 */

const publishedQuestionSelect = {
  orderBy: { order: "asc" as const },
  select: {
    id: true,
    assessmentId: true,
    order: true,
    prompt: true,
    explanation: true,
    subtopic: true,
    difficulty: true,
    metadata: true,
    createdAt: true,
    updatedAt: true,
    options: {
      orderBy: { order: "asc" as const },
      select: {
        id: true,
        questionId: true,
        order: true,
        text: true,
        isCorrect: true,
        rationale: true,
        createdAt: true,
      },
    },
  },
} as const

type DeliverableAssessment = {
  id: string
  title: string
  type: string
  maxMarks: number
  createdById: string
  offeringId: string
  offering: { id: string; teacherId: string } | null
  questions: QuestionWithOptions[]
}

async function assertCanAccessAssessment(
  assessment: DeliverableAssessment,
  requester: AuthUser,
): Promise<void> {
  if (requester.role === "admin") return
  if (assessment.type !== "QUIZ") {
    throw new QuizGenerationError(409, "This assessment is not a quiz.")
  }
  if (!assessment.offering) {
    throw new QuizGenerationError(409, "Assessment has no offering.")
  }

  if (requester.role === "teacher") {
    const staff = await prisma.staffProfile.findUnique({
      where: { userId: requester.id },
      select: { id: true },
    })
    if (
      !staff ||
      (assessment.offering.teacherId !== staff.id && assessment.createdById !== staff.id)
    ) {
      throw new QuizGenerationError(403, "Forbidden")
    }
    return
  }

  if (requester.role === "student") {
    const student = await prisma.studentProfile.findUnique({
      where: { userId: requester.id },
      select: { id: true },
    })
    if (!student) throw new QuizGenerationError(403, "Student profile not found.")
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        studentId_offeringId: { studentId: student.id, offeringId: assessment.offering.id },
      },
      select: { status: true },
    })
    if (!enrollment || (enrollment.status !== "active" && enrollment.status !== "waitlisted")) {
      throw new QuizGenerationError(403, "You are not enrolled in this quiz.")
    }
    return
  }

  throw new QuizGenerationError(403, "Forbidden")
}

async function loadAssessment(assessmentId: string): Promise<DeliverableAssessment> {
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      id: true,
      title: true,
      type: true,
      maxMarks: true,
      createdById: true,
      offeringId: true,
      offering: { select: { id: true, teacherId: true } },
      questions: publishedQuestionSelect,
    },
  })
  if (!assessment) throw new QuizGenerationError(404, "Assessment not found.")
  return assessment
}

function publishedOnly(questions: readonly QuestionWithOptions[]): QuestionWithOptions[] {
  return questions.filter((question) => readQuestionState(question.metadata) === "PUBLISHED")
}

/** The keyless delivery view: only published questions, and no correctness data. */
export async function listPublishedQuizForLearner(
  requester: AuthUser,
  assessmentId: string,
): Promise<PublishedQuizResponse> {
  const assessment = await loadAssessment(assessmentId)
  await assertCanAccessAssessment(assessment, requester)
  const questions: PublishedQuizQuestion[] = publishedOnly(assessment.questions).map(
    serializeQuestionForStudent,
  )
  return { assessmentId: assessment.id, title: assessment.title, questions }
}

function toScorable(question: QuestionWithOptions): ScorableQuizQuestion {
  const options = [...question.options].sort((a, b) => a.order - b.order)
  const correctIndex = options.findIndex((option) => option.isCorrect)
  return {
    id: question.id,
    prompt: question.prompt,
    options: options.map((option) => option.text),
    correctIndex,
    explanation: question.explanation,
  }
}

/**
 * Grade a learner's answers against the published question set. Correctness is
 * derived server-side via `scoreQuiz`; the caller sends only its selections.
 */
export async function gradeGeneratedQuiz(
  requester: AuthUser,
  input: QuizGradeRequest,
): Promise<Omit<QuizGradeResponse, "success">> {
  const request = quizGradeRequestSchema.parse(input)
  const assessment = await loadAssessment(request.assessmentId)
  await assertCanAccessAssessment(assessment, requester)

  if (requester.role === "student" && request.studentId) {
    const own = await prisma.studentProfile.findUnique({
      where: { userId: requester.id },
      select: { id: true },
    })
    if (!own || request.studentId !== own.id) throw new QuizGenerationError(403, "Forbidden")
  }

  const questions = publishedOnly(assessment.questions)
  if (questions.length === 0) {
    throw new QuizGenerationError(409, "This quiz has no published questions yet.")
  }

  const scorable = questions.map(toScorable)

  let scored: ScoredQuiz
  try {
    scored = scoreQuiz(scorable, request.answers, assessment.maxMarks)
  } catch (error) {
    if (error instanceof QuizScoringError) throw new QuizGenerationError(400, error.message)
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
