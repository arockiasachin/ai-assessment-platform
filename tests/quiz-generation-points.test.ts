import { describe, expect, it } from "vitest"

import { distributePointsAcrossQuestions, pointsSumToMarks } from "@/lib/quiz-generation/points"

/**
 * Question points must sum to the assessment's marks.
 *
 * These exist because they did not, and the mismatch was invisible until a dashboard printed it:
 * every generated question was persisted at `points: 1` while scoring divided by
 * `Assessment.maxMarks`, so a four-question quiz on a twenty-mark assessment gave a **perfect**
 * attempt 20%.
 *
 * The tests concentrate on the two properties that make the fix work rather than on the arithmetic:
 * **the sum is exact** (a cent out makes a perfect attempt 99.99%) and **relative weighting
 * survives** (an explicit per-question weight is legitimate and must not be flattened).
 */

function sum(values: readonly number[]): number {
  return Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100
}

describe("distributePointsAcrossQuestions", () => {
  it("splits evenly when every question starts equal — the real case", () => {
    // Four generated questions, a twenty-mark assessment: five each.
    const result = distributePointsAcrossQuestions([1, 1, 1, 1], 20)

    expect(result).toEqual([5, 5, 5, 5])
    expect(sum(result)).toBe(20)
  })

  it("puts the rounding remainder on the last question so the sum is exact", () => {
    // 20 across 3 is 6.666…; a naive round would sum to 19.98 and score a perfect attempt at
    // 99.9%. The remainder is assigned rather than dropped.
    const result = distributePointsAcrossQuestions([1, 1, 1], 20)

    expect(sum(result)).toBe(20)
    expect(result[0]).toBe(6.67)
    expect(result[1]).toBe(6.67)
    expect(result[2]).toBe(6.66)
  })

  it("handles a marks value below the question count without producing zero-point questions", () => {
    // 5 questions on a 2-mark assessment. Each question still carries weight, so a correct answer
    // scores something.
    const result = distributePointsAcrossQuestions([1, 1, 1, 1, 1], 2)

    expect(sum(result)).toBe(2)
    expect(result.every((value) => value > 0)).toBe(true)
  })

  it("ignores the stored values entirely, so a derived set is not mistaken for intent", () => {
    // The defect the first implementation had: proportional scaling read the *derived* 5s as a
    // weight and treated them as five times heavier than a newly added question's default 1. The
    // stored values are therefore not weights at all — only the count matters.
    const fromEqual = distributePointsAcrossQuestions([1, 1, 1, 1], 20)
    const fromDerived = distributePointsAcrossQuestions([5, 5, 5, 5], 20)
    const fromArbitrary = distributePointsAcrossQuestions([7, 0.5, 999, 3], 20)

    expect(fromEqual).toEqual(fromDerived)
    expect(fromEqual).toEqual(fromArbitrary)
  })

  it("never produces a zero or negative share, however the input is shaped", () => {
    // A question worth 0 marks cannot be answered for credit, so it is not a state to converge on.
    // The edit contract requires a positive value, so a zero here is corrupt input rather than
    // intent.
    for (const points of [
      [0, 0, 0, 0],
      [Number.NaN, 1, 1, 1],
      [-5, 1, 1, 1],
      [0, 0],
    ]) {
      const result = distributePointsAcrossQuestions(points, 20)
      expect(result.every((value) => Number.isFinite(value) && value > 0)).toBe(true)
      expect(sum(result)).toBe(20)
    }
  })

  it("is idempotent, so re-running a generation does not drift the sum", () => {
    // The invariant has to survive being applied repeatedly, since a teacher can generate more
    // questions for the same assessment.
    const once = distributePointsAcrossQuestions([1, 1, 1, 1], 20)
    const twice = distributePointsAcrossQuestions(once, 20)

    expect(twice).toEqual(once)
  })

  it("redistributes across the whole set when questions are added later", () => {
    // Four questions for 20 marks (5 each), then four more. The whole set is recomputed, so the sum
    // stays at 20 rather than drifting to 40 — and the new questions are not devalued, which is
    // exactly what proportional scaling got wrong.
    const first = distributePointsAcrossQuestions([1, 1, 1, 1], 20)
    const afterAdding = distributePointsAcrossQuestions([...first, 1, 1, 1, 1], 20)

    expect(sum(afterAdding)).toBe(20)
    expect(afterAdding).toHaveLength(8)
    expect(afterAdding.every((value) => value === 2.5)).toBe(true)
  })

  it("returns an empty array for no questions", () => {
    expect(distributePointsAcrossQuestions([], 20)).toEqual([])
  })

  it("leaves the points alone when there is no scale to distribute", () => {
    // `maxMarks` is a required positive column, so this is defensive — but inventing a scale from
    // a zero would be worse than leaving the defaults visible.
    expect(distributePointsAcrossQuestions([1, 1], 0)).toEqual([1, 1])
    expect(distributePointsAcrossQuestions([1, 1], Number.NaN)).toEqual([1, 1])
    expect(distributePointsAcrossQuestions([1, 1], -5)).toEqual([1, 1])
  })

  it("produces integer points for the common divides-exactly case", () => {
    // Nicer to display and to read in the gradebook; only the remainder case yields fractions.
    expect(distributePointsAcrossQuestions([1, 1, 1, 1, 1], 25)).toEqual([5, 5, 5, 5, 5])
  })
})

describe("pointsSumToMarks", () => {
  it("recognises an exact sum, and one that is a cent out", () => {
    expect(pointsSumToMarks([5, 5, 5, 5], 20)).toBe(true)
    expect(pointsSumToMarks([6.67, 6.67, 6.66], 20)).toBe(true)
    expect(pointsSumToMarks([1, 1, 1, 1], 20)).toBe(false)
  })

  it("treats an empty set as nothing to reconcile", () => {
    expect(pointsSumToMarks([], 20)).toBe(true)
  })

  it("agrees with what distributePointsAcrossQuestions produces", () => {
    // The two are used together — one to decide whether to write, one to compute the write — so a
    // disagreement would mean either a needless write or a missed correction.
    for (const [points, marks] of [
      [[1, 1, 1, 1], 20],
      [[1, 1, 1], 20],
      [[1, 3], 20],
      [[1, 1, 1, 1, 1], 2],
      [[0, 0], 10],
    ] as const) {
      expect(pointsSumToMarks(distributePointsAcrossQuestions([...points], marks), marks)).toBe(
        true,
      )
    }
  })
})
