import type { Question, QuestionOption } from "@/lib/generated/prisma/client"
import type {
  GeneratedQuestionForStudent,
  GeneratedQuestionResponse,
} from "@/lib/contracts/quiz-generation"

import { readGenerationMetadata } from "./metadata"

/**
 * Question serializers.
 *
 * `serializeQuestionForTeacher` is the teacher-authoring view: it carries
 * `correctOptionId` so the owning teacher can inspect their draft, plus the
 * provenance (prompt version, model, retrieved chunks) the explainability rule
 * asks for. It is only ever reachable behind `requireRole("teacher")` and an
 * ownership check.
 *
 * `serializeQuestionForStudent` has no answer-key field at all. Nothing in this
 * module ever emits `QuestionOption.isCorrect` as a boolean; correctness is only
 * ever evaluated server-side by `lib/quiz-scoring`.
 */

export type QuestionWithOptions = Question & { options: QuestionOption[] }

function orderOptions(options: readonly QuestionOption[]): QuestionOption[] {
  return [...options].sort((a, b) => a.order - b.order)
}

export function serializeQuestionForTeacher(
  question: QuestionWithOptions,
): GeneratedQuestionResponse {
  const metadata = readGenerationMetadata(question.metadata)
  const options = orderOptions(question.options)
  const correct = options.find((option) => option.isCorrect) ?? null

  return {
    id: question.id,
    assessmentId: question.assessmentId,
    type: question.type,
    order: question.order,
    prompt: question.prompt,
    explanation: question.explanation ?? null,
    subtopic: question.subtopic ?? null,
    difficulty: question.difficulty ?? null,
    points: Number(question.points),
    status: metadata?.generationStatus ?? "draft",
    publishedAt: metadata?.publishedAt ?? null,
    promptVersion: metadata?.promptVersion || null,
    model: metadata?.model || null,
    topic: metadata?.topic || null,
    sourceChunkIds: metadata?.sourceChunkIds ?? [],
    options: options.map((option) => ({
      id: option.id,
      order: option.order,
      text: option.text,
      rationale: option.rationale ?? null,
    })),
    correctOptionId: correct?.id ?? null,
    createdAt: question.createdAt.toISOString(),
    updatedAt: question.updatedAt.toISOString(),
  }
}

/**
 * The student-facing projection. Deliberately omits `correctOptionId`,
 * `isCorrect`, the model, the prompt version, and the draft/published state.
 */
export function serializeQuestionForStudent(
  question: QuestionWithOptions,
): GeneratedQuestionForStudent {
  const options = orderOptions(question.options)
  return {
    id: question.id,
    assessmentId: question.assessmentId,
    order: question.order,
    type: question.type,
    prompt: question.prompt,
    explanation: question.explanation ?? null,
    subtopic: question.subtopic ?? null,
    difficulty: question.difficulty ?? null,
    points: Number(question.points),
    options: options.map((option) => ({
      id: option.id,
      order: option.order,
      text: option.text,
    })),
  }
}
