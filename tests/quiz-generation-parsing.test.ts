import { describe, expect, it } from "vitest"

import { QuizGenerationParseError, parseGeneratedQuestions } from "@/lib/quiz-generation"

function validQuestion(overrides: Record<string, unknown> = {}) {
  return {
    prompt: "Which organelle carries out photosynthesis?",
    options: [
      { text: "Chloroplast", isCorrect: true, rationale: "Correct." },
      { text: "Mitochondrion", isCorrect: false, rationale: "Confuses energy production sites." },
      { text: "Ribosome", isCorrect: false, rationale: "Confuses translation with metabolism." },
      {
        text: "Golgi apparatus",
        isCorrect: false,
        rationale: "Confuses packaging with metabolism.",
      },
    ],
    explanation: "Chloroplasts contain the thylakoid membrane.",
    subtopic: "Cell organelles",
    difficulty: 0.4,
    ...overrides,
  }
}

function payload(questions: unknown[]): string {
  return JSON.stringify({ questions })
}

describe("parseGeneratedQuestions", () => {
  it("parses a valid question payload", () => {
    const parsed = parseGeneratedQuestions(payload([validQuestion()]))
    expect(parsed).toHaveLength(1)
    expect(parsed[0].options).toHaveLength(4)
    expect(parsed[0].options.filter((option) => option.isCorrect)).toHaveLength(1)
    expect(parsed[0].subtopic).toBe("Cell organelles")
    expect(parsed[0].difficulty).toBe(0.4)
  })

  it("tolerates a fenced code block and a bare array", () => {
    const fenced = parseGeneratedQuestions("```json\n" + payload([validQuestion()]) + "\n```")
    expect(fenced).toHaveLength(1)
    const bare = parseGeneratedQuestions(JSON.stringify([validQuestion()]))
    expect(bare).toHaveLength(1)
  })

  it("rejects malformed JSON", () => {
    expect(() => parseGeneratedQuestions("not json at all")).toThrowError(QuizGenerationParseError)
    expect(() => parseGeneratedQuestions("not json at all")).toThrowError(/valid JSON/)
  })

  it("rejects an empty response", () => {
    expect(() => parseGeneratedQuestions("   ")).toThrowError(/empty response/)
  })

  it("rejects a payload without a questions array", () => {
    expect(() => parseGeneratedQuestions('{"answer": 42}')).toThrowError(/questions array/)
  })

  it("rejects the wrong option count", () => {
    const threeOptions = validQuestion({
      options: [
        { text: "A", isCorrect: true },
        { text: "B", isCorrect: false },
        { text: "C", isCorrect: false },
      ],
    })
    expect(() => parseGeneratedQuestions(payload([threeOptions]))).toThrowError(/4 or 5 options/)
  })

  it("rejects a question with no correct answer", () => {
    const noCorrect = validQuestion({
      options: validQuestion().options.map((option) => ({ ...option, isCorrect: false })),
    })
    expect(() => parseGeneratedQuestions(payload([noCorrect]))).toThrowError(
      /exactly one correct option/,
    )
  })

  it("rejects a question with two correct answers", () => {
    const twoCorrect = validQuestion({
      options: validQuestion().options.map((option, index) => ({
        ...option,
        isCorrect: index < 2,
      })),
    })
    expect(() => parseGeneratedQuestions(payload([twoCorrect]))).toThrowError(
      /exactly one correct option/,
    )
  })

  it("rejects duplicate option text", () => {
    const duplicated = validQuestion({
      options: validQuestion().options.map((option) => ({ ...option, text: "Same text" })),
    })
    expect(() => parseGeneratedQuestions(payload([duplicated]))).toThrowError(/must be distinct/)
  })

  it("rejects a missing subtopic and an out-of-range difficulty", () => {
    expect(() => parseGeneratedQuestions(payload([validQuestion({ subtopic: "" })]))).toThrowError(
      /subtopic/,
    )
    expect(() => parseGeneratedQuestions(payload([validQuestion({ difficulty: 2 })]))).toThrowError(
      /Difficulty/,
    )
  })

  it("enforces the requested count", () => {
    expect(() =>
      parseGeneratedQuestions(payload([validQuestion(), validQuestion()]), { expectedCount: 3 }),
    ).toThrowError(/returned 2 questions but 3 were requested/)

    const sliced = parseGeneratedQuestions(
      payload([validQuestion(), validQuestion(), validQuestion()]),
      { expectedCount: 2 },
    )
    expect(sliced).toHaveLength(2)
  })
})
