import type { Question, QuestionOption } from "@/lib/generated/prisma/client"
import type {
  QuizAttemptSummary,
  StudentQuizQuestion,
  TeacherQuizResponse,
} from "@/lib/contracts/quiz-attempts"

/**
 * Serializers for the quiz-attempt pod.
 *
 * `serializeStudentQuestion` is the pre-submission shape: it has no
 * `correctIndex`, no `correctOptionId`, no `isCorrect`, and no `explanation`.
 * The correct answer and explanation are only ever emitted by
 * `serializeTeacherResponse` (owned-teacher view) or by the post-submission
 * `scoreQuiz` result the service attaches to a submitted attempt.
 */

export type QuestionWithOptions = Question & { options: QuestionOption[] }

type AttemptRow = {
  id: string
  assessmentId: string
  attemptNumber: number
  status: string
  score: unknown
  maxScore: unknown
  startedAt: Date
  submittedAt: Date | null
}

export function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function readOptionIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === "string")
}

/** A key-free, explanation-free question for a student taking the quiz. */
export function serializeStudentQuestion(question: QuestionWithOptions): StudentQuizQuestion {
  return {
    id: question.id,
    order: question.order,
    prompt: question.prompt,
    points: Number(question.points),
    options: [...question.options]
      .sort((a, b) => a.order - b.order)
      .map((option) => ({ id: option.id, order: option.order, text: option.text })),
  }
}

export function serializeAttemptSummary(input: {
  attempt: AttemptRow
  assessmentTitle: string
  dueDate: Date
}): QuizAttemptSummary {
  const { attempt } = input
  return {
    id: attempt.id,
    assessmentId: attempt.assessmentId,
    assessmentTitle: input.assessmentTitle,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status as QuizAttemptSummary["status"],
    score: toNumberOrNull(attempt.score),
    maxScore: toNumberOrNull(attempt.maxScore),
    startedAt: attempt.startedAt.toISOString(),
    submittedAt: attempt.submittedAt?.toISOString() ?? null,
    dueDate: input.dueDate.toISOString(),
    isLate: attempt.submittedAt !== null && attempt.submittedAt.getTime() > input.dueDate.getTime(),
  }
}

/**
 * The owned-teacher per-question view. This is the only serializer that emits
 * the answer key (`correctOptionId`) and is reachable only behind
 * `requireRole("teacher")` plus an ownership check.
 */
export function serializeTeacherResponse(input: {
  question: QuestionWithOptions
  selectedOptionId: string | null
  isCorrect: boolean | null
  pointsAwarded: number | null
}): TeacherQuizResponse {
  const options = [...input.question.options].sort((a, b) => a.order - b.order)
  const correct = options.find((option) => option.isCorrect) ?? null
  const selected = options.find((option) => option.id === input.selectedOptionId) ?? null
  return {
    questionId: input.question.id,
    prompt: input.question.prompt,
    selectedOptionId: selected?.id ?? null,
    selectedText: selected?.text ?? null,
    isCorrect: input.isCorrect,
    pointsAwarded: input.pointsAwarded,
    maxPoints: 1,
    correctOptionId: correct?.id ?? "",
    correctText: correct?.text ?? "",
    explanation: input.question.explanation ?? null,
  }
}
