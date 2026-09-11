import type { QuestionOption } from "@/lib/generated/prisma/client"
import type {
  PublishedQuizOption,
  PublishedQuizQuestion,
  QuizGenerationQuestionResponse,
} from "@/lib/contracts"

import { readQuizGenerationMeta } from "./state"

/**
 * Response serializers.
 *
 * `serializeQuestionForOwner` is the teacher/owner view and includes the answer
 * key (`isCorrect`), the per-option misconceptions (`rationale`), and the
 * explanation — a teacher must be able to review and edit those before
 * publishing. `serializeQuestionForStudent` is the delivery view and drops all
 * three, so the answer key can only ever be produced by a server-side grade.
 */

/**
 * The structural slice of a `Question` row a serializer needs. Kept structural
 * (rather than the full generated type) so callers can select only these columns.
 */
export type QuestionWithOptions = {
  id: string
  assessmentId: string
  order: number
  prompt: string
  explanation: string | null
  subtopic: string | null
  difficulty: number | null
  metadata: unknown
  createdAt: Date
  options: QuestionOption[]
}

function optionsByOrder(options: readonly QuestionOption[]): QuestionOption[] {
  return [...options].sort((a, b) => a.order - b.order)
}

export function serializeQuestionForOwner(
  question: QuestionWithOptions,
): QuizGenerationQuestionResponse {
  const meta = readQuizGenerationMeta(question.metadata)
  return {
    id: question.id,
    assessmentId: question.assessmentId,
    order: question.order,
    prompt: question.prompt,
    explanation: question.explanation,
    subtopic: question.subtopic,
    difficulty: question.difficulty,
    state: meta?.state ?? "DRAFT",
    promptVersion: meta?.promptVersion ?? null,
    createdAt: question.createdAt.toISOString(),
    options: optionsByOrder(question.options).map((option) => ({
      id: option.id,
      order: option.order,
      text: option.text,
      isCorrect: option.isCorrect,
      rationale: option.rationale,
    })),
  }
}

export function serializeQuestionForStudent(question: QuestionWithOptions): PublishedQuizQuestion {
  return {
    id: question.id,
    prompt: question.prompt,
    subtopic: question.subtopic,
    difficulty: question.difficulty,
    options: optionsByOrder(question.options).map((option): PublishedQuizOption => ({
      id: option.id,
      order: option.order,
      text: option.text,
    })),
  }
}
