import type { Prisma } from "@/lib/generated/prisma/client"
import type { GeneratedQuestionStatus } from "@/lib/contracts/quiz-generation"

/**
 * Draft-vs-published state for generated questions.
 *
 * `prisma/schema.prisma` is frozen and `Question` has no publish column, so the
 * generation envelope lives in the existing `Question.metadata` JSON field.
 * Treating it as a typed envelope keeps the state machine explicit and means a
 * question that lacks this marker (e.g. one created by some future importer) is
 * never mistaken for a generated draft.
 */

export const QUIZ_GENERATION_MARKER = "quiz-generation"

export type GeneratedQuestionMetadata = {
  generator: typeof QUIZ_GENERATION_MARKER
  generationStatus: GeneratedQuestionStatus
  promptVersion: string
  model: string
  provider: string
  generationId: string
  topic: string
  sourceChunkIds: string[]
  createdByStaffId: string
  publishedAt?: string
  publishedByStaffId?: string
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === "string")
}

/** Read the generation envelope, or `null` when this is not a generated question. */
export function readGenerationMetadata(value: unknown): GeneratedQuestionMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.generator !== QUIZ_GENERATION_MARKER) return null

  const status: GeneratedQuestionStatus =
    record.generationStatus === "published" ? "published" : "draft"

  const metadata: GeneratedQuestionMetadata = {
    generator: QUIZ_GENERATION_MARKER,
    generationStatus: status,
    promptVersion: asString(record.promptVersion),
    model: asString(record.model),
    provider: asString(record.provider),
    generationId: asString(record.generationId),
    topic: asString(record.topic),
    sourceChunkIds: asStringArray(record.sourceChunkIds),
    createdByStaffId: asString(record.createdByStaffId),
  }

  const publishedAt = asString(record.publishedAt)
  if (publishedAt) metadata.publishedAt = publishedAt
  const publishedByStaffId = asString(record.publishedByStaffId)
  if (publishedByStaffId) metadata.publishedByStaffId = publishedByStaffId

  return metadata
}

/** Serialize the envelope for `Question.metadata`. */
export function toQuestionMetadata(metadata: GeneratedQuestionMetadata): Prisma.InputJsonValue {
  return metadata as unknown as Prisma.InputJsonValue
}
