import { describe, expect, it } from "vitest"

import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  LlmConfigError,
  LlmUnsupportedError,
  createDeepSeekProvider,
  createLlmProvider,
  resolveProviderName,
} from "@/lib/llm"

/**
 * DeepSeek is a first-class provider: `LLM_PROVIDER=deepseek` selects the
 * OpenAI-compatible transport with DeepSeek's own defaults, but reports
 * `provider: "deepseek"` so the audit trail and health check never claim OpenAI.
 *
 * Everything here is offline: `fetch` is injected, so no request leaves the
 * process and no API key is real.
 */

type Captured = { url: string; init: RequestInit }

function fakeFetch(payload: unknown) {
  const calls: Captured[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
  return { calls, fetchImpl }
}

function headersOf(call: Captured): Record<string, string> {
  return (call.init.headers ?? {}) as Record<string, string>
}

function bodyOf(call: Captured): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>
}

const COMPLETION = {
  id: "chatcmpl-deepseek-123",
  model: "deepseek-flash",
  system_fingerprint: "fp_deepseek_v41_20260910",
  choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }],
  usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
}

describe("deepseek provider selection", () => {
  it("resolves LLM_PROVIDER=deepseek to the deepseek provider", () => {
    expect(resolveProviderName({ LLM_PROVIDER: "deepseek" })).toBe("deepseek")
  })

  it("keeps mock as the default when LLM_PROVIDER is unset or blank", () => {
    expect(createLlmProvider({ env: {}, fetchImpl: fakeFetch({}).fetchImpl }).name).toBe("mock")
    expect(
      createLlmProvider({ env: { LLM_PROVIDER: "   " }, fetchImpl: fakeFetch({}).fetchImpl }).name,
    ).toBe("mock")
  })

  it("builds a deepseek provider from the DEEPSEEK_* env family", () => {
    const provider = createLlmProvider({
      env: { LLM_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "test-key" },
      fetchImpl: fakeFetch(COMPLETION).fetchImpl,
    })
    expect(provider.name).toBe("deepseek")
    expect(provider.defaultModel).toBe(DEFAULT_DEEPSEEK_MODEL)
    expect(provider.supportsEmbeddings).toBe(false)
  })
})

describe("deepseek provider requests", () => {
  it("posts to DeepSeek's chat route with the model and bearer auth", async () => {
    const { calls, fetchImpl } = fakeFetch(COMPLETION)
    const provider = createDeepSeekProvider({ apiKey: "test-key", fetchImpl })

    const result = await provider.generate({
      messages: [{ role: "user", content: "Grade this." }],
      task: "rubric-grading",
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(`${DEFAULT_DEEPSEEK_BASE_URL}/chat/completions`)
    expect(headersOf(calls[0]!).authorization).toBe("Bearer test-key")
    expect(bodyOf(calls[0]!).model).toBe(DEFAULT_DEEPSEEK_MODEL)
    expect(result.provider).toBe("deepseek")
    expect(result.model).toBe("deepseek-flash")
  })

  it("honours DEEPSEEK_BASE_URL and DEEPSEEK_MODEL overrides", async () => {
    const { calls, fetchImpl } = fakeFetch(COMPLETION)
    const provider = createLlmProvider({
      env: {
        LLM_PROVIDER: "deepseek",
        DEEPSEEK_API_KEY: "test-key",
        DEEPSEEK_BASE_URL: "https://deepseek.internal.example/",
        DEEPSEEK_MODEL: "deepseek-flash-pinned",
      },
      fetchImpl,
    })

    await provider.generate({ messages: [{ role: "user", content: "hi" }] })

    expect(calls[0]!.url).toBe("https://deepseek.internal.example/chat/completions")
    expect(bodyOf(calls[0]!).model).toBe("deepseek-flash-pinned")
  })

  it("retains the response id and system_fingerprint in raw for provenance", async () => {
    const provider = createDeepSeekProvider({
      apiKey: "test-key",
      fetchImpl: fakeFetch(COMPLETION).fetchImpl,
    })

    const result = await provider.generate({ messages: [{ role: "user", content: "hi" }] })

    expect(result.raw).toMatchObject({
      id: "chatcmpl-deepseek-123",
      system_fingerprint: "fp_deepseek_v41_20260910",
    })
  })

  it("fails loudly with a clear config error when DEEPSEEK_API_KEY is missing", () => {
    const build = () =>
      createLlmProvider({
        env: { LLM_PROVIDER: "deepseek" },
        fetchImpl: fakeFetch(COMPLETION).fetchImpl,
      })

    expect(build).toThrowError(LlmConfigError)
    expect(build).toThrow(/DEEPSEEK_API_KEY is required to use the deepseek provider/)
  })
})

describe("deepseek embeddings", () => {
  it("fails fast because DeepSeek exposes no embeddings route", async () => {
    const provider = createDeepSeekProvider({ apiKey: "test-key" })
    await expect(provider.embed({ texts: ["hello"] })).rejects.toBeInstanceOf(LlmUnsupportedError)
  })
})

describe("existing providers are unchanged", () => {
  it("keeps the OpenAI defaults and provider identity", async () => {
    const { calls, fetchImpl } = fakeFetch({ model: "gpt-4o-mini", choices: [] })
    const provider = createLlmProvider({
      env: { LLM_PROVIDER: "openai", OPENAI_API_KEY: "test-key" },
      fetchImpl,
    })

    expect(provider.name).toBe("openai")
    expect(provider.defaultModel).toBe("gpt-4o-mini")
    await provider.generate({ messages: [{ role: "user", content: "hi" }] })
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/chat/completions")
  })
})
