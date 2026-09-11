import { describe, expect, it } from "vitest"

import {
  applyAdjustmentFactor,
  computeAdjustmentFactors,
  type EvaluationRatingInput,
} from "@/lib/groups/adjustment"
import type { PeerEvaluationRatings } from "@/lib/groups/dimensions"

/**
 * Adjustment factors with AND without self-ratings (the established CATME
 * convention for converting a group grade into individual grades).
 */

function ratings(value: number): PeerEvaluationRatings {
  return {
    contributing: value,
    interacting: value,
    keepingOnTrack: value,
    expectingQuality: value,
    knowledgeSkillsAbilities: value,
  }
}

function evaluation(
  evaluatorId: string,
  evaluateeId: string,
  value: number,
): EvaluationRatingInput {
  return { evaluatorId, evaluateeId, ratings: ratings(value) }
}

/**
 * Four-member group. B, C and D all rate A a 3; everyone else is rated a 5. A
 * rates themselves a 5, which is the classic "self-rating hides the problem"
 * case the two-factor convention exists for.
 */
const MEMBERS = ["A", "B", "C", "D"]
const EVALUATIONS: EvaluationRatingInput[] = [
  evaluation("A", "A", 5),
  evaluation("A", "B", 5),
  evaluation("A", "C", 5),
  evaluation("A", "D", 5),
  evaluation("B", "B", 5),
  evaluation("B", "A", 3),
  evaluation("B", "C", 5),
  evaluation("B", "D", 5),
  evaluation("C", "C", 5),
  evaluation("C", "A", 3),
  evaluation("C", "B", 5),
  evaluation("C", "D", 5),
  evaluation("D", "D", 5),
  evaluation("D", "A", 3),
  evaluation("D", "B", 5),
  evaluation("D", "C", 5),
]

describe("computeAdjustmentFactors", () => {
  it("computes peer-only factors (self-ratings excluded)", () => {
    const factors = computeAdjustmentFactors(MEMBERS, EVALUATIONS, {
      includeSelfRatings: false,
    })
    const byId = new Map(factors.map((factor) => [factor.studentId, factor]))

    expect(byId.get("A")?.receivedAverage).toBeCloseTo(3)
    expect(byId.get("A")?.teamAverage).toBeCloseTo(4.5)
    expect(byId.get("A")?.adjustmentFactor).toBeCloseTo(3 / 4.5, 6)
    expect(byId.get("A")?.ratingCount).toBe(3)
    expect(byId.get("B")?.receivedAverage).toBeCloseTo(5)
    expect(byId.get("B")?.adjustmentFactor).toBeCloseTo(5 / 4.5, 6)
    expect(byId.get("B")?.includesSelf).toBe(false)
  })

  it("computes factors with self-ratings folded in", () => {
    const factors = computeAdjustmentFactors(MEMBERS, EVALUATIONS, {
      includeSelfRatings: true,
    })
    const byId = new Map(factors.map((factor) => [factor.studentId, factor]))

    expect(byId.get("A")?.receivedAverage).toBeCloseTo(3.5)
    expect(byId.get("A")?.teamAverage).toBeCloseTo(4.625)
    expect(byId.get("A")?.adjustmentFactor).toBeCloseTo(3.5 / 4.625, 6)
    expect(byId.get("A")?.ratingCount).toBe(4)
    expect(byId.get("B")?.adjustmentFactor).toBeCloseTo(5 / 4.625, 6)
    expect(byId.get("B")?.includesSelf).toBe(true)

    // Self-ratings pull the low member up toward the norm.
    const withoutSelf = computeAdjustmentFactors(MEMBERS, EVALUATIONS, {
      includeSelfRatings: false,
    })
    const lowWithout = withoutSelf.find((factor) => factor.studentId === "A")!.adjustmentFactor
    expect(byId.get("A")!.adjustmentFactor).toBeGreaterThan(lowWithout)
  })

  it("clamps factors when bounds are supplied", () => {
    const factors = computeAdjustmentFactors(MEMBERS, EVALUATIONS, {
      includeSelfRatings: false,
      minFactor: 0.9,
      maxFactor: 1.1,
    })
    const byId = new Map(factors.map((factor) => [factor.studentId, factor]))
    expect(byId.get("A")?.adjustmentFactor).toBe(0.9)
    expect(byId.get("B")?.adjustmentFactor).toBe(1.1)
  })

  it("returns a neutral factor for a member nobody rated", () => {
    const factors = computeAdjustmentFactors(["A", "B", "C"], [evaluation("A", "B", 4)], {
      includeSelfRatings: false,
    })
    const c = factors.find((factor) => factor.studentId === "C")
    expect(c?.receivedAverage).toBeNull()
    expect(c?.insufficientRatings).toBe(true)
    expect(c?.adjustmentFactor).toBe(1)
    expect(c?.ratingCount).toBe(0)
  })

  it("ignores ratings from or to non-members and keeps the latest duplicate", () => {
    const factors = computeAdjustmentFactors(
      ["A", "B"],
      [
        evaluation("A", "B", 2),
        evaluation("A", "B", 4),
        evaluation("OUTSIDER", "A", 1),
        evaluation("A", "OUTSIDER", 1),
      ],
      { includeSelfRatings: false },
    )
    const a = factors.find((factor) => factor.studentId === "A")
    expect(a?.ratingCount).toBe(0)
    const b = factors.find((factor) => factor.studentId === "B")
    expect(b?.receivedAverage).toBeCloseTo(4)
  })

  it("applies a factor to a group grade without publishing anything", () => {
    const suggestion = applyAdjustmentFactor(100, 0.6667)
    expect(suggestion.individualGrade).toBeCloseTo(66.67, 2)
    expect(suggestion.groupGrade).toBe(100)
    const clamped = applyAdjustmentFactor(100, 1.4, { maxFactor: 1.1 })
    expect(clamped.factor).toBe(1.1)
    expect(clamped.factorWasClamped).toBe(true)
    expect(clamped.individualGrade).toBeCloseTo(110, 2)
  })
})
