import type { Prisma } from "@/lib/generated/prisma/client"
import type { GeneratedQuestionStatus } from "@/lib/contracts/quiz-generation"

/**
 * Draft-vs-published state and provenance for generated questions.
 *
 * The state machine used to live entirely in `Question.metadata` JSON because
 * the schema was frozen. `Question` now has explicit `status`, `publishedAt`,
 * and `publishedById` columns, so writers persist state there. `metadata` keeps
 * the provenance envelope (model, prompt version, retrieved chunk ids) only.
 *
 * Backward compatibility: rows written before the columns existed still carry
 * `generationStatus` / `publishedAt` / `publishedByStaffId` inside the JSON
 * envelope, and hand-authored questions (no generator marker at all) are
 * treated as published. `resolveGenerationStatus` reads the column first, then
 * the legacy JSON keys, so both representations keep working.
 */

export const QUIZ_GENERATION_MARKER = "quiz-generation"

/**
 * The only assessment kind generated questions may be attached to (TN-40).
 *
 * The generator offered `GROUP_PROJECT`, `CODE` and `DESCRIPTIVE` as targets and would attach
 * `Question` rows to them; the student payload then reported `quizQuestionCount` on a group
 * project, and no pipeline could ever score those questions. The rule is stated here, next to the
 * draft/published marker, and read by both the target list and the ownership loader — one
 * definition, not one per entry point.
 */
export const GENERATED_QUESTION_ASSESSMENT_TYPE = "QUIZ"

/** Whether this assessment kind accepts generated quiz questions. */
export function acceptsGeneratedQuestions(type: string): boolean {
  return type === GENERATED_QUESTION_ASSESSMENT_TYPE
}

export type GeneratedQuestionMetadata = {
  generator: typeof QUIZ_GENERATION_MARKER
  promptVersion: string
  model: string
  provider: string
  generationId: string
  topic: string
  sourceChunkIds: string[]
  createdByStaffId: string
  /** Legacy, read-only: superseded by `Question.status`. */
  generationStatus?: GeneratedQuestionStatus
  /** Legacy, read-only: superseded by `Question.publishedAt`. */
  publishedAt?: string
  /** Legacy, read-only: superseded by `Question.publishedById`. */
  publishedByStaffId?: string
}

/** The provenance subset written to `Question.metadata` for new questions. */
export type GeneratedQuestionProvenance = Omit<
  GeneratedQuestionMetadata,
  "generationStatus" | "publishedAt" | "publishedByStaffId"
>

/** The columns that carry (or used to carry) draft/published state. */
export type QuestionPublishColumns = {
  status: string | null
  publishedAt?: Date | string | null
  publishedById?: string | null
  metadata: unknown
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === "string")
}

function normalizeStatus(value: unknown): GeneratedQuestionStatus | null {
  return value === "published" || value === "draft" ? value : null
}

/** Read the generation envelope, or `null` when this is not a generated question. */
export function readGenerationMetadata(value: unknown): GeneratedQuestionMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.generator !== QUIZ_GENERATION_MARKER) return null

  const metadata: GeneratedQuestionMetadata = {
    generator: QUIZ_GENERATION_MARKER,
    promptVersion: asString(record.promptVersion),
    model: asString(record.model),
    provider: asString(record.provider),
    generationId: asString(record.generationId),
    topic: asString(record.topic),
    sourceChunkIds: asStringArray(record.sourceChunkIds),
    createdByStaffId: asString(record.createdByStaffId),
  }

  const legacyStatus = normalizeStatus(record.generationStatus)
  if (legacyStatus) metadata.generationStatus = legacyStatus
  const publishedAt = asString(record.publishedAt)
  if (publishedAt) metadata.publishedAt = publishedAt
  const publishedByStaffId = asString(record.publishedByStaffId)
  if (publishedByStaffId) metadata.publishedByStaffId = publishedByStaffId

  return metadata
}

/**
 * Is this a generated question (as opposed to a hand-authored one)? True when
 * the explicit `status` column or the legacy JSON marker is present.
 */
export function isGeneratedQuestion(question: QuestionPublishColumns): boolean {
  return (
    normalizeStatus(question.status) !== null || readGenerationMetadata(question.metadata) !== null
  )
}

/**
 * The resolved draft/published state: the `status` column wins, then the legacy
 * JSON envelope. `null` means "not a generated question".
 */
export function resolveGenerationStatus(
  question: QuestionPublishColumns,
): GeneratedQuestionStatus | null {
  const columnStatus = normalizeStatus(question.status)
  if (columnStatus) return columnStatus
  return readGenerationMetadata(question.metadata)?.generationStatus ?? null
}

/**
 * The resolved publish timestamp: the column wins, then the legacy JSON value.
 */
export function resolvePublishedAt(question: QuestionPublishColumns): string | null {
  if (question.publishedAt) {
    return question.publishedAt instanceof Date
      ? question.publishedAt.toISOString()
      : new Date(question.publishedAt).toISOString()
  }
  return readGenerationMetadata(question.metadata)?.publishedAt ?? null
}

/**
 * The resolved publisher: the column wins, then the legacy JSON value falls
 * back to the staff id recorded when the draft was generated.
 */
export function resolvePublishedById(question: QuestionPublishColumns): string | null {
  if (question.publishedById !== undefined && question.publishedById !== null) {
    return question.publishedById
  }
  const metadata = readGenerationMetadata(question.metadata)
  return metadata?.publishedByStaffId ?? metadata?.createdByStaffId ?? null
}

/** Serialize the provenance envelope for `Question.metadata`. */
export function toQuestionMetadata(metadata: GeneratedQuestionProvenance): Prisma.InputJsonValue {
  return metadata as unknown as Prisma.InputJsonValue
}
