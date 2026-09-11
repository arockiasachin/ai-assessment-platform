import type { Prisma } from "@/lib/generated/prisma/client"

/**
 * `CodeTask.metadata` envelope.
 *
 * `prisma/schema.prisma` is frozen, so the fields this pod needs that have no
 * column live in the existing `CodeTask.metadata` JSON:
 *
 *  - `maxSubmissions` — the server-side submission cap.
 *  - `draftTestCaseIds` — generated test cases awaiting teacher review. A test
 *    case is `draft` while its id is in this list and `active` otherwise.
 *  - `generation` — model/prompt provenance for the last draft batch.
 *
 * A `CodeTask` without this marker is treated as a hand-authored task with the
 * default cap and no drafts, so an importer-created task is never misread.
 */

export const CODE_EVAL_GENERATOR = "code-eval"
export const DEFAULT_MAX_SUBMISSIONS = 10

export type CodeEvalGeneration = {
  promptVersion: string
  model: string
  provider: string
  generationId: string
  createdAt: string
  createdByStaffId: string
  count: number
}

export type CodeEvalMetadata = {
  generator: typeof CODE_EVAL_GENERATOR
  maxSubmissions: number
  draftTestCaseIds: string[]
  generation?: CodeEvalGeneration
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === "string")
}

/** Read the code-eval envelope, or `null` when this is not a code-eval task. */
export function readCodeEvalMetadata(value: unknown): CodeEvalMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.generator !== CODE_EVAL_GENERATOR) return null

  const metadata: CodeEvalMetadata = {
    generator: CODE_EVAL_GENERATOR,
    maxSubmissions: Math.max(
      1,
      Math.floor(asNumber(record.maxSubmissions, DEFAULT_MAX_SUBMISSIONS)),
    ),
    draftTestCaseIds: asStringArray(record.draftTestCaseIds),
  }

  const generation = record.generation
  if (generation && typeof generation === "object" && !Array.isArray(generation)) {
    const g = generation as Record<string, unknown>
    metadata.generation = {
      promptVersion: asString(g.promptVersion),
      model: asString(g.model),
      provider: asString(g.provider),
      generationId: asString(g.generationId),
      createdAt: asString(g.createdAt),
      createdByStaffId: asString(g.createdByStaffId),
      count: Math.max(0, Math.floor(asNumber(g.count, 0))),
    }
  }

  return metadata
}

/** The submission cap for a task, defaulting when no envelope exists. */
export function resolveMaxSubmissions(value: unknown): number {
  return readCodeEvalMetadata(value)?.maxSubmissions ?? DEFAULT_MAX_SUBMISSIONS
}

/** The ids of generated test cases still awaiting teacher review. */
export function resolveDraftTestCaseIds(value: unknown): Set<string> {
  return new Set(readCodeEvalMetadata(value)?.draftTestCaseIds ?? [])
}

/** Serialize the envelope for `CodeTask.metadata`. */
export function toCodeTaskMetadata(metadata: CodeEvalMetadata): Prisma.InputJsonValue {
  return metadata as unknown as Prisma.InputJsonValue
}
