import { describe, expect, it } from "vitest"

import type { FinalGradeConfig } from "@/lib/contracts/lms-export"
import {
  EXCLUDED_FROM_FINAL_GRADE_CATEGORY,
  LmsExportValidationError,
  assessmentCategoryLabel,
  defaultFinalGradeConfig,
  totalWeight,
  validateFinalGradeConfig,
} from "@/lib/lms-export"

function config(...categories: FinalGradeConfig["categories"]): FinalGradeConfig {
  return { categories }
}

describe("validateFinalGradeConfig", () => {
  it("accepts a coherent 60/40 configuration", () => {
    const valid = config(
      { id: "exams", name: "Exams", weight: 60, assessmentIds: ["a1"] },
      { id: "coursework", name: "Coursework", weight: 40, assessmentIds: ["a2", "a3"] },
    )
    expect(() => validateFinalGradeConfig(valid)).not.toThrow()
    expect(totalWeight(valid)).toBe(100)
  })

  it("accepts a floating-point sum inside the tolerance", () => {
    const valid = config(
      { id: "a", name: "A", weight: 33.33, assessmentIds: ["a1"] },
      { id: "b", name: "B", weight: 33.33, assessmentIds: ["a2"] },
      { id: "c", name: "C", weight: 33.34, assessmentIds: ["a3"] },
    )
    expect(() => validateFinalGradeConfig(valid)).not.toThrow()
  })

  it("rejects weights that do not sum to 100 with a clear 400", () => {
    const bad = config(
      { id: "exams", name: "Exams", weight: 60, assessmentIds: ["a1"] },
      { id: "coursework", name: "Coursework", weight: 30, assessmentIds: ["a2"] },
    )
    expect(() => validateFinalGradeConfig(bad)).toThrowError(LmsExportValidationError)
    expect(() => validateFinalGradeConfig(bad)).toThrowError(/sum to 100 \(they sum to 90\)/)
  })

  it("rejects an empty configuration and a zero-weight category", () => {
    expect(() => validateFinalGradeConfig(config())).toThrowError(/at least one category/)
    expect(() =>
      validateFinalGradeConfig(config({ id: "a", name: "A", weight: 0, assessmentIds: ["a1"] })),
    ).toThrowError(/weight must be a positive number/)
  })

  it("rejects duplicate category ids and names", () => {
    expect(() =>
      validateFinalGradeConfig(
        config(
          { id: "dup", name: "One", weight: 50, assessmentIds: ["a1"] },
          { id: "DUP", name: "Two", weight: 50, assessmentIds: ["a2"] },
        ),
      ),
    ).toThrowError(/ids must be unique/)
    expect(() =>
      validateFinalGradeConfig(
        config(
          { id: "one", name: "Same", weight: 50, assessmentIds: ["a1"] },
          { id: "two", name: "same", weight: 50, assessmentIds: ["a2"] },
        ),
      ),
    ).toThrowError(/names must be unique/)
  })

  it("rejects an assessment assigned to two categories", () => {
    const bad = config(
      { id: "one", name: "One", weight: 50, assessmentIds: ["a1", "a2"] },
      { id: "two", name: "Two", weight: 50, assessmentIds: ["a2"] },
    )
    expect(() => validateFinalGradeConfig(bad)).toThrowError(/may belong to only one category/)
  })

  it("rejects a category with no assessments and an unknown assessment", () => {
    expect(() =>
      validateFinalGradeConfig(config({ id: "one", name: "One", weight: 100, assessmentIds: [] })),
    ).toThrowError(/at least one assessment/)
    expect(() =>
      validateFinalGradeConfig(
        config({ id: "one", name: "One", weight: 100, assessmentIds: ["ghost"] }),
        { knownAssessmentIds: ["a1"] },
      ),
    ).toThrowError(/does not belong to this offering/)
  })

  it("rejects an assessment weight outside its category", () => {
    expect(() =>
      validateFinalGradeConfig(
        config({
          id: "one",
          name: "One",
          weight: 100,
          assessmentIds: ["a1"],
          assessmentWeights: { a2: 2 },
        }),
      ),
    ).toThrowError(/not in the category/)
    expect(() =>
      validateFinalGradeConfig(
        config({
          id: "one",
          name: "One",
          weight: 100,
          assessmentIds: ["a1"],
          assessmentWeights: { a1: 0 },
        }),
      ),
    ).toThrowError(/must be a positive number/)
  })
})

describe("defaultFinalGradeConfig", () => {
  it("places every assessment in one equal-weight category", () => {
    const derived = defaultFinalGradeConfig([{ id: "a1" }, { id: "a2" }])
    expect(derived.categories).toHaveLength(1)
    expect(derived.categories[0].weight).toBe(100)
    expect(derived.categories[0].assessmentIds).toEqual(["a1", "a2"])
    expect(() => validateFinalGradeConfig(derived)).not.toThrow()
  })
})

/**
 * TN-67: with a custom category config, an assessment outside it was labelled
 * "Uncategorized" in the OneRoster line items, which read as "counted, no category"
 * while the final grade excluded it. The label says what is true.
 */
describe("assessmentCategoryLabel", () => {
  it("returns the configured category name", () => {
    const cfg = config({ id: "exams", name: "Exams", weight: 100, assessmentIds: ["a1"] })

    expect(assessmentCategoryLabel(cfg, "a1")).toBe("Exams")
  })

  it("says an excluded assessment is not in the final grade, not Uncategorized", () => {
    const cfg = config({ id: "exams", name: "Exams", weight: 100, assessmentIds: ["a1"] })

    expect(assessmentCategoryLabel(cfg, "a2")).toBe(EXCLUDED_FROM_FINAL_GRADE_CATEGORY)
    expect(assessmentCategoryLabel(cfg, "a2")).not.toBe("Uncategorized")
  })

  it("labels every assessment when the equal-weight default covers them all", () => {
    const cfg = defaultFinalGradeConfig([{ id: "a1" }, { id: "a2" }])

    expect(assessmentCategoryLabel(cfg, "a1")).toBe(cfg.categories[0].name)
    expect(assessmentCategoryLabel(cfg, "a2")).toBe(cfg.categories[0].name)
  })
})
