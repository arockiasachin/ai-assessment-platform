import { LlmError } from "../errors"
import { DEFAULT_MOCK_MODEL } from "../env"
import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  estimateTokens,
  type LlmGenerateResult,
  type LlmProvider,
} from "../types"

export type MockProviderConfig = {
  model?: string
  embeddingModel?: string
  /** Default vector size when a caller does not request one. */
  dimensions?: number
}

/** FNV-1a 32-bit. Stable across runs and platforms. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Mulberry32 PRNG, seeded from a hash so outputs are reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Deterministic, normalized pseudo-embedding. Identical text always yields the
 * identical vector; different text yields a near-orthogonal one, which is
 * enough to exercise similarity search offline.
 */
export function deterministicEmbedding(text: string, dimensions: number): number[] {
  const random = mulberry32(fnv1a(`embed:${text}`))
  const vector = new Array<number>(dimensions)
  let norm = 0
  for (let index = 0; index < dimensions; index += 1) {
    const value = random() * 2 - 1
    vector[index] = value
    norm += value * value
  }
  if (norm === 0) {
    vector[0] = 1
    return vector
  }
  const magnitude = Math.sqrt(norm)
  for (let index = 0; index < dimensions; index += 1) {
    vector[index] = vector[index] / magnitude
  }
  return vector
}

/**
 * Offline provider for CI and tests. It performs no network I/O, needs no API
 * key, and returns byte-identical output for identical input. Tests can pin an
 * exact response with `providerOptions.mockResponse`.
 */
export function createMockProvider(config: MockProviderConfig = {}): LlmProvider {
  const model = config.model ?? DEFAULT_MOCK_MODEL
  const embeddingModel = config.embeddingModel ?? "mock-embedding"
  const defaultDimensions = config.dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS

  return {
    name: "mock",
    defaultModel: model,
    defaultEmbeddingModel: embeddingModel,
    supportsEmbeddings: true,

    async generate(request) {
      if (!request.messages.length) {
        throw new LlmError("mock requires at least one message", { provider: "mock" })
      }

      const resolvedModel = request.model ?? model
      const task = request.task ?? "general"
      const lastUserMessage =
        [...request.messages].reverse().find((message) => message.role === "user")?.content ?? ""
      const promptText = request.messages
        .map((message) => `${message.role}: ${message.content}`)
        .join("\n")
      const digest = fnv1a(`${resolvedModel}|${task}|${promptText}`).toString(16).padStart(8, "0")

      const override = request.providerOptions?.mockResponse
      let text: string
      if (typeof override === "string") {
        text = override
      } else if (request.json) {
        text = JSON.stringify({
          mock: true,
          deterministic: true,
          provider: "mock",
          model: resolvedModel,
          task,
          promptVersion: request.promptVersion ?? null,
          digest,
          echo: lastUserMessage,
        })
      } else {
        text = `[mock:${digest}] ${task}: ${lastUserMessage}`
      }

      const promptTokens = estimateTokens(promptText)
      const completionTokens = estimateTokens(text)
      const result: LlmGenerateResult = {
        text,
        model: resolvedModel,
        provider: "mock",
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
        latencyMs: 0,
        finishReason: "stop",
        raw: { digest },
      }
      return result
    },

    async embed(request) {
      const dimensions = request.dimensions ?? defaultDimensions
      if (!Number.isInteger(dimensions) || dimensions <= 0) {
        throw new LlmError(`mock embedding dimensions must be a positive integer`, {
          provider: "mock",
        })
      }
      return {
        embeddings: request.texts.map((text) => deterministicEmbedding(text, dimensions)),
        model: request.model ?? embeddingModel,
        provider: "mock",
        latencyMs: 0,
      }
    },
  }
}
