import { describeError } from "@/lib/observability/errors"
import type { Logger } from "@/lib/observability/logger"
import { getProcessLogger } from "@/lib/observability/logger"

import type { LlmEmbedRequest, LlmGenerateRequest, LlmProvider } from "./types"

/**
 * LLM call observability.
 *
 * The provider adapter already records `latencyMs` and token usage per call;
 * this decorator surfaces them as one structured line per call so model cost
 * and latency are visible per task. Prompt and completion contents are **not**
 * logged by default — set `LLM_LOG_CONTENT=true` to opt in (local debugging
 * only: prompts can contain student answers and other PII).
 *
 * No network, no schema change, no new dependency.
 */

export type LlmObservabilityOptions = {
  /** Injected for tests; defaults to the process logger (silent under test). */
  logger?: Logger
  /** Overrides the `LLM_LOG_CONTENT` environment flag. */
  includeContent?: boolean
}

/** True when prompt/response text should be included in the log line. */
export function llmContentLoggingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.LLM_LOG_CONTENT ?? "").trim().toLowerCase()
  return raw === "true" || raw === "1" || raw === "yes"
}

function lastUserMessage(request: LlmGenerateRequest): string | undefined {
  return [...request.messages].reverse().find((message) => message.role === "user")?.content
}

/**
 * Wrap a provider so every `generate`/`embed` emits a `llm.generate` /
 * `llm.embed` record. The wrapped provider is otherwise identical: the result
 * object is returned untouched and errors are re-thrown after being logged.
 */
export function observeLlmProvider(
  provider: LlmProvider,
  options: LlmObservabilityOptions = {},
): LlmProvider {
  const logger = options.logger ?? getProcessLogger()
  const includeContent = options.includeContent ?? llmContentLoggingEnabled()

  return {
    name: provider.name,
    defaultModel: provider.defaultModel,
    defaultEmbeddingModel: provider.defaultEmbeddingModel,
    supportsEmbeddings: provider.supportsEmbeddings,

    async generate(request) {
      const startedAt = Date.now()
      const task = request.task ?? "general"
      try {
        const result = await provider.generate(request)
        logger.info("llm.generate", {
          provider: result.provider,
          model: result.model,
          task,
          promptVersion: request.promptVersion ?? null,
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          totalTokens: result.usage.totalTokens,
          latencyMs: result.latencyMs,
          durationMs: Date.now() - startedAt,
          finishReason: result.finishReason ?? null,
          outcome: "ok",
          ...(includeContent
            ? { prompt: lastUserMessage(request) ?? null, response: result.text }
            : {}),
        })
        return result
      } catch (error) {
        logger.error("llm.generate", {
          provider: provider.name,
          model: request.model ?? provider.defaultModel,
          task,
          promptVersion: request.promptVersion ?? null,
          durationMs: Date.now() - startedAt,
          outcome: "error",
          error: describeError(error),
        })
        throw error
      }
    },

    async embed(request: LlmEmbedRequest) {
      const startedAt = Date.now()
      const model = request.model ?? provider.defaultEmbeddingModel
      try {
        const result = await provider.embed(request)
        logger.info("llm.embed", {
          provider: result.provider,
          model: result.model,
          textCount: request.texts.length,
          dimensions: request.dimensions ?? null,
          latencyMs: result.latencyMs,
          durationMs: Date.now() - startedAt,
          outcome: "ok",
          ...(includeContent ? { texts: request.texts } : {}),
        })
        return result
      } catch (error) {
        logger.error("llm.embed", {
          provider: provider.name,
          model,
          textCount: request.texts.length,
          durationMs: Date.now() - startedAt,
          outcome: "error",
          error: describeError(error),
        })
        throw error
      }
    },
  }
}
