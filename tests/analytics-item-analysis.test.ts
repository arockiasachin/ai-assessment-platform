import { describe, expect, it } from "vitest"

import {
  analyzeItem,
  DEFAULT_ITEM_ANALYSIS_THRESHOLDS,
  type ItemResponseInput,
} from "@/lib/analytics"

function responses(pattern: (boolean | null)[]): ItemResponseInput[] {
  return pattern.map((isCorrect, index) => ({ studentId: `s${index}`, isCorrect }))
}

function totalsFor(count: number): Map<string, number> {
  // s0 has the highest total, s{count-1} the lowest, so ranking is deterministic.
  const totals = new Map<string, number>()
  for (let index = 0; index < count; index += 1) {
    totals.set(`s${index}`, 100 - index)
  }
  return totals
}

describe("item analysis — difficulty index", () => {
  it("computes facility and difficulty as exact proportions", () => {
    // 12 responses, 10 answered, 6 correct.
    const analysis = analyzeItem({
      questionId: "q1",
      responses: responses([
        true,
        true,
        true,
        true,
        true,
        true,
        false,
        false,
        false,
        false,
        null,
        null,
      ]),
      studentTotals: totalsFor(12),
    })
    expect(analysis.answeredCount).toBe(10)
    expect(analysis.unansweredCount).toBe(2)
    expect(analysis.correctCount).toBe(6)
    expect(analysis.incorrectCount).toBe(4)
    expect(analysis.facilityIndex).toBeCloseTo(0.6, 10)
    expect(analysis.difficultyIndex).toBeCloseTo(0.4, 10)
    expect(analysis.difficultyInsufficientData).toBe(false)
  })

  it("excludes unanswered responses from the difficulty denominator", () => {
    // 5 correct of 10 answered, plus 5 blanks; facility is 0.5, not 5/15.
    const analysis = analyzeItem({
      questionId: "q1",
      responses: responses([
        true,
        true,
        true,
        true,
        true,
        false,
        false,
        false,
        false,
        false,
        null,
        null,
        null,
        null,
        null,
      ]),
      studentTotals: totalsFor(15),
    })
    expect(analysis.facilityIndex).toBeCloseTo(0.5, 10)
    expect(analysis.difficultyIndex).toBeCloseTo(0.5, 10)
  })
})

describe("item analysis — small-sample guard", () => {
  it("withholds difficulty below the minimum answered sample and says why", () => {
    const analysis = analyzeItem({
      questionId: "q1",
      responses: responses(Array.from({ length: 9 }, (_, index) => index < 5)),
      studentTotals: totalsFor(9),
    })
    expect(analysis.difficultyInsufficientData).toBe(true)
    expect(analysis.facilityIndex).toBeNull()
    expect(analysis.difficultyIndex).toBeNull()
    expect(analysis.insufficientData).toBe(true)
    expect(analysis.notes.join(" ")).toMatch(/Difficulty withheld/)
  })

  it("reports difficulty exactly at the minimum sample", () => {
    const analysis = analyzeItem({
      questionId: "q1",
      responses: responses(Array.from({ length: 10 }, (_, index) => index < 5)),
      studentTotals: totalsFor(10),
    })
    expect(analysis.difficultyInsufficientData).toBe(false)
    expect(analysis.facilityIndex).toBeCloseTo(0.5, 10)
  })

  it("withholds discrimination below the minimum scored sample", () => {
    // 19 responses: one short of the 20 needed for extreme groups.
    const analysis = analyzeItem({
      questionId: "q1",
      responses: responses(Array.from({ length: 19 }, () => true)),
      studentTotals: totalsFor(19),
    })
    expect(DEFAULT_ITEM_ANALYSIS_THRESHOLDS.minAttemptsForDiscrimination).toBe(20)
    expect(analysis.discriminationInsufficientData).toBe(true)
    expect(analysis.discriminationIndex).toBeNull()
    expect(analysis.discriminationMethod).toBeNull()
    expect(analysis.notes.join(" ")).toMatch(/Discrimination withheld/)
  })

  it("honours a caller-supplied threshold override", () => {
    const analysis = analyzeItem({
      questionId: "q1",
      responses: responses(Array.from({ length: 5 }, () => true)),
      studentTotals: totalsFor(5),
      thresholds: { minAttemptsForDifficulty: 5, minAttemptsForDiscrimination: 5 },
    })
    expect(analysis.difficultyInsufficientData).toBe(false)
    expect(analysis.discriminationInsufficientData).toBe(false)
    expect(analysis.discriminationIndex).toBe(0)
  })
})

describe("item analysis — discrimination index", () => {
  it("is +1 when the top scorers answer and the bottom scorers do not", () => {
    const pattern = Array.from({ length: 20 }, (_, index) => index < 5)
    const analysis = analyzeItem({
      questionId: "q1",
      responses: responses(pattern),
      studentTotals: totalsFor(20),
    })
    expect(analysis.discriminationInsufficientData).toBe(false)
    expect(analysis.upperGroupSize).toBe(5)
    expect(analysis.lowerGroupSize).toBe(5)
    expect(analysis.upperCorrect).toBe(5)
    expect(analysis.lowerCorrect).toBe(0)
    expect(analysis.discriminationIndex).toBeCloseTo(1, 10)
    expect(analysis.discriminationMethod).toBe("extreme-groups-27")
  })

  it("is -1 when the item discriminates backwards", () => {
    const pattern = Array.from({ length: 20 }, (_, index) => index >= 15)
    const analysis = analyzeItem({
      questionId: "q1",
      responses: responses(pattern),
      studentTotals: totalsFor(20),
    })
    expect(analysis.discriminationIndex).toBeCloseTo(-1, 10)
  })

  it("is 0 for an uninformative item everyone answers correctly", () => {
    const analysis = analyzeItem({
      questionId: "q1",
      responses: responses(Array.from({ length: 20 }, () => true)),
      studentTotals: totalsFor(20),
    })
    expect(analysis.discriminationIndex).toBeCloseTo(0, 10)
  })

  it("is deterministic when totals tie", () => {
    const tied = new Map(
      Array.from({ length: 20 }, (_, index) => [`s${index}`, 50] as [string, number]),
    )
    const pattern = Array.from({ length: 20 }, (_, index) => index % 2 === 0)
    const first = analyzeItem({
      questionId: "q1",
      responses: responses(pattern),
      studentTotals: tied,
    })
    const second = analyzeItem({
      questionId: "q1",
      responses: responses(pattern).reverse(),
      studentTotals: tied,
    })
    expect(first.discriminationIndex).toBe(second.discriminationIndex)
  })
})
