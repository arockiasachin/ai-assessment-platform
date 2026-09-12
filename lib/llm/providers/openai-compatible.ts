import { LlmConfigError, LlmError, LlmUnsupportedError } from "../errors"
import { measureLatency, postJson, type FetchLike } from "../http"
import {
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_EMBEDDING_MODEL,
  DEFAULT_OPENAI_MODEL,
  normalizeBaseUrl,
  requireEnvValue,
  type LlmEnv,
} from "../env"
import { DEFAULT_TIMEOUT_MS, type LlmProvider, type LlmUsage } from "../types"

type ChatCompletionResponse = {
  model?: string
  /**
   * Response id and model-build fingerprint. Both are retained verbatim in
   * `LlmGenerateResult.raw` (and therefore in the `AIGradeSuggestion.rawResponse`
   * JSON column) so a contestable grade can be traced to the exact serving
   * build. This matters most for `deepseek-flash`, which has no immutable
   * snapshot id.
   */
  id?: string
  system_fingerprint?: string
  choices?: Array<{
    message?: { content?: string | null }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

type EmbeddingsResponse = {
  model?: string
  data?: Array<{ embedding?: number[]; index?: number }>
}

export type OpenAiCompatibleConfig = {
  apiKey: string
  baseUrl?: string
  model?: string
  embeddingModel?: string
  timeoutMs?: number
  fetchImpl?: FetchLike
  /**
   * Reported provider identity used on results, errors, observability lines and
   * `/api/health`. Defaults to `"openai"`; DeepSeek reuses this transport but
   * must not masquerade as OpenAI in the audit trail.
   */
  name?: "openai" | "deepseek"
  /**
   * Some OpenAI-compatible vendors expose chat completions only. When false,
   * `embed()` throws `LlmUnsupportedError` so retrieval fails fast and loudly
   * instead of POSTing to a route that does not exist.
   */
  supportsEmbeddings?: boolean
}

function toUsage(usage: ChatCompletionResponse["usage"]): LlmUsage {
  const promptTokens = usage?.prompt_tokens ?? 0
  const completionTokens = usage?.completion_tokens ?? 0
  return {
    promptTokens,
    completionTokens,
    totalTokens: usage?.total_tokens ?? promptTokens + completionTokens,
  }
}

/**
 * Any OpenAI-compatible endpoint: api.openai.com, Azure-style gateways,
 * OpenRouter, vLLM, LM Studio, etc. Auth and both routes are configurable.
 */
export function createOpenAiCompatibleProvider(config: OpenAiCompatibleConfig): LlmProvider {
  const name = config.name ?? "openai"
  const supportsEmbeddings = config.supportsEmbeddings ?? true
  const baseUrl = config.baseUrl ?? DEFAULT_OPENAI_BASE_URL
  const model = config.model ?? DEFAULT_OPENAI_MODEL
  const embeddingModel = config.embeddingModel ?? DEFAULT_OPENAI_EMBEDDING_MODEL
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const fetchImpl = config.fetchImpl

  return {
    name,
    defaultModel: model,
    defaultEmbeddingModel: embeddingModel,
    supportsEmbeddings,

    async generate(request) {
      if (!request.messages.length) {
        throw new LlmError(`${name} requires at least one message`, { provider: name })
      }
      const startedAt = Date.now()
      const data = await postJson<ChatCompletionResponse>(`${baseUrl}/chat/completions`, {
        provider: name,
        fetchImpl,
        timeoutMs,
        signal: request.signal,
        headers: { authorization: `Bearer ${config.apiKey}` },
        body: {
          model: request.model ?? model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          ...(request.json ? { response_format: { type: "json_object" as const } } : {}),
        },
      })

      const text = data.choices?.[0]?.message?.content ?? ""
      return {
        text,
        model: data.model ?? request.model ?? model,
        provider: name,
        usage: toUsage(data.usage),
        latencyMs: measureLatency(startedAt),
        finishReason: data.choices?.[0]?.finish_reason ?? null,
        raw: data,
      }
    },

    async embed(request) {
      if (!supportsEmbeddings) {
        throw new LlmUnsupportedError(name, "embeddings")
      }
      if (!request.texts.length) {
        throw new LlmError(`${name} embeddings require at least one text`, { provider: name })
      }
      const startedAt = Date.now()
      const data = await postJson<EmbeddingsResponse>(`${baseUrl}/embeddings`, {
        provider: name,
        fetchImpl,
        timeoutMs,
        signal: request.signal,
        headers: { authorization: `Bearer ${config.apiKey}` },
        body: {
          model: request.model ?? embeddingModel,
          input: request.texts,
          ...(request.dimensions ? { dimensions: request.dimensions } : {}),
        },
      })

      const rows = [...(data.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      if (rows.length !== request.texts.length) {
        throw new LlmError(
          `${name} returned ${rows.length} embeddings for ${request.texts.length} inputs`,
          { provider: name },
        )
      }

      return {
        embeddings: rows.map((row) => row.embedding ?? []),
        model: data.model ?? request.model ?? embeddingModel,
        provider: name,
        latencyMs: measureLatency(startedAt),
      }
    },
  }
}

/** Convenience constructor from an env object, used by the provider selector. */
export function createOpenAiProviderFromEnv(
  env: LlmEnv,
  timeoutMs: number,
  fetchImpl?: FetchLike,
): LlmProvider {
  const apiKey = requireEnvValue(env.OPENAI_API_KEY, "openai", "OPENAI_API_KEY")
  try {
    return createOpenAiCompatibleProvider({
      apiKey,
      baseUrl: normalizeBaseUrl(env.OPENAI_BASE_URL, DEFAULT_OPENAI_BASE_URL, "openai"),
      model: env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
      embeddingModel:
        env.EMBEDDING_MODEL?.trim() ||
        env.OPENAI_EMBEDDING_MODEL?.trim() ||
        DEFAULT_OPENAI_EMBEDDING_MODEL,
      timeoutMs,
      fetchImpl,
    })
  } catch (error) {
    if (error instanceof LlmError) throw error
    throw new LlmConfigError("Unable to configure the openai provider", "openai")
  }
}
