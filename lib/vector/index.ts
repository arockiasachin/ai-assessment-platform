/**
 * pgvector-backed retrieval for course materials.
 *
 * - `chunkText` is pure and deterministic.
 * - `embedTexts` / `indexMaterial` go through the pluggable LLM provider.
 * - `similaritySearch` runs cosine search over MaterialChunk.
 *
 * MaterialChunk.embedding is an `Unsupported("vector(1536)")` column, so all
 * vector reads/writes use raw SQL while the rest of the model stays typed.
 */
export * from "./chunk"
export * from "./embed"
export * from "./search"
