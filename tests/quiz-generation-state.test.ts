import { describe, expect, it } from "vitest"

import {
  buildDraftMetadata,
  readQuestionState,
  serializeQuestionForOwner,
  serializeQuestionForStudent,
  withPublishedMetadata,
  type QuestionWithOptions,
} from "@/lib/quiz-generation"

/**
 * Draft-vs-published state and the answer-key boundary.
 *
 * State lives in `Question.metadata` because the schema is frozen and has no
 * publish column; the reader must fail closed. The serializers are the only
 * place an answer key can escape, so the student view is asserted to carry none.
 */

function question(): QuestionWithOptions {
  return {
    id: "q1",
    assessmentId: "a1",
    order: 0,
    prompt: "Which force keeps a satellite in orbit?",
    explanation: "Gravity provides the centripetal force.",
    subtopic: "Orbital mechanics",
    difficulty: 2,
    metadata: buildDraftMetadata({
      promptVersion: "quiz-generation-v1",
      model: "fake-quiz-llm",
      sourceChunkIds: ["chunk-1"],
      generatedAt: "2026-09-11T10:00:00.000Z",
    }),
    createdAt: new Date("2026-09-11T10:00:00.000Z"),
    options: [
      {
        id: "o1",
        questionId: "q1",
        order: 0,
        text: "Gravity.",
        isCorrect: true,
        rationale: "Correct: gravity is the centripetal force.",
        createdAt: new Date("2026-09-11T10:00:00.000Z"),
      },
      {
        id: "o2",
        questionId: "q1",
        order: 1,
        text: "Friction.",
        isCorrect: false,
        rationale: "Misconception: assumes friction acts in vacuum.",
        createdAt: new Date("2026-09-11T10:00:00.000Z"),
      },
      {
        id: "o3",
        questionId: "q1",
        order: 2,
        text: "Magnetism.",
        isCorrect: false,
        rationale: "Misconception: confuses gravity with magnetism.",
        createdAt: new Date("2026-09-11T10:00:00.000Z"),
      },
      {
        id: "o4",
        questionId: "q1",
        order: 3,
        text: "Air resistance.",
        isCorrect: false,
        rationale: "Misconception: assumes the satellite is in atmosphere.",
        createdAt: new Date("2026-09-11T10:00:00.000Z"),
      },
    ],
  }
}

describe("question draft/published state", () => {
  it("treats missing or malformed metadata as an unpublished draft", () => {
    expect(readQuestionState(undefined)).toBe("DRAFT")
    expect(readQuestionState(null)).toBe("DRAFT")
    expect(readQuestionState({})).toBe("DRAFT")
    expect(readQuestionState({ quizGeneration: { state: "SOMETHING_ELSE" } })).toBe("DRAFT")
    expect(readQuestionState({ quizGeneration: "nope" })).toBe("DRAFT")
    expect(readQuestionState([1, 2, 3])).toBe("DRAFT")
  })

  it("round-trips a generated draft and an explicit publish", () => {
    const draft = buildDraftMetadata({
      promptVersion: "quiz-generation-v1",
      model: "fake-quiz-llm",
      sourceChunkIds: ["chunk-1", "chunk-2"],
      generatedAt: "2026-09-11T10:00:00.000Z",
    })
    expect(readQuestionState(draft)).toBe("DRAFT")

    const published = withPublishedMetadata(draft, "2026-09-11T11:00:00.000Z")
    expect(readQuestionState(published)).toBe("PUBLISHED")
    const block = (published as Record<string, { publishedAt: string; promptVersion: string }>)
      .quizGeneration
    expect(block.publishedAt).toBe("2026-09-11T11:00:00.000Z")
    expect(block.promptVersion).toBe("quiz-generation-v1")
  })

  it("preserves unrelated metadata keys when publishing", () => {
    const published = withPublishedMetadata(
      { importedBy: "legacy", quizGeneration: { state: "DRAFT" } },
      "2026-09-11T11:00:00.000Z",
    )
    expect((published as Record<string, unknown>).importedBy).toBe("legacy")
    expect(readQuestionState(published)).toBe("PUBLISHED")
  })
})

describe("answer-key boundary", () => {
  it("the owner view carries the key, rationales, and explanation", () => {
    const owner = serializeQuestionForOwner(question())
    expect(owner.state).toBe("DRAFT")
    expect(owner.promptVersion).toBe("quiz-generation-v1")
    expect(owner.options.filter((option) => option.isCorrect)).toHaveLength(1)
    expect(owner.options[0].rationale).toBeTruthy()
    expect(owner.explanation).toBeTruthy()
  })

  it("the student view carries no key, rationale, or explanation", () => {
    const student = serializeQuestionForStudent(question())
    const serialized = JSON.stringify(student)
    expect(serialized).not.toContain("isCorrect")
    expect(serialized).not.toContain("rationale")
    expect(serialized).not.toContain("explanation")
    expect(Object.keys(student.options[0]).sort()).toEqual(["id", "order", "text"])
    // The option text is legitimately part of the question.
    expect(student.options.map((option) => option.text)).toContain("Gravity.")
  })
})
