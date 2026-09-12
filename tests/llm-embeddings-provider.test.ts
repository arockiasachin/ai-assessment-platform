import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  LlmConfigError,
  LlmEmbeddingsUnsupportedError,
  LlmUnsupportedError,
  createEmbeddingsProvider,
  createLlmProvider,
  deterministicEmbedding,
  getEmbeddingsProvider,
  getLlmProvider,
  resetLlmProviderCache,
  resolveEmbeddingsProviderName,
  type FetchLike,
  type LlmEnv,
} from "@/lib/llm"
import { embedTexts } from "@/lib/vector"

/**
 * The platform used one provider for chat *and* embeddings. DeepSeek exposes no
 * embeddings endpoint, so `LLM_PROVIDER=deepseek` silently broke material
 * indexing and material-grounded quiz retrieval. These tests cover the split:
 *
 *  - `EMBEDDINGS_PROVIDER` selects the embeddings provider and defaults to
 *    `LLM_PROVIDER`, so existing configs are unchanged;
 *  - retrieval uses the embeddings provider while generation/grading keep
 *    `LLM_PROVIDER`;
 *  - a non-embedding embeddings provider fails with an actionable error.
 *
 * Everything is offline: `fetch` is injected and no key is real.
 */

type Captured = { url: string; body: Record<string, unknown> }

