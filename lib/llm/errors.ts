import type { LlmProviderName } from "./types"

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

/** Thrown when a provider cannot serve a request shape (e.g. Anthropic embeddings). */
export class LlmUnsupportedError extends LlmError {
  constructor(provider: LlmProviderName, capability: string) {
    super(`${provider} does not support ${capability}`, { provider })
    this.name = "LlmUnsupportedError"
  }
}

/** Thrown for configuration problems (missing key, unknown provider, bad URL). */
export class LlmConfigError extends LlmError {
  constructor(message: string, provider?: LlmProviderName) {
    super(message, { provider })
    this.name = "LlmConfigError"
  }
}
