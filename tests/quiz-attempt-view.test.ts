import { describe, expect, it } from "vitest"

import type { QuizAttemptView } from "@/lib/contracts/quiz-attempts"
import {
  isTextQuestionType,
  resumableAttempt,
  unansweredQuestionCount,
} from "@/lib/quiz-attempts/attempt-view"

/**
 * Quiz-attempt view logic.
 *
 * The autosave payload, the submit payload and the unanswered count all need to
 * agree on which questions are prose and which are choices; one definition now
 * serves all three. The resume rule is here because the primary button's label is
 * derived from it (SN-23) and a component has no test in this repo.
 */

type Question = QuizAttemptView["questions"][number]

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: "q1",
    order: 0,
    type: "MCQ",
    prompt: "2 + 2?",
    points: 1,
    options: [{ id: "o1", order: 0, text: "4" }],
    ...overrides,
  }
}

describe("isTextQuestionType", () => {
  it("recognises the two prose types", () => {
    expect(isTextQuestionType(question({ type: "SHORT_ANSWER" }))).toBe(true)
    expect(isTextQuestionType(question({ type: "ESSAY" }))).toBe(true)
  })

  it("does not call a choice question prose", () => {
    expect(isTextQuestionType(question({ type: "MCQ" }))).toBe(false)
    expect(isTextQuestionType(question({ type: "TRUE_FALSE" }))).toBe(false)
  })
})

describe("unansweredQuestionCount", () => {
  const view = {
    questions: [
      question({ id: "choice", type: "MCQ" }),
      question({ id: "text", type: "SHORT_ANSWER" }),
      question({ id: "essay", type: "ESSAY" }),
    ],
  }

  it("counts a null selection and an empty text answer as blank", () => {
    expect(unansweredQuestionCount(view, {}, {})).toBe(3)
    expect(unansweredQuestionCount(view, { choice: null }, { text: "   " })).toBe(3)
  })

  it("does not count an answered choice or a non-empty text answer", () => {
    // The count that makes the in-progress copy honest: Submit accepts blanks and
    // scores them zero, so the student is told how many there are (SL-3).
    expect(unansweredQuestionCount(view, { choice: 0 }, { text: "4", essay: "Because." })).toBe(0)
  })

  it("counts a partial set correctly", () => {
    expect(unansweredQuestionCount(view, { choice: 2 }, {})).toBe(2)
    expect(unansweredQuestionCount(view, {}, { essay: "a" })).toBe(2)
  })

  it("returns zero for an empty question list", () => {
    expect(unansweredQuestionCount({ questions: [] }, {}, {})).toBe(0)
  })
})

describe("resumableAttempt", () => {
  it("finds the in-progress sitting", () => {
    const attempts = [
      { id: "a1", status: "SUBMITTED" },
      { id: "a2", status: "IN_PROGRESS" },
    ] as const
    expect(resumableAttempt(attempts)?.id).toBe("a2")
  })

  it("returns null when nothing is open", () => {
    expect(resumableAttempt([{ id: "a1", status: "SUBMITTED" }] as const)).toBeNull()
    expect(resumableAttempt([])).toBeNull()
  })
})
