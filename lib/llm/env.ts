import { LlmConfigError } from "./errors"
import { DEFAULT_TIMEOUT_MS, LLM_PROVIDER_NAMES, type LlmProviderName } from "./types"

/**
 * The environment surface this module reads. Kept as an explicit type so
 * providers and tests can pass a plain object instead of mutating process.env.
 */
export type LlmEnv = {
  LLM_PROVIDER?: string
  LLM_TIMEOUT_MS?: string
  OPENAI_API_KEY?: string
  OPENAI_BASE_URL?: string
  OPENAI_MODEL?: string
  OPENAI_EMBEDDING_MODEL?: string
  DEEPSEEK_API_KEY?: string
  DEEPSEEK_BASE_URL?: string
  DEEPSEEK_MODEL?: string
  ANTHROPIC_API_KEY?: string
  ANTHROPIC_BASE_URL?: string
  ANTHROPIC_MODEL?: string
  OLLAMA_BASE_URL?: string
  OLLAMA_MODEL?: string
  OLLAMA_EMBEDDING_MODEL?: string
  /** Cross-provider override for the embedding model. */
  EMBEDDING_MODEL?: string
  MOCK_MODEL?: string
  /** Lets `process.env` satisfy this type without a cast. */
  [key: string]: string | undefined
}

/**
 * Default to the offline mock provider so a missing/blank LLM_PROVIDER never
 * makes CI or tests reach the network.
 */
export const DEFAULT_PROVIDER: LlmProviderName = "mock"

export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini"
export const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small"

/**
 * DeepSeek is OpenAI-compatible: the base URL has no `/v1` suffix and the chat
 * route is `/chat/completions`. `deepseek-flash` is the canonical V4.1-Flash id
 * and, importantly, a *moving target* — DeepSeek publishes no immutable
 * snapshot, so callers should log the response `system_fingerprint` (already
 * retained in `LlmGenerateResult.raw`) when provenance matters.
 */
export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com"
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-flash"

export const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com"
export const DEFAULT_ANTHROPIC_MODEL = "claude-3-5-sonnet-latest"

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434"
export const DEFAULT_OLLAMA_MODEL = "llama3.1"
export const DEFAULT_OLLAMA_EMBEDDING_MODEL = "nomic-embed-text"

export const DEFAULT_MOCK_MODEL = "mock-llm"

export function resolveProviderName(env: LlmEnv = process.env): LlmProviderName {
  const raw = (env.LLM_PROVIDER ?? "").trim().toLowerCase()
  if (!raw) return DEFAULT_PROVIDER

  // Accept the common spelling variants for OpenAI-compatible endpoints.
  if (raw === "openai-compatible" || raw === "openai_compatible") return "openai"

  if ((LLM_PROVIDER_NAMES as readonly string[]).includes(raw)) {
    return raw as LlmProviderName
  }

  throw new LlmConfigError(
    `Unknown LLM_PROVIDER "${raw}". Expected one of: ${LLM_PROVIDER_NAMES.join(", ")}.`,
  )
}

export function resolveTimeoutMs(
  env: LlmEnv = process.env,
  fallback: number = DEFAULT_TIMEOUT_MS,
): number {
  const raw = (env.LLM_TIMEOUT_MS ?? "").trim()
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new LlmConfigError(`LLM_TIMEOUT_MS must be a positive number, received "${raw}".`)
  }
  return parsed
}

export function requireEnvValue(
  value: string | undefined,
  provider: LlmProviderName,
  name: string,
): string {
  const trimmed = (value ?? "").trim()
  if (!trimmed) {
    throw new LlmConfigError(`${name} is required to use the ${provider} provider.`, provider)
  }
  return trimmed
}

export function normalizeBaseUrl(
  value: string | undefined,
  fallback: string,
  provider: LlmProviderName,
): string {
  const raw = (value ?? "").trim() || fallback
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new LlmConfigError(`Invalid base URL "${raw}" for ${provider}.`, provider)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new LlmConfigError(
      `Base URL for ${provider} must be http(s), received "${raw}".`,
      provider,
    )
  }
  return raw.replace(/\/+$/, "")
}

/** Guards callers that want to know whether a live (non-mock) provider is configured. */
export function isLiveProvider(name: LlmProviderName): boolean {
  return name !== "mock"
}