/** OpenAI-compatible `/embeddings` responder with deterministic vectors. */
function fakeEmbeddingFetch(dimensions = 1536) {
  const calls: Captured[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    calls.push({ url: String(input), body })
    const inputs = Array.isArray(body.input) ? (body.input as string[]) : [String(body.input)]
    return new Response(
      JSON.stringify({
        model: typeof body.model === "string" ? body.model : "text-embedding-3-small",
        data: inputs.map((text, index) => ({
          index,
          embedding: deterministicEmbedding(text, dimensions),
        })),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  }) as FetchLike
  return { calls, fetchImpl }
}

/** DeepSeek/OpenAI-compatible `/chat/completions` responder. */
function fakeChatFetch() {
  const calls: Captured[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    calls.push({ url: String(input), body })
    return new Response(
      JSON.stringify({
        model: typeof body.model === "string" ? body.model : "unknown",
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  }) as FetchLike
  return { calls, fetchImpl }
}

/** The owner's deployment: DeepSeek for chat, a capable provider for embeddings. */
const SPLIT_ENV: LlmEnv = {
  LLM_PROVIDER: "deepseek",
  DEEPSEEK_API_KEY: "test-deepseek-key",
  EMBEDDINGS_PROVIDER: "openai",
  OPENAI_API_KEY: "test-openai-key",
}

describe("resolveEmbeddingsProviderName", () => {
  it("defaults to LLM_PROVIDER (and mock) when unset or blank", () => {
    expect(resolveEmbeddingsProviderName({})).toBe("mock")
    expect(resolveEmbeddingsProviderName({ LLM_PROVIDER: "   " })).toBe("mock")
    expect(resolveEmbeddingsProviderName({ LLM_PROVIDER: "openai" })).toBe("openai")
    expect(resolveEmbeddingsProviderName({ LLM_PROVIDER: "deepseek" })).toBe("deepseek")
    expect(
      resolveEmbeddingsProviderName({ LLM_PROVIDER: "openai", EMBEDDINGS_PROVIDER: "   " }),
    ).toBe("openai")
  })

  it("lets EMBEDDINGS_PROVIDER override LLM_PROVIDER", () => {
    expect(
      resolveEmbeddingsProviderName({ LLM_PROVIDER: "deepseek", EMBEDDINGS_PROVIDER: "ollama" }),
    ).toBe("ollama")
    expect(
      resolveEmbeddingsProviderName({ LLM_PROVIDER: "deepseek", EMBEDDINGS_PROVIDER: "openai" }),
    ).toBe("openai")
    // Accepts the OpenAI-compatible spelling aliases too.
    expect(
      resolveEmbeddingsProviderName({
        LLM_PROVIDER: "deepseek",
        EMBEDDINGS_PROVIDER: "openai-compatible",
      }),
    ).toBe("openai")
  })

  it("rejects an unknown EMBEDDINGS_PROVIDER, naming the variable", () => {
    const build = () => resolveEmbeddingsProviderName({ EMBEDDINGS_PROVIDER: "nope" })
    expect(build).toThrowError(LlmConfigError)
    expect(build).toThrow(/Unknown EMBEDDINGS_PROVIDER "nope"/)
  })
})

describe("embeddings provider selection", () => {
  it("builds the embeddings provider from EMBEDDINGS_PROVIDER", () => {
    const provider = createEmbeddingsProvider({
      env: SPLIT_ENV,
      fetchImpl: fakeEmbeddingFetch().fetchImpl,
    })
    expect(provider.name).toBe("openai")
    expect(provider.supportsEmbeddings).toBe(true)
  })

  it("keeps the previous single-provider behaviour when EMBEDDINGS_PROVIDER is unset", () => {
    const provider = createEmbeddingsProvider({
      env: { LLM_PROVIDER: "openai", OPENAI_API_KEY: "test-key" },
      fetchImpl: fakeEmbeddingFetch().fetchImpl,
    })
    expect(provider.name).toBe("openai")
  })

  it("requires the embeddings provider's own API key", () => {
    const build = () =>
      createEmbeddingsProvider({
        env: { LLM_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "ds", EMBEDDINGS_PROVIDER: "openai" },
      })
    expect(build).toThrowError(LlmConfigError)
    expect(build).toThrow(/OPENAI_API_KEY is required to use the openai provider/)
  })
})

describe("embedTexts uses the embeddings provider", () => {
  it("reproduction -> fix: deepseek chat + openai embeddings now succeeds", async () => {
    const { calls, fetchImpl } = fakeEmbeddingFetch()
    const embeddingProvider = createEmbeddingsProvider({ env: SPLIT_ENV, fetchImpl })

    const result = await embedTexts(["photosynthesis", "respiration"], {
      provider: embeddingProvider,
    })

    expect(result.provider).toBe("openai")
    expect(result.model).toBe("text-embedding-3-small")
    expect(result.dimensions).toBe(1536)
    expect(result.embeddings).toHaveLength(2)
    expect(result.embeddings[0]).toHaveLength(1536)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/embeddings")
  })

  it("fails with an actionable error when EMBEDDINGS_PROVIDER cannot embed", async () => {
    const provider = createEmbeddingsProvider({
      env: { LLM_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "ds", EMBEDDINGS_PROVIDER: "deepseek" },
    })
    expect(provider.supportsEmbeddings).toBe(false)

    const error = await embedTexts(["photosynthesis"], { provider }).catch((caught) => caught)

    expect(error).toBeInstanceOf(LlmEmbeddingsUnsupportedError)
    // Still catchable through the pre-existing capability error.
    expect(error).toBeInstanceOf(LlmUnsupportedError)
    const message = (error as Error).message
    // Names the misconfiguration and the fix, not just "unsupported".
    expect(message).toMatch(/EMBEDDINGS_PROVIDER/)
    expect(message).toMatch(/openai/)
    expect(message).toMatch(/ollama/)
    expect(message).toMatch(/"deepseek" exposes no embeddings endpoint/)
  })

  it("gives the same actionable error when EMBEDDINGS_PROVIDER is inherited from LLM_PROVIDER", async () => {
    // The original bug shape: only LLM_PROVIDER is set, and it cannot embed.
    const provider = createEmbeddingsProvider({
      env: { LLM_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "ds" },
    })
    expect(provider.name).toBe("deepseek")

    const error = await embedTexts(["photosynthesis"], { provider }).catch((caught) => caught)
    expect(error).toBeInstanceOf(LlmEmbeddingsUnsupportedError)
    expect((error as Error).message).toMatch(/EMBEDDINGS_PROVIDER/)
  })
})

describe("generation stays on LLM_PROVIDER", () => {
  it("resolves the generation provider independently of EMBEDDINGS_PROVIDER", async () => {
    const { calls, fetchImpl } = fakeChatFetch()
    const generation = createLlmProvider({ env: SPLIT_ENV, fetchImpl })
    const embeddings = createEmbeddingsProvider({
      env: SPLIT_ENV,
      fetchImpl: fakeEmbeddingFetch().fetchImpl,
    })

    expect(generation.name).toBe("deepseek")
    expect(embeddings.name).toBe("openai")
    expect(generation.name).not.toBe(embeddings.name)

    const result = await generation.generate({ messages: [{ role: "user", content: "hi" }] })
    expect(result.provider).toBe("deepseek")
    expect(calls[0]!.url).toBe("https://api.deepseek.com/chat/completions")
  })
})

describe("process-wide singletons", () => {
  const ENV_KEYS = [
    "LLM_PROVIDER",
    "EMBEDDINGS_PROVIDER",
    "DEEPSEEK_API_KEY",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
  ] as const
  let saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    saved = {}
    for (const key of ENV_KEYS) saved[key] = process.env[key]
    resetLlmProviderCache()
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
    resetLlmProviderCache()
  })

  it("keeps generation and embeddings singletons separate", () => {
    process.env.LLM_PROVIDER = "deepseek"
    process.env.DEEPSEEK_API_KEY = "ds"
    process.env.EMBEDDINGS_PROVIDER = "openai"
    process.env.OPENAI_API_KEY = "oa"
    resetLlmProviderCache()

    expect(getLlmProvider().name).toBe("deepseek")
    expect(getEmbeddingsProvider().name).toBe("openai")
  })

  it("defaults the embeddings singleton to the generation singleton", () => {
    process.env.LLM_PROVIDER = "deepseek"
    process.env.DEEPSEEK_API_KEY = "ds"
    delete process.env.EMBEDDINGS_PROVIDER
    resetLlmProviderCache()

    expect(getLlmProvider().name).toBe("deepseek")
    expect(getEmbeddingsProvider().name).toBe("deepseek")
  })
})
