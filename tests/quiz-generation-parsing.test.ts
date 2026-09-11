import { describe, expect, it } from "vitest"

import { QuizGenerationParseError, parseGeneratedQuestions } from "@/lib/quiz-generation"

/**
 * Model-output parsing is the boundary that decides whether anything reaches the
 * database. Every malformed shape must fail closed: a bad response is never a
 * partially-persisted draft.
 */

type OptionShape = { text: string; isCorrect: boolean; rationale: string }
type QuestionShape = {
  prompt: string
  subtopic: string
  difficulty: number
  explanation: string
  options: OptionShape[]
}

function question(overrides: Partial<QuestionShape> = {}): QuestionShape {
  return {
    prompt: "What does F = m * a state?",
    subtopic: "Newton's second law",
    difficulty: 3,
    explanation: "Force equals mass times acceleration.",
    options: [
      { text: "Force equals mass times acceleration.", isCorrect: true, rationale: "Correct." },
      {
        text: "Force equals mass divided by acceleration.",
        isCorrect: false,
        rationale: "Misconception: confuses multiplication with division.",
      },
      {
        text: "Force equals velocity times time.",
        isCorrect: false,
        rationale: "Misconception: confuses force with momentum.",
      },
      {
        text: "Acceleration is independent of mass.",
        isCorrect: false,
        rationale: "Misconception: treats mass as irrelevant.",
      },
    ],
    ...overrides,
  }
}

function wrap(questions: QuestionShape[]): string {
  return JSON.stringify({ questions })
}

describe("parseGeneratedQuestions", () => {
  it("parses a well-formed response", () => {
    const parsed = parseGeneratedQuestions(wrap([question(), question({ prompt: "Second?" })]), {
      expectedCount: 2,
    })
    expect(parsed).toHaveLength(2)
    expect(parsed[0].options).toHaveLength(4)
    expect(parsed[0].subtopic).toBe("Newton's second law")
    expect(parsed[0].difficulty).toBe(3)
  })

  it("accepts five options (the upper bound)", () => {
    const options = [
      ...question().options,
      {
        text: "Gravity is a myth.",
        isCorrect: false,
        rationale: "Misconception: rejects well-established physics.",
      },
    ]
    const parsed = parseGeneratedQuestions(wrap([question({ options })]), { expectedCount: 1 })
    expect(parsed[0].options).toHaveLength(5)
  })

  it("accepts a fenced JSON block", () => {
    const parsed = parseGeneratedQuestions("```json\n" + wrap([question()]) + "\n```", {
      expectedCount: 1,
    })
    expect(parsed).toHaveLength(1)
  })

  it("rejects a response that is not JSON", () => {
    expect(() => parseGeneratedQuestions("I cannot help with that.", { expectedCount: 1 })).toThrow(
      QuizGenerationParseError,
    )
  })

  it("rejects an empty response", () => {
    expect(() => parseGeneratedQuestions("   ", { expectedCount: 1 })).toThrow(
      QuizGenerationParseError,
    )
  })

  it("rejects the wrong number of questions", () => {
    expect(() =>
      parseGeneratedQuestions(wrap([question(), question({ prompt: "B?" })]), {
        expectedCount: 3,
      }),
    ).toThrow(/Expected 3 questions but the model returned 2/)
  })

  it("rejects a question with too few options", () => {
    const tooFew = question({ options: question().options.slice(0, 3) })
    expect(() => parseGeneratedQuestions(wrap([tooFew]), { expectedCount: 1 })).toThrow(
      /between 4 and 5 options/,
    )
  })

  it("rejects a question with too many options", () => {
    const extra = (suffix: string) => ({
      text: `Filler ${suffix}.`,
      isCorrect: false,
      rationale: "Filler distractor.",
    })
    const tooMany = question({ options: [...question().options, extra("one"), extra("two")] })
    expect(() => parseGeneratedQuestions(wrap([tooMany]), { expectedCount: 1 })).toThrow(
      /between 4 and 5 options/,
    )
  })

  it("rejects a question with more than one correct option", () => {
    const options = question().options.map((option, index) =>
      index === 0 || index === 1 ? { ...option, isCorrect: true } : option,
    )
    expect(() =>
      parseGeneratedQuestions(wrap([question({ options })]), { expectedCount: 1 }),
    ).toThrow(/exactly one correct option/)
  })

  it("rejects a question with no correct option", () => {
    const options = question().options.map((option) => ({ ...option, isCorrect: false }))
    expect(() =>
      parseGeneratedQuestions(wrap([question({ options })]), { expectedCount: 1 }),
    ).toThrow(/exactly one correct option/)
  })

  it("rejects duplicated options within a question", () => {
    const options = question().options.map((option, index) =>
      index === 1 ? { ...option, text: "Force equals mass times acceleration." } : option,
    )
    expect(() =>
      parseGeneratedQuestions(wrap([question({ options })]), { expectedCount: 1 }),
    ).toThrow(/repeats an option's wording/)
  })

  it("rejects duplicated question prompts", () => {
    expect(() =>
      parseGeneratedQuestions(wrap([question(), question()]), { expectedCount: 2 }),
    ).toThrow(/duplicates an earlier prompt/)
  })

  it("rejects a difficulty outside the 1-5 scale", () => {
    expect(() =>
      parseGeneratedQuestions(wrap([question({ difficulty: 9 })]), { expectedCount: 1 }),
    ).toThrow(QuizGenerationParseError)
  })

  it("rejects a distractor without a rationale", () => {
    const options = question().options.map((option, index) =>
      index === 2 ? { ...option, rationale: "" } : option,
    )
    expect(() =>
      parseGeneratedQuestions(wrap([question({ options })]), { expectedCount: 1 }),
    ).toThrow(QuizGenerationParseError)
  })
})
