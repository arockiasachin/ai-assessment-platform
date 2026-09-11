import { z } from "zod"

import type { Prisma } from "@/lib/generated/prisma/client"

import type { QuizGenerationState } from "@/lib/contracts"

/**
 * Draft-vs-published state for generated questions.
 *
 * `prisma/schema.prisma` is frozen and `Question` has no publish column, so the
 * state lives in the existing `Question.metadata` JSON. The reader fails closed:
 * anything that is not a well-formed `quizGeneration` record is treated as
 * `DRAFT`, so a legacy or hand-written row can never become visible to students
 * merely because its metadata is missing or malformed.
 */

export const QUIZ_GENERATION_METADATA_KEY = "quizGeneration"

const metaSchema = z.object({
  state: z.enum(["DRAFT", "PUBLISHED"]),
  promptVersion: z.string().trim().min(1),
  model: z.string(),
  sourceChunkIds: z.array(z.string()),
  generatedAt: z.string(),
  publishedAt: z.string().nullable(),
})

export type QuizGenerationMeta = z.infer<typeof metaSchema>

/** Parse the `quizGeneration` block from a `Question.metadata` value, if present. */
export function readQuizGenerationMeta(metadata: unknown): QuizGenerationMeta | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
  const block = (metadata as Record<string, unknown>)[QUIZ_GENERATION_METADATA_KEY]
  const parsed = metaSchema.safeParse(block)
  return parsed.success ? parsed.data : null
}

/** Fail-closed state read: unknown metadata is an unpublished draft. */
export function readQuestionState(metadata: unknown): QuizGenerationState {
  return readQuizGenerationMeta(metadata)?.state ?? "DRAFT"
}

export type DraftMetadataInput = {
  promptVersion: string
  model: string
  sourceChunkIds: readonly string[]
  generatedAt: string
}

/** Build the `metadata` value for a freshly generated draft. */
export function buildDraftMetadata(input: DraftMetadataInput): Prisma.InputJsonValue {
  const meta: QuizGenerationMeta = {
    state: "DRAFT",
    promptVersion: input.promptVersion,
    model: input.model,
    sourceChunkIds: [...input.sourceChunkIds],
    generatedAt: input.generatedAt,
    publishedAt: null,
  }
  return { [QUIZ_GENERATION_METADATA_KEY]: meta }
}

/**
 * Merge a publish timestamp into an existing `metadata` object, marking the
 * question `PUBLISHED`. Any other metadata keys are preserved.
 */
export function withPublishedMetadata(
  metadata: unknown,
  publishedAt: string,
): Prisma.InputJsonValue {
  const existing =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {}
  const previous = readQuizGenerationMeta(metadata)
  const meta: QuizGenerationMeta = {
    state: "PUBLISHED",
    promptVersion: previous?.promptVersion ?? "unknown",
    model: previous?.model ?? "unknown",
    sourceChunkIds: previous?.sourceChunkIds ?? [],
    generatedAt: previous?.generatedAt ?? publishedAt,
    publishedAt,
  }
  return { ...existing, [QUIZ_GENERATION_METADATA_KEY]: meta }
}
