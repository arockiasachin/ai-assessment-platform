import { describe, expect, it } from "vitest"

import {
  createLlmProvider,
  createMockProvider,
  deterministicEmbedding,
  type LlmGenerateRequest,
} from "@/lib/llm"

/**
 * The mock provider is the only provider tests and CI may use: it must be
 * deterministic, offline, and selected by default so a missing API key can
 * never turn into a live network call.
 */
describe("mock LLM provider", () => {
  it("is the default provider when LLM_PROVIDER is unset", () => {
    const provider = createLlmProvider({ env: {} })
    expect(provider.name).toBe("mock")
  })

  it("returns byte-identical output for identical input", async () => {
    const provider = createMockProvider()
    const request: LlmGenerateRequest = {
      messages: [{ role: "user", content: "Generate a quiz about photosynthesis." }],
      task: "quiz-generation",
      promptVersion: "v1",
      json: true,
    }

    const first = await provider.generate(request)
    const second = await provider.generate(request)

    expect(second).toEqual(first)
    expect(first.provider).toBe("mock")
    expect(first.text.length).toBeGreaterThan(0)
  })

  it("produces deterministic, normalized embeddings", () => {
    const first = deterministicEmbedding("photosynthesis", 1536)
    const second = deterministicEmbedding("photosynthesis", 1536)
    const different = deterministicEmbedding("respiration", 1536)

    expect(first).toHaveLength(1536)
    expect(second).toEqual(first)
    expect(different).not.toEqual(first)

    const norm = Math.sqrt(first.reduce((sum, value) => sum + value * value, 0))
    expect(norm).toBeCloseTo(1, 6)
  })
})
