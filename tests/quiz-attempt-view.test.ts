import { describe, expect, it } from "vitest"

import type { QuizAttemptView } from "@/lib/contracts/quiz-attempts"
import {
  attemptScoreState,
  isPublishedScore,
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

describe("attemptScoreState", () => {
  it("reports an unscored attempt as unscored, whatever the publication flag says", () => {
    // The flag only qualifies a score that exists; an in-progress attempt has none.
    expect(attemptScoreState({ score: null, maxScore: null, gradePublished: false })).toEqual({
      kind: "unscored",
    })
    expect(attemptScoreState({ score: null, maxScore: 20, gradePublished: true })).toEqual({
      kind: "unscored",
    })
  })

  it("keeps an auto-score pending until the teacher releases the grade (SN-11)", () => {
    // The server records the auto-score at submit so the grade pipeline has a suggestion, but
    // it is not the student's mark until a teacher publishes it.
    expect(attemptScoreState({ score: 10, maxScore: 20, gradePublished: false })).toEqual({
      kind: "pending",
      autoScore: 10,
      maxScore: 20,
    })
  })

  it("exposes a published score as published", () => {
    expect(attemptScoreState({ score: 20, maxScore: 20, gradePublished: true })).toEqual({
      kind: "published",
      score: 20,
      maxScore: 20,
    })
  })

  it("treats a zero score as scored, not missing", () => {
    // `score: 0` is a real released mark; only `null` means "not scored".
    expect(attemptScoreState({ score: 0, maxScore: 20, gradePublished: true })).toEqual({
      kind: "published",
      score: 0,
      maxScore: 20,
    })
  })
})

describe("isPublishedScore", () => {
  it("counts only a released mark", () => {
    expect(isPublishedScore({ score: 10, gradePublished: true })).toBe(true)
    expect(isPublishedScore({ score: 0, gradePublished: true })).toBe(true)
    expect(isPublishedScore({ score: 10, gradePublished: false })).toBe(false)
    expect(isPublishedScore({ score: null, gradePublished: true })).toBe(false)
  })

  it("tolerates a missing latest attempt", () => {
    expect(isPublishedScore(null)).toBe(false)
    expect(isPublishedScore(undefined)).toBe(false)
  })
})
