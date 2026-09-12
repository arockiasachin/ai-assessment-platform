import type { LlmEmbeddingProvider } from "@/lib/llm"
import { searchMaterialChunks, type ChunkSearchHit } from "@/lib/vector"

/**
 * Topic retrieval for quiz generation.
 *
 * The scope is derived from the owned assessment's `(courseId, offeringId)`,
 * never from the request body. Two tiers are searched and merged:
 *
 *  1. chunks attached directly to the teacher's own offering, and
 *  2. course-wide chunks (materials with no offering), which are shared across
 *     the course.
 *
 * Everything comes back through `lib/vector/search.ts` (pgvector cosine
 * search); no raw vectors ever leave this module.
 */

export type TopicRetrieval = {
  hits: ChunkSearchHit[]
  sourceTitles: string[]
}

export type RetrieveTopicOptions = {
  /** Embeddings provider for the query vector; defaults to `EMBEDDINGS_PROVIDER`. */
  provider?: LlmEmbeddingProvider
  /** Maximum merged hits (default 8, capped at 20). */
  limit?: number
}

export type RetrievalScope = {
  courseId: string
  offeringId: string
}

const DEFAULT_LIMIT = 8
const MAX_LIMIT = 20

function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)))
}

export async function retrieveTopicMaterial(
  scope: RetrievalScope,
  topic: string,
  options: RetrieveTopicOptions = {},
): Promise<TopicRetrieval> {
  const limit = clampLimit(options.limit)

  const [offeringHits, courseHits] = await Promise.all([
    searchMaterialChunks(topic, {
      provider: options.provider,
      offeringId: scope.offeringId,
      limit,
    }),
    searchMaterialChunks(topic, {
      provider: options.provider,
      courseId: scope.courseId,
      limit,
    }),
  ])

  const byChunkId = new Map<string, ChunkSearchHit>()
  for (const hit of [...offeringHits, ...courseHits]) {
    const existing = byChunkId.get(hit.chunkId)
    if (!existing || hit.similarity > existing.similarity) {
      byChunkId.set(hit.chunkId, hit)
    }
  }

  const hits = [...byChunkId.values()].sort((a, b) => b.similarity - a.similarity).slice(0, limit)

  const sourceTitles = [...new Set(hits.map((hit) => hit.materialTitle))]

  return { hits, sourceTitles }
}
