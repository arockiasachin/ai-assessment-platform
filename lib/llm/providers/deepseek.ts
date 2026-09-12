import { LlmConfigError, LlmError } from "../errors"
import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  normalizeBaseUrl,
  requireEnvValue,
  type LlmEnv,
} from "../env"
import type { FetchLike } from "../http"
import type { LlmProvider } from "../types"
import { createOpenAiCompatibleProvider } from "./openai-compatible"

export type DeepSeekConfig = {
  apiKey: string
  baseUrl?: string
  model?: string
  timeoutMs?: number
  fetchImpl?: FetchLike
}

/**
 * DeepSeek, first-class.
 *
 * The transport is the shared OpenAI-compatible Chat Completions client, but it
 * is exposed as its own provider (`name: "deepseek"`) so the audit trail, the
 * observability line and `/api/health` say DeepSeek rather than OpenAI. The
 * defaults are DeepSeek's, so an operator never needs to know the endpoint is
 * OpenAI-shaped:
 *
 * - base URL `https://api.deepseek.com` (chat route `/chat/completions`)
 * - model `deepseek-flash` (the canonical V4.1-Flash id)
 *
 * `deepseek-flash` is a **moving target**: DeepSeek publishes no immutable
 * snapshot id, so the parsed response — including `id` and
 * `system_fingerprint` — is retained in `LlmGenerateResult.raw` and persisted
 * with each AI grade suggestion for reproducibility.
 *
 * DeepSeek exposes no embeddings endpoint (the verified API surface is chat
 * completions plus an Anthropic-compatible route), so `supportsEmbeddings` is
 * false and `embed()` fails fast with `LlmUnsupportedError`. Material indexing
 * needs a separate embedding provider, exactly as the Anthropic provider does.
 */
export function createDeepSeekProvider(config: DeepSeekConfig): LlmProvider {
  return createOpenAiCompatibleProvider({
    name: "deepseek",
    supportsEmbeddings: false,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl ?? DEFAULT_DEEPSEEK_BASE_URL,
    model: config.model ?? DEFAULT_DEEPSEEK_MODEL,
    // No embeddings route; keep the reported default model empty so nothing
    // later mistakes an OpenAI embedding model for a DeepSeek one.
    embeddingModel: "",
    timeoutMs: config.timeoutMs,
    fetchImpl: config.fetchImpl,
  })
}

/** Convenience constructor from an env object, used by the provider selector. */
export function createDeepSeekProviderFromEnv(
  env: LlmEnv,
  timeoutMs: number,
  fetchImpl?: FetchLike,
): LlmProvider {
  const apiKey = requireEnvValue(env.DEEPSEEK_API_KEY, "deepseek", "DEEPSEEK_API_KEY")
  try {
    return createDeepSeekProvider({
      apiKey,
      baseUrl: normalizeBaseUrl(env.DEEPSEEK_BASE_URL, DEFAULT_DEEPSEEK_BASE_URL, "deepseek"),
      model: env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL,
      timeoutMs,
      fetchImpl,
    })
  } catch (error) {
    if (error instanceof LlmError) throw error
    throw new LlmConfigError("Unable to configure the deepseek provider", "deepseek")
  }
}
