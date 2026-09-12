import { LlmConfigError } from "./errors"
import { resolveProviderName, resolveTimeoutMs, type LlmEnv } from "./env"
import type { FetchLike } from "./http"
import { observeLlmProvider } from "./observability"
import { createAnthropicProviderFromEnv } from "./providers/anthropic"
import { createDeepSeekProviderFromEnv } from "./providers/deepseek"
import { createMockProvider } from "./providers/mock"
import { createOllamaProviderFromEnv } from "./providers/ollama"
import { createOpenAiProviderFromEnv } from "./providers/openai-compatible"
import type { LlmProvider, LlmProviderName } from "./types"

export * from "./errors"
export * from "./env"
export * from "./types"
export * from "./observability"
export type { FetchLike } from "./http"
export { deterministicEmbedding, createMockProvider } from "./providers/mock"
export { createOpenAiCompatibleProvider } from "./providers/openai-compatible"
export { createAnthropicProvider } from "./providers/anthropic"
export { createDeepSeekProvider } from "./providers/deepseek"
export { createOllamaProvider } from "./providers/ollama"

export type CreateLlmProviderOptions = {
  /** Overrides LLM_PROVIDER for this instance. */
  provider?: LlmProviderName
  /** Overrides process.env; useful in tests. */
  env?: LlmEnv
  /** Injected fetch for deterministic tests. */
  fetchImpl?: FetchLike
}

function createBaseProvider(
  provider: LlmProviderName,
  env: LlmEnv,
  timeoutMs: number,
  fetchImpl?: FetchLike,
): LlmProvider {
  switch (provider) {
    case "mock":
      return createMockProvider({ model: env.MOCK_MODEL?.trim() || undefined })
    case "openai":
      return createOpenAiProviderFromEnv(env, timeoutMs, fetchImpl)
    case "deepseek":
      return createDeepSeekProviderFromEnv(env, timeoutMs, fetchImpl)
    case "anthropic":
      return createAnthropicProviderFromEnv(env, timeoutMs, fetchImpl)
    case "ollama":
      return createOllamaProviderFromEnv(env, timeoutMs, fetchImpl)
    default:
      throw new LlmConfigError(`Unsupported LLM provider "${String(provider)}".`)
  }
}

/**
 * Build a provider from env. Provider selection and validation happen here so
 * a misconfigured live provider fails loudly, while the default stays the
 * offline mock. The returned provider is wrapped with `observeLlmProvider`, so
 * every call emits a structured `llm.generate`/`llm.embed` line carrying the
 * explainability envelope (provider, model, usage, latency, prompt version).
 */
export function createLlmProvider(options: CreateLlmProviderOptions = {}): LlmProvider {
  const env = options.env ?? process.env
  const provider = options.provider ?? resolveProviderName(env)
  const timeoutMs = resolveTimeoutMs(env)
  return observeLlmProvider(createBaseProvider(provider, env, timeoutMs, options.fetchImpl))
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
