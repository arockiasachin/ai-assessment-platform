/**
 * Provider-agnostic LLM surface.
 *
 * Everything in lib/llm is dependency-free TypeScript built on `fetch` so the
 * grading and generation pipelines can swap providers without SDK churn. The
 * `mock` provider is deterministic and offline, which keeps CI and tests free
 * of API keys and network access.
 */

export const DEFAULT_EMBEDDING_DIMENSIONS = 1536
export const DEFAULT_TIMEOUT_MS = 60_000

export type LlmProviderName = "openai" | "anthropic" | "ollama" | "mock"

export const LLM_PROVIDER_NAMES: readonly LlmProviderName[] = [
  "mock",
  "openai",
  "anthropic",
  "ollama",
] as const

export type LlmRole = "system" | "user" | "assistant"

export type LlmMessage = {
  role: LlmRole
  content: string
}

/**
 * Task tags are carried through for telemetry/explainability and are never
 * sent to a provider. They let callers and the mock provider branch on intent.
 */
export type LlmTask =
  "quiz-generation" | "quiz-grading" | "rubric-grading" | "code-grading" | "embedding" | "general"

/**
 * Provider escape hatch. The mock provider reads `mockResponse` and
 * `mockEmbeddingDimensions`; live providers ignore unknown keys.
 */
export type LlmProviderOptions = {
  mockResponse?: string
  mockEmbeddingDimensions?: number
  [key: string]: unknown
}

export type LlmGenerateRequest = {
  messages: LlmMessage[]
  /** Overrides the provider default model. */
  model?: string
  temperature?: number
  maxTokens?: number
  /** Ask for a JSON object response where the provider supports it. */
  json?: boolean
  /** Explainability tag persisted alongside AI grade suggestions. */
  task?: LlmTask
  /** Bump whenever the prompt template changes; stored with each suggestion. */
  promptVersion?: string
  signal?: AbortSignal
  providerOptions?: LlmProviderOptions
}

export type LlmUsage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export type LlmGenerateResult = {
  text: string
  model: string
  provider: LlmProviderName
  usage: LlmUsage
  latencyMs: number
  finishReason?: string | null
  raw?: unknown
}

export type LlmEmbedRequest = {
  texts: string[]
  /** Overrides the provider default embedding model. */
  model?: string
  /** Requested vector size; providers that cannot honour it should throw. */
  dimensions?: number
  signal?: AbortSignal
}

export type LlmEmbedResult = {
  embeddings: number[][]
  model: string
  provider: LlmProviderName
  latencyMs: number
}

/**
 * The single interface every provider implements. `supportsEmbeddings` lets
 * callers fail fast (and pick a different provider for retrieval) instead of
 * catching an opaque error mid-pipeline.
 */
export interface LlmProvider {
  readonly name: LlmProviderName
  readonly defaultModel: string
  readonly defaultEmbeddingModel: string
  readonly supportsEmbeddings: boolean
  generate(request: LlmGenerateRequest): Promise<LlmGenerateResult>
  embed(request: LlmEmbedRequest): Promise<LlmEmbedResult>
}

export function emptyUsage(): LlmUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
}

/**
 * Rough, provider-independent token estimate (~4 chars/token). Only used by
 * the mock provider and as a fallback when a provider omits usage counts.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 4))
}
