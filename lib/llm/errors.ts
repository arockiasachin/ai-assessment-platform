import { SUGGESTED_EMBEDDING_PROVIDERS, type LlmProviderName } from "./types"

export type LlmErrorOptions = {
  provider?: LlmProviderName
  status?: number
  responseBody?: string
  cause?: unknown
}

/** Base error for every failure in this module so callers can branch on one type. */
export class LlmError extends Error {
  readonly provider?: LlmProviderName
  readonly status?: number
  readonly responseBody?: string
  override readonly cause?: unknown

  constructor(message: string, options: LlmErrorOptions = {}) {
    super(message)
    this.name = "LlmError"
    this.provider = options.provider
    this.status = options.status
    this.responseBody = options.responseBody
    this.cause = options.cause
  }
}

export type LlmUnsupportedErrorOptions = {
  /** Overrides the generic message; used by capability-specific subclasses. */
  message?: string
}

/** Thrown when a provider cannot serve a request shape (e.g. Anthropic embeddings). */
export class LlmUnsupportedError extends LlmError {
  constructor(
    provider: LlmProviderName,
    capability: string,
    options: LlmUnsupportedErrorOptions = {},
  ) {
    super(options.message ?? `${provider} does not support ${capability}`, { provider })
    this.name = "LlmUnsupportedError"
  }
}

/**
 * Thrown when the resolved *embeddings* provider cannot embed — almost always
 * `EMBEDDINGS_PROVIDER` (or the `LLM_PROVIDER` it inherits) pointing at a
 * generation-only provider such as DeepSeek or Anthropic.
 *
 * The message names the variable to change and providers that work, so the fix
 * is obvious from a single log line. It extends `LlmUnsupportedError`, so any
 * caller already catching that still catches this.
 */
export class LlmEmbeddingsUnsupportedError extends LlmUnsupportedError {
  constructor(provider: LlmProviderName) {
    super(provider, "embeddings", {
      message:
        `The embeddings provider "${provider}" exposes no embeddings endpoint, so it cannot power ` +
        `material indexing or retrieval. Set EMBEDDINGS_PROVIDER to a provider that supports ` +
        `embeddings (${SUGGESTED_EMBEDDING_PROVIDERS.join(", ")}) — for example ` +
        `EMBEDDINGS_PROVIDER=${SUGGESTED_EMBEDDING_PROVIDERS[0]} — while LLM_PROVIDER="${provider}" ` +
        `continues to serve chat generation and grading.`,
    })
    this.name = "LlmEmbeddingsUnsupportedError"
  }
}

/** Thrown for configuration problems (missing key, unknown provider, bad URL). */
export class LlmConfigError extends LlmError {
  constructor(message: string, provider?: LlmProviderName) {
    super(message, { provider })
    this.name = "LlmConfigError"
  }
}
