import { prisma } from "@/lib/prisma"
import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  LlmError,
  LlmUnsupportedError,
  getLlmProvider,
  type LlmProvider,
  type LlmProviderName,
} from "@/lib/llm"
import { chunkText, type ChunkTextOptions } from "./chunk"

export const EMBEDDING_DIMENSIONS = DEFAULT_EMBEDDING_DIMENSIONS

export type EmbedTextsResult = {
  embeddings: number[][]
  model: string
  provider: LlmProviderName
  dimensions: number
  latencyMs: number
}

export type EmbedTextsOptions = {
  provider?: LlmProvider
  dimensions?: number
  model?: string
}

/**
 * Embed a batch of texts and verify the vector width before it reaches the
 * database, so a provider/model mismatch fails at the boundary.
 */
export async function embedTexts(
  texts: string[],
  options: EmbedTextsOptions = {},
): Promise<EmbedTextsResult> {
  const provider = options.provider ?? getLlmProvider()
  if (!provider.supportsEmbeddings) {
    throw new LlmUnsupportedError(provider.name, "embeddings")
  }
  const dimensions = options.dimensions ?? EMBEDDING_DIMENSIONS
  if (texts.length === 0) {
    return { embeddings: [], model: "", provider: provider.name, dimensions, latencyMs: 0 }
  }

  const result = await provider.embed({ texts, dimensions, model: options.model })
  for (const [index, embedding] of result.embeddings.entries()) {
    if (embedding.length !== dimensions) {
      throw new LlmError(
        `${provider.name} returned a ${embedding.length}-dimension embedding at index ${index}, expected ${dimensions}`,
        { provider: provider.name },
      )
    }
  }

  return {
    embeddings: result.embeddings,
    model: result.model,
    provider: result.provider,
    dimensions,
    latencyMs: result.latencyMs,
  }
}

/**
 * pgvector literal, e.g. `[0.123,0.456]`. Fixed notation avoids scientific
 * notation, which pgvector's parser rejects.
 */
export function toVectorLiteral(embedding: number[]): string {
  if (embedding.length === 0) {
    throw new LlmError("Cannot serialize an empty embedding", {})
  }
  const parts = new Array<string>(embedding.length)
  for (let index = 0; index < embedding.length; index += 1) {
    const value = embedding[index]
    if (!Number.isFinite(value)) {
      throw new LlmError(`Embedding contains a non-finite value at index ${index}`, {})
    }
    parts[index] = value.toFixed(8)
  }
  return `[${parts.join(",")}]`
}

export type IndexMaterialOptions = EmbedTextsOptions & {
  chunkOptions?: ChunkTextOptions
}

export type IndexMaterialResult = {
  materialId: string
  chunkCount: number
  model: string
  dimensions: number
}

/**
 * Chunk a Material's text, embed every chunk, and replace its stored chunks.
 * Embeddings are written with raw SQL because the `embedding` column is an
 * `Unsupported("vector(1536)")` field that Prisma Client cannot address.
 */
export async function indexMaterial(
  materialId: string,
  options: IndexMaterialOptions = {},
): Promise<IndexMaterialResult> {
  const material = await prisma.material.findUnique({
    where: { id: materialId },
    select: { id: true, contentText: true },
  })
  if (!material) {
    throw new Error(`Material ${materialId} not found`)
  }

  const chunks = chunkText(material.contentText ?? "", options.chunkOptions)

  if (chunks.length === 0) {
    await prisma.materialChunk.deleteMany({ where: { materialId } })
    return {
      materialId,
      chunkCount: 0,
      model: "",
      dimensions: options.dimensions ?? EMBEDDING_DIMENSIONS,
    }
  }

  const embedded = await embedTexts(
    chunks.map((chunk) => chunk.content),
    options,
  )

  await prisma.$transaction(async (tx) => {
    await tx.materialChunk.deleteMany({ where: { materialId } })
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index]
      const created = await tx.materialChunk.create({
        data: {
          materialId,
          chunkIndex: chunk.index,
          content: chunk.content,
          tokenCount: chunk.tokenCount,
          embeddingModel: embedded.model,
        },
        select: { id: true },
      })
      await tx.$executeRaw`
        UPDATE "MaterialChunk"
        SET "embedding" = ${toVectorLiteral(embedded.embeddings[index])}::vector
        WHERE "id" = ${created.id}
      `
    }
  })

  return {
    materialId,
    chunkCount: chunks.length,
    model: embedded.model,
    dimensions: embedded.dimensions,
  }
}
