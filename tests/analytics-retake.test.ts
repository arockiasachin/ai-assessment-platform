import { describe, expect, it } from "vitest"

import { selectAdaptiveRetakeQuestions } from "@/lib/analytics"

const questionIds = ["q1", "q2", "q3", "q4"]

describe("adaptive retake selection", () => {
  it("selects only the failed and (by default) unanswered questions, in order", () => {
    const selection = selectAdaptiveRetakeQuestions({
      questionIds,
      responses: [
        { questionId: "q1", isCorrect: true },
        { questionId: "q2", isCorrect: false },
        { questionId: "q3", isCorrect: null },
        // q4 has no response at all.
      ],
    })
    expect(selection.questionIds).toEqual(["q2", "q3", "q4"])
    expect(selection.failedQuestionIds).toEqual(["q2"])
    expect(selection.unansweredQuestionIds).toEqual(["q3", "q4"])
    expect(selection.totalQuestions).toBe(4)
    expect(selection.includeUnanswered).toBe(true)
  })

  it("restricts to genuinely wrong answers when includeUnanswered is false", () => {
    const selection = selectAdaptiveRetakeQuestions({
      questionIds,
      responses: [
        { questionId: "q1", isCorrect: true },
        { questionId: "q2", isCorrect: false },
        { questionId: "q3", isCorrect: null },
      ],
      includeUnanswered: false,
    })
    expect(selection.questionIds).toEqual(["q2"])
    expect(selection.unansweredQuestionIds).toEqual(["q3", "q4"])
    expect(selection.includeUnanswered).toBe(false)
  })

  it("returns nothing when every question was answered correctly", () => {
    const selection = selectAdaptiveRetakeQuestions({
      questionIds,
      responses: questionIds.map((questionId) => ({ questionId, isCorrect: true })),
    })
    expect(selection.questionIds).toEqual([])
    expect(selection.failedQuestionIds).toEqual([])
    expect(selection.unansweredQuestionIds).toEqual([])
  })

  it("ignores responses for questions that are not on the assessment", () => {
    const selection = selectAdaptiveRetakeQuestions({
      questionIds: ["q1"],
      responses: [
        { questionId: "q1", isCorrect: false },
        { questionId: "ghost", isCorrect: false },
      ],
    })
    expect(selection.questionIds).toEqual(["q1"])
    expect(selection.totalQuestions).toBe(1)
  })
})
