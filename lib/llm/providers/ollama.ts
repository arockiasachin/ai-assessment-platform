import { LlmError } from "../errors"
import { measureLatency, postJson, type FetchLike } from "../http"
import {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_EMBEDDING_MODEL,
  DEFAULT_OLLAMA_MODEL,
  normalizeBaseUrl,
  type LlmEnv,
} from "../env"
import { DEFAULT_TIMEOUT_MS, type LlmProvider } from "../types"

type OllamaChatResponse = {
  model?: string
  message?: { role?: string; content?: string }
  prompt_eval_count?: number
  eval_count?: number
  done_reason?: string | null
}

type OllamaEmbedResponse = {
  model?: string
  embeddings?: number[][]
}

export type OllamaConfig = {
  baseUrl?: string
  model?: string
  embeddingModel?: string
  timeoutMs?: number
  fetchImpl?: FetchLike
}

/**
 * Local Ollama runtime. No API key; requires a reachable daemon. Embeddings
 * use the modern `/api/embed` batch route.
 */
export function createOllamaProvider(config: OllamaConfig = {}): LlmProvider {
  const baseUrl = config.baseUrl ?? DEFAULT_OLLAMA_BASE_URL
  const model = config.model ?? DEFAULT_OLLAMA_MODEL
  const embeddingModel = config.embeddingModel ?? DEFAULT_OLLAMA_EMBEDDING_MODEL
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const fetchImpl = config.fetchImpl

  return {
    name: "ollama",
    defaultModel: model,
    defaultEmbeddingModel: embeddingModel,
    supportsEmbeddings: true,

    async generate(request) {
      if (!request.messages.length) {
        throw new LlmError("ollama requires at least one message", { provider: "ollama" })
      }
      const startedAt = Date.now()
      const data = await postJson<OllamaChatResponse>(`${baseUrl}/api/chat`, {
        provider: "ollama",
        fetchImpl,
        timeoutMs,
        signal: request.signal,
        body: {
          model: request.model ?? model,
          messages: request.messages,
          stream: false,
          ...(request.json ? { format: "json" as const } : {}),
          options: {
            ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
            ...(request.maxTokens !== undefined ? { num_predict: request.maxTokens } : {}),
          },
        },
      })

      const promptTokens = data.prompt_eval_count ?? 0
      const completionTokens = data.eval_count ?? 0

      return {
        text: data.message?.content ?? "",
        model: data.model ?? request.model ?? model,
        provider: "ollama",
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
        latencyMs: measureLatency(startedAt),
        finishReason: data.done_reason ?? null,
        raw: data,
      }
    },

    async embed(request) {
      if (!request.texts.length) {
        throw new LlmError("ollama embeddings require at least one text", { provider: "ollama" })
      }
      const startedAt = Date.now()
      const data = await postJson<OllamaEmbedResponse>(`${baseUrl}/api/embed`, {
        provider: "ollama",
        fetchImpl,
        timeoutMs,
        signal: request.signal,
        body: {
          model: request.model ?? embeddingModel,
          input: request.texts,
        },
      })

      const embeddings = data.embeddings ?? []
      if (embeddings.length !== request.texts.length) {
        throw new LlmError(
          `ollama returned ${embeddings.length} embeddings for ${request.texts.length} inputs`,
          { provider: "ollama" },
        )
      }

      return {
        embeddings,
        model: data.model ?? request.model ?? embeddingModel,
        provider: "ollama",
        latencyMs: measureLatency(startedAt),
      }
    },
  }
}

export function createOllamaProviderFromEnv(
  env: LlmEnv,
  timeoutMs: number,
  fetchImpl?: FetchLike,
): LlmProvider {
  return createOllamaProvider({
    baseUrl: normalizeBaseUrl(env.OLLAMA_BASE_URL, DEFAULT_OLLAMA_BASE_URL, "ollama"),
    model: env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL,
    embeddingModel:
      env.EMBEDDING_MODEL?.trim() ||
      env.OLLAMA_EMBEDDING_MODEL?.trim() ||
      DEFAULT_OLLAMA_EMBEDDING_MODEL,
    timeoutMs,
    fetchImpl,
  })
}
