import { LlmConfigError } from "./errors"
import { resolveProviderName, resolveTimeoutMs, type LlmEnv } from "./env"
import type { FetchLike } from "./http"
import { createAnthropicProviderFromEnv } from "./providers/anthropic"
import { createMockProvider } from "./providers/mock"
import { createOllamaProviderFromEnv } from "./providers/ollama"
import { createOpenAiProviderFromEnv } from "./providers/openai-compatible"
import type { LlmProvider, LlmProviderName } from "./types"

export * from "./errors"
export * from "./env"
export * from "./types"
export type { FetchLike } from "./http"
export { deterministicEmbedding, createMockProvider } from "./providers/mock"
export { createOpenAiCompatibleProvider } from "./providers/openai-compatible"
export { createAnthropicProvider } from "./providers/anthropic"
export { createOllamaProvider } from "./providers/ollama"

export type CreateLlmProviderOptions = {
  /** Overrides LLM_PROVIDER for this instance. */
  provider?: LlmProviderName
  /** Overrides process.env; useful in tests. */
  env?: LlmEnv
  /** Injected fetch for deterministic tests. */
  fetchImpl?: FetchLike
}

/**
 * Build a provider from env. Provider selection and validation happen here so
 * a misconfigured live provider fails loudly, while the default stays the
 * offline mock.
 */
export function createLlmProvider(options: CreateLlmProviderOptions = {}): LlmProvider {
  const env = options.env ?? process.env
  const provider = options.provider ?? resolveProviderName(env)
  const timeoutMs = resolveTimeoutMs(env)

  switch (provider) {
    case "mock":
      return createMockProvider({ model: env.MOCK_MODEL?.trim() || undefined })
    case "openai":
      return createOpenAiProviderFromEnv(env, timeoutMs, options.fetchImpl)
    case "anthropic":
      return createAnthropicProviderFromEnv(env, timeoutMs, options.fetchImpl)
    case "ollama":
      return createOllamaProviderFromEnv(env, timeoutMs, options.fetchImpl)
    default:
      throw new LlmConfigError(`Unsupported LLM provider "${String(provider)}".`)
  }
}

let cachedProvider: LlmProvider | undefined

/** Process-wide lazy singleton. Nothing is constructed until first use. */
export function getLlmProvider(): LlmProvider {
  if (!cachedProvider) {
    cachedProvider = createLlmProvider()
  }
  return cachedProvider
}

/** Test helper: drop the cached provider so env changes take effect. */
export function resetLlmProviderCache(): void {
  cachedProvider = undefined
}
