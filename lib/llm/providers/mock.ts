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
 * Synthesize a deterministic, schema-valid quiz response for the
 * `quiz-generation` task. This is what lets the full retrieval -> generation ->
 * draft pipeline run end to end offline under `LLM_PROVIDER=mock`; the shape
 * matches the `quiz-generation-v1` prompt contract (4 options, exactly one
 * correct, a subtopic tag, and a difficulty in [0, 1]).
 */
function mockQuizResponse(prompt: string): string {
  const countMatch = prompt.match(/Number of questions to generate:\s*(\d+)/i)
  const requested = countMatch ? Number(countMatch[1]) : 3
  const count = Math.min(20, Math.max(1, Number.isFinite(requested) ? requested : 3))

  const topicMatch = prompt.match(/^Topic:\s*(.+)$/im)
  const topic = topicMatch?.[1]?.trim() || "the course topic"

  const difficultyMatch = prompt.match(/^Difficulty target:\s*(\w+)/im)
  const target = (difficultyMatch?.[1] ?? "mixed").toLowerCase()

  const subtopicTags = (() => {
    // The prompt renders the subtopic block as blank-line-delimited bullets, so
    // only the first section is considered. Taking every following line leaked
    // the "Course material" heading and the retrieved source text into the
    // persisted subtopic tags.
    const block = prompt.split(/Subtopic tags to use:\s*\n/i)[1]?.split(/\n\s*\n/)[0] ?? ""
    const tags = block
      .split("\n")
      .filter((line) => /^\s*-\s+/.test(line))
      .map((line) => line.replace(/^\s*-\s+/, "").trim())
      .filter((line) => line.length > 0)
      .slice(0, 20)
    return tags.length > 0 ? tags : [`${topic} fundamentals`]
  })()

  const difficultyFor = (index: number): number => {
    if (target === "easy") return 0.3
    if (target === "medium") return 0.55
    if (target === "hard") return 0.8
    return Math.round((0.2 + (index % 3) * 0.3) * 1000) / 1000
  }

  const questions = Array.from({ length: count }, (_, index) => {
    const item = index + 1
    return {
      prompt: `${topic} — which statement is correct? (item ${item})`,
      options: [
        {
          text: `A correct restatement of ${topic} (item ${item}).`,
          isCorrect: true,
          rationale: `Matches the retrieved material on ${topic}.`,
        },
        {
          text: `A plausible misconception about ${topic} (item ${item}).`,
          isCorrect: false,
          rationale: "Confuses the cause with the effect.",
        },
        {
          text: `A common but incomplete idea about ${topic} (item ${item}).`,
          isCorrect: false,
          rationale: "Stops at the surface feature instead of the mechanism.",
        },
        {
          text: `An overgeneralization about ${topic} (item ${item}).`,
          isCorrect: false,
          rationale: "Ignores the exception stated in the material.",
        },
      ],
      explanation: `The correct statement follows the retrieved material on ${topic}.`,
      subtopic: subtopicTags[index % subtopicTags.length],
      difficulty: difficultyFor(index),
    }
  })

  return JSON.stringify({ questions })
}

/**
 * Synthesize a deterministic, schema-valid per-criterion rubric evaluation for
 * the `rubric-grading` task. Without this branch the generic mock JSON has no
 * `score`, so `parseCriterionEvaluation` rejects it and every evaluation the
 * offline (`LLM_PROVIDER=mock`) app runs returns a 502.
 *
 * The evidence span is the first words of the submission so it is a verbatim
 * quote and passes `evidenceVerified`; the score sits at 75% of the criterion
 * ceiling, which is deliberately unremarkable so no flag is raised.
 */
function mockRubricResponse(prompt: string): string {
  const maxMatch = prompt.match(/Maximum points:\s*([0-9]+(?:\.[0-9]+)?)/i)
  const maxPoints = maxMatch ? Number(maxMatch[1]) : 1
  const criterionMatch = prompt.match(/^Criterion:\s*(.+)$/im)
  const criterion = criterionMatch?.[1]?.trim() || "the criterion"
  const submissionMatch = prompt.match(/"""\s*([\s\S]*?)\s*"""/)
  const submission = (submissionMatch?.[1] ?? "").replace(/\s+/g, " ").trim()
  const evidence = submission.split(" ").filter(Boolean).slice(0, 12).join(" ")
  const score = maxPoints > 0 ? Math.round(maxPoints * 0.75 * 100) / 100 : 0

  return JSON.stringify({
    score,
    rationale: `Deterministic offline score for "${criterion}" derived from the quoted evidence.`,
    evidence: evidence || criterion,
    confidence: 0.9,
  })
}

/**
 * Synthesize a deterministic, schema-valid set of code-evaluation test-case
 * drafts for the `code-eval` task. This is what lets the full
 * prompt -> generation -> draft pipeline run end to end offline under
 * `LLM_PROVIDER=mock`; the shape matches the `code-eval-v1` prompt contract and
 * the strict parser in `lib/code-eval/parsing.ts`.
 */
function mockCodeEvalResponse(prompt: string): string {
  const countMatch = prompt.match(/Number of draft test cases to generate:\s*(\d+)/i)
  const requested = countMatch ? Number(countMatch[1]) : 3
  const count = Math.min(20, Math.max(1, Number.isFinite(requested) ? requested : 3))
  const isPython = /Python 3\.12/i.test(prompt)
  const definition = isPython ? "def " : "function"

  const testCases = Array.from({ length: count }, (_, index) => {
    const item = index + 1
    if (index % 3 === 1) {
      return {
        name: `Function result check ${item}`,
        description: "Calls the student's `solve` function with sample arguments.",
        category: "unit",
        input: JSON.stringify({ function: "solve", args: [item, item + 1] }),
        expectedOutput: JSON.stringify(2 * item + 1),
        points: 1,
      }
    }
    if (index % 3 === 2) {
      return {
        name: `Source structure check ${item}`,
        description:
          "Checks that the submission defines a function and stays within a line budget.",
        category: "structure",
        input: JSON.stringify({ mustContain: [definition], maxLines: 200 }),
        expectedOutput: null,
        points: 1,
      }
    }
    return {
      name: `Program output check ${item}`,
      description: "Runs the program with sample input and compares stdout.",
      category: "input-output",
      input: `${item}\n`,
      expectedOutput: `${item}\n`,
      points: 1,
    }
  })

  return JSON.stringify({ testCases })
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
      } else if (task === "quiz-generation") {
        text = mockQuizResponse(lastUserMessage || promptText)
      } else if (task === "rubric-grading") {
        text = mockRubricResponse(lastUserMessage || promptText)
      } else if (task === "code-eval") {
        text = mockCodeEvalResponse(promptText)
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
