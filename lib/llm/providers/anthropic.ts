import { LlmError, LlmUnsupportedError } from "../errors"
import { measureLatency, postJson, type FetchLike } from "../http"
import {
  DEFAULT_ANTHROPIC_BASE_URL,
  DEFAULT_ANTHROPIC_MODEL,
  normalizeBaseUrl,
  requireEnvValue,
  type LlmEnv,
} from "../env"
import { DEFAULT_TIMEOUT_MS, type LlmProvider } from "../types"

const ANTHROPIC_VERSION = "2023-06-01"

type AnthropicMessageResponse = {
  model?: string
  content?: Array<{ type?: string; text?: string }>
  stop_reason?: string | null
  usage?: {
    input_tokens?: number
    output_tokens?: number
  }
}

export type AnthropicConfig = {
  apiKey: string
  baseUrl?: string
  model?: string
  timeoutMs?: number
  fetchImpl?: FetchLike
}

/**
 * Anthropic Messages API. Anthropic has no embeddings endpoint, so
 * `supportsEmbeddings` is false and retrieval must use another provider.
 */
export function createAnthropicProvider(config: AnthropicConfig): LlmProvider {
  const baseUrl = config.baseUrl ?? DEFAULT_ANTHROPIC_BASE_URL
  const model = config.model ?? DEFAULT_ANTHROPIC_MODEL
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const fetchImpl = config.fetchImpl

  return {
    name: "anthropic",
    defaultModel: model,
    defaultEmbeddingModel: "",
    supportsEmbeddings: false,

    async generate(request) {
      const dialog = request.messages.filter((message) => message.role !== "system")
      if (!dialog.length) {
        throw new LlmError("anthropic requires at least one non-system message", {
          provider: "anthropic",
        })
      }

      let system = request.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n")

      // Anthropic has no response_format flag; steer JSON through the system prompt.
      if (request.json) {
        const instruction = "Respond with a single valid JSON object and no other text."
        system = system ? `${system}\n\n${instruction}` : instruction
      }

      const startedAt = Date.now()
      const data = await postJson<AnthropicMessageResponse>(`${baseUrl}/v1/messages`, {
        provider: "anthropic",
        fetchImpl,
        timeoutMs,
        signal: request.signal,
        headers: {
          "x-api-key": config.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: {
          model: request.model ?? model,
          max_tokens: request.maxTokens ?? 1024,
          temperature: request.temperature,
          messages: dialog,
          ...(system ? { system } : {}),
        },
      })

      const text = (data.content ?? [])
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("")

      const promptTokens = data.usage?.input_tokens ?? 0
      const completionTokens = data.usage?.output_tokens ?? 0

      return {
        text,
        model: data.model ?? request.model ?? model,
        provider: "anthropic",
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
        latencyMs: measureLatency(startedAt),
        finishReason: data.stop_reason ?? null,
        raw: data,
      }
    },

    async embed() {
      throw new LlmUnsupportedError("anthropic", "embeddings")
    },
  }
}

export function createAnthropicProviderFromEnv(
  env: LlmEnv,
  timeoutMs: number,
  fetchImpl?: FetchLike,
): LlmProvider {
  return createAnthropicProvider({
    apiKey: requireEnvValue(env.ANTHROPIC_API_KEY, "anthropic", "ANTHROPIC_API_KEY"),
    baseUrl: normalizeBaseUrl(env.ANTHROPIC_BASE_URL, DEFAULT_ANTHROPIC_BASE_URL, "anthropic"),
    model: env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL,
    timeoutMs,
    fetchImpl,
  })
}
