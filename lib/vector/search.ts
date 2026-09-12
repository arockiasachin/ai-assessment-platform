import { Prisma } from "@/lib/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import type { LlmEmbeddingProvider } from "@/lib/llm"
import { embedTexts, toVectorLiteral, type EmbedTextsResult } from "./embed"

export type ChunkSearchHit = {
  chunkId: string
  materialId: string
  materialTitle: string
  courseId: string
  offeringId: string | null
  chunkIndex: number
  content: string
  /** Cosine similarity in [-1, 1]; higher is closer. */
  similarity: number
}

export type SimilaritySearchOptions = {
  provider?: LlmEmbeddingProvider
  courseId?: string | null
  offeringId?: string | null
  materialId?: string | null
  /** Maximum hits returned (1-100). */
  limit?: number
  /** Drop hits below this cosine similarity. */
  minSimilarity?: number
  dimensions?: number
}

export type SimilaritySearchResult = {
  hits: ChunkSearchHit[]
  embedding: EmbedTextsResult
}

const MAX_LIMIT = 100

function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) return 8
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)))
}

/**
 * Cosine similarity search over MaterialChunk embeddings using pgvector's
 * `<=>` distance operator. Returns chunk text plus material metadata ready for
 * prompting, never raw vectors.
 */
export async function similaritySearch(
  query: string,
  options: SimilaritySearchOptions = {},
): Promise<SimilaritySearchResult> {
  const trimmed = query.trim()
  if (!trimmed) {
    return {
      hits: [],
      embedding: {
        embeddings: [],
        model: "",
        provider: options.provider?.name ?? "mock",
        dimensions: options.dimensions ?? 0,
        latencyMs: 0,
      },
    }
  }

  const embedded = await embedTexts([trimmed], {
    provider: options.provider,
    dimensions: options.dimensions,
  })
  const vector = toVectorLiteral(embedded.embeddings[0])

  const filters: Prisma.Sql[] = [Prisma.sql`mc."embedding" IS NOT NULL`]
  if (options.courseId) filters.push(Prisma.sql`m."courseId" = ${options.courseId}`)
  if (options.offeringId) filters.push(Prisma.sql`m."offeringId" = ${options.offeringId}`)
  if (options.materialId) filters.push(Prisma.sql`mc."materialId" = ${options.materialId}`)

  const where = Prisma.join(filters, " AND ")
  const limit = clampLimit(options.limit)

  const rows = await prisma.$queryRaw<ChunkSearchHit[]>(Prisma.sql`
    SELECT
      mc."id" AS "chunkId",
      mc."materialId" AS "materialId",
      m."title" AS "materialTitle",
      m."courseId" AS "courseId",
      m."offeringId" AS "offeringId",
      mc."chunkIndex" AS "chunkIndex",
      mc."content" AS "content",
      (1 - (mc."embedding" <=> ${vector}::vector))::float8 AS "similarity"
    FROM "MaterialChunk" mc
    INNER JOIN "Material" m ON m."id" = mc."materialId"
    WHERE ${where}
    ORDER BY mc."embedding" <=> ${vector}::vector
    LIMIT ${limit}
  `)

  const minSimilarity = options.minSimilarity ?? -1
  const hits = rows
    .map((row) => ({ ...row, similarity: Number(row.similarity) }))
    .filter((row) => row.similarity >= minSimilarity)

  return { hits, embedding: embedded }
}

/** Convenience wrapper for callers that only need the hits. */
export async function searchMaterialChunks(
  query: string,
  options: SimilaritySearchOptions = {},
): Promise<ChunkSearchHit[]> {
  const { hits } = await similaritySearch(query, options)
  return hits
}
