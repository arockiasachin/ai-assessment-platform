import type { LlmProvider } from "@/lib/llm"
import { searchMaterialChunks, type ChunkSearchHit } from "@/lib/vector"

/**
 * Topic retrieval for quiz generation.
 *
 * `similaritySearch` already knows how to embed a query and cosine-rank
 * `MaterialChunk`s; this wrapper adds the two rules the pod needs:
 *
 *  1. Scope to the assessment's own course. The embedding query is filtered by
 *     `courseId`, so a teacher can never retrieve another course's material.
 *  2. Scope to the teacher's offering. A course can be taught in several
 *     offerings; course-level material (`offeringId === null`) is shared, but
 *     another offering's material is dropped even though it shares the course.
 */

export const DEFAULT_MATERIAL_LIMIT = 6
const MAX_MATERIAL_LIMIT = 20

export type RetrievalScope = {
  courseId: string
  offeringId: string
}

export type RetrievalOptions = {
  /** Injected for tests; defaults to the process-wide provider from env. */
  provider?: LlmProvider
  /** Maximum excerpts returned (1-20). */
  limit?: number
}

function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) return DEFAULT_MATERIAL_LIMIT
  return Math.min(MAX_MATERIAL_LIMIT, Math.max(1, Math.trunc(limit)))
}

export async function retrieveMaterialChunks(
  scope: RetrievalScope,
  topic: string,
  options: RetrievalOptions = {},
): Promise<ChunkSearchHit[]> {
  const limit = clampLimit(options.limit)
  const candidates = await searchMaterialChunks(topic, {
    provider: options.provider,
    courseId: scope.courseId,
    // Over-fetch so the offering filter below still leaves enough excerpts.
    limit: Math.min(100, limit * 3),
  })
  return candidates
    .filter((hit) => hit.offeringId === null || hit.offeringId === scope.offeringId)
    .slice(0, limit)
}
