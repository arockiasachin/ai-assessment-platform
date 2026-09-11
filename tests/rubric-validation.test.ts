import { describe, expect, it } from "vitest"

import {
  criterionWeightIsSane,
  parseRubricUpsertRequest,
  validateRubricCoherence,
} from "@/lib/rubric-grading/validation"
import { RubricValidationError } from "@/lib/rubric-grading/errors"
import type { RubricCriterionInput, RubricUpsertRequest } from "@/lib/rubric-grading/contracts"

/**
 * Rubric coherence: the rubric is the binding grading contract, so a malformed
 * rubric must be rejected before it can influence a model or a published grade.
 */

function criterion(overrides: Partial<RubricCriterionInput> = {}): RubricCriterionInput {
  return { label: "Argument", weight: 1, maxPoints: 5, ...overrides }
}

function rubric(overrides: Partial<RubricUpsertRequest> = {}): RubricUpsertRequest {
  return {
    assessmentId: "assessment-1",
    title: "Essay rubric",
    criteria: [criterion()],
    ...overrides,
  }
}

describe("validateRubricCoherence", () => {
  it("derives the total from the criteria and normalizes order", () => {
    const coherence = validateRubricCoherence(
      rubric({
        criteria: [
          criterion({ label: "Argument", maxPoints: 6 }),
          criterion({ label: "Evidence", maxPoints: 4, weight: 2 }),
        ],
      }),
      { assessmentMaxMarks: 20 },
    )

    expect(coherence.maxPoints).toBe(10)
    expect(coherence.criteria.map((c) => c.order)).toEqual([1, 2])
    expect(coherence.criteria.map((c) => c.maxPoints)).toEqual([6, 4])
  })

  it("accepts an explicit total that matches the criteria", () => {
    const coherence = validateRubricCoherence(rubric({ maxPoints: 5 }), {
      assessmentMaxMarks: 20,
    })
    expect(coherence.maxPoints).toBe(5)
  })

  it("rejects a rubric with no criteria", () => {
    expect(() =>
      validateRubricCoherence(rubric({ criteria: [] }), { assessmentMaxMarks: 20 }),
    ).toThrowError(RubricValidationError)
  })

  it("rejects duplicate criterion labels", () => {
    expect(() =>
      validateRubricCoherence(
        rubric({
          criteria: [criterion({ label: "Argument" }), criterion({ label: "argument" })],
        }),
        { assessmentMaxMarks: 20 },
      ),
    ).toThrowError(/Duplicate criterion label/)
  })

  it("rejects non-positive weights and point ceilings", () => {
    expect(() =>
      validateRubricCoherence(rubric({ criteria: [criterion({ weight: 0 })] }), {
        assessmentMaxMarks: 20,
      }),
    ).toThrowError(/positive weight/)

    expect(() =>
      validateRubricCoherence(rubric({ criteria: [criterion({ maxPoints: 0 })] }), {
        assessmentMaxMarks: 20,
      }),
    ).toThrowError(/positive point ceiling/)
  })

  it("rejects a level that awards more than the criterion ceiling", () => {
    expect(() =>
      validateRubricCoherence(
        rubric({
          criteria: [
            criterion({
              maxPoints: 5,
              levels: [{ label: "Excellent", points: 6 }],
            }),
          ],
        }),
        { assessmentMaxMarks: 20 },
      ),
    ).toThrowError(/above the criterion ceiling/)
  })

  it("rejects an explicit total that disagrees with the criteria", () => {
    expect(() =>
      validateRubricCoherence(rubric({ maxPoints: 12 }), { assessmentMaxMarks: 20 }),
    ).toThrowError(/must equal the sum of criterion points/)
  })

  it("rejects a total above the assessment maximum", () => {
    expect(() =>
      validateRubricCoherence(rubric({ criteria: [criterion({ maxPoints: 25 })] }), {
        assessmentMaxMarks: 20,
      }),
    ).toThrowError(/cannot exceed the assessment maximum/)
  })
})

describe("parseRubricUpsertRequest", () => {
  it("rejects a non-positive weight at the schema boundary", () => {
    expect(() =>
      parseRubricUpsertRequest(
        {
          assessmentId: "a",
          title: "t",
          criteria: [{ label: "Argument", weight: -1, maxPoints: 5 }],
        },
        { assessmentMaxMarks: 20 },
      ),
    ).toThrow()
  })

  it("rejects an empty criteria array at the schema boundary", () => {
    expect(() =>
      parseRubricUpsertRequest(
        { assessmentId: "a", title: "t", criteria: [] },
        { assessmentMaxMarks: 20 },
      ),
    ).toThrow()
  })
})

describe("criterionWeightIsSane", () => {
  it("accepts finite positive weights and rejects the rest", () => {
    expect(criterionWeightIsSane(1)).toBe(true)
    expect(criterionWeightIsSane(0.25)).toBe(true)
    expect(criterionWeightIsSane(0)).toBe(false)
    expect(criterionWeightIsSane(-3)).toBe(false)
    expect(criterionWeightIsSane(Number.POSITIVE_INFINITY)).toBe(false)
    expect(criterionWeightIsSane(1001)).toBe(false)
  })
})
