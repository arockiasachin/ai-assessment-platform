import { describe, expect, it } from "vitest"

import { createLlmProvider, createMockProvider, observeLlmProvider } from "@/lib/llm"
import type { LlmProvider } from "@/lib/llm"
import { createLogger, type LogRecord } from "@/lib/observability"

const SECRET_PROMPT = "SECRET-PROMPT: the student answered forty-two."

function capture() {
  const records: LogRecord[] = []
  const logger = createLogger({
    sink: (_line, record) => records.push(record),
    level: "debug",
    now: () => new Date(0),
  })
  return { records, logger }
}

describe("LLM call observability", () => {
  it("logs provider, task, usage, and latency without prompt contents", async () => {
    const { records, logger } = capture()
    const provider = observeLlmProvider(createMockProvider(), { logger, includeContent: false })

    await provider.generate({
      messages: [{ role: "user", content: SECRET_PROMPT }],
      task: "rubric-grading",
      promptVersion: "rubric-grading-v1",
    })

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      event: "llm.generate",
      level: "info",
      provider: "mock",
      task: "rubric-grading",
      promptVersion: "rubric-grading-v1",
      outcome: "ok",
    })
    expect(typeof records[0]!.latencyMs).toBe("number")
    expect(records[0]!.totalTokens).toBeGreaterThan(0)

    const line = JSON.stringify(records[0])
    expect(line).not.toContain("SECRET-PROMPT")
    expect(line).not.toContain('"prompt":')
    expect(line).not.toContain('"response":')
  })

  it("includes prompt and response only when content logging is opted in", async () => {
    const { records, logger } = capture()
    const provider = observeLlmProvider(createMockProvider(), { logger, includeContent: true })

    await provider.generate({
      messages: [{ role: "user", content: SECRET_PROMPT }],
      task: "general",
    })

    expect(JSON.stringify(records[0])).toContain("SECRET-PROMPT")
    expect(records[0]).toHaveProperty("prompt")
    expect(records[0]).toHaveProperty("response")
  })

  it("logs a failed call with the error and rethrows it", async () => {
    const { records, logger } = capture()
    const failing: LlmProvider = {
      name: "openai",
      defaultModel: "gpt-test",
      defaultEmbeddingModel: "embed-test",
      supportsEmbeddings: false,
      async generate() {
        throw new Error("provider down")
      },
      async embed() {
        throw new Error("provider down")
      },
    }

    const provider = observeLlmProvider(failing, { logger, includeContent: false })
    await expect(
      provider.generate({ messages: [{ role: "user", content: "hello" }], task: "general" }),
    ).rejects.toThrow("provider down")

    const failure = records.find((record) => record.event === "llm.generate")
    expect(failure).toMatchObject({ level: "error", outcome: "error", provider: "openai" })
    expect(failure?.error).toMatchObject({ message: "provider down" })
  })

  it("keeps the default factory deterministic and offline through the decorator", async () => {
    const provider = createLlmProvider({ env: {} })
    expect(provider.name).toBe("mock")
    const result = await provider.generate({
      messages: [{ role: "user", content: "hello" }],
      task: "general",
    })
    expect(result.provider).toBe("mock")
    expect(result.text.length).toBeGreaterThan(0)
  })
})
