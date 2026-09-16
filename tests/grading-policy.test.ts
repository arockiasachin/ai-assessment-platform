import { describe, expect, it } from "vitest"

import {
  CAT_CATEGORY_ID,
  catProgress,
  DEFAULT_CATEGORY_WEIGHTS,
  DEFAULT_FAT_MINIMUM_CAT_PERCENT,
  evaluateCourseOutcome,
  deriveDefaultGradingConfig,
  evaluateFatEligibility,
  FAT_CATEGORY_ID,
  isMarkIncludedInMean,
  isPastDue,
  PASS_MARK,
  type CatProgress,
  type GradingAssessmentInput,
} from "@/lib/grading/policy"

/**
 * Course grading policy.
 *
 * Pure, so no database. The assertions concentrate on the three rules that decide
 * whether a number is honest: which marks enter a mean, how the CAT/FAT split is
 * derived, and the fact that FAT eligibility has **three** outcomes rather than a
 * boolean.
 */

function assessment(
  id: string,
  dueDate: string,
  type: GradingAssessmentInput["type"] = "QUIZ",
): GradingAssessmentInput {
  return { id, type, dueDate }
}

describe("deriveDefaultGradingConfig", () => {
  const term = [
    assessment("q1", "2026-09-01T00:00:00Z"),
    assessment("q2", "2026-09-15T00:00:00Z"),
    assessment("q3", "2026-10-01T00:00:00Z"),
    assessment("fat", "2026-11-20T00:00:00Z"),
  ]

  it("splits into a CAT pool and a single FAT", () => {
    const config = deriveDefaultGradingConfig(term)!
    expect(config.categories.map((c) => c.id)).toEqual([CAT_CATEGORY_ID, FAT_CATEGORY_ID])
    expect(config.categories[1].assessmentIds).toEqual(["fat"])
  })

  it("puts every assessment but the last-due into the CAT pool", () => {
    const config = deriveDefaultGradingConfig(term)!
    expect(config.categories[0].assessmentIds).toEqual(["q1", "q2", "q3"])
  })

  it("identifies the FAT by due date, since nothing in the schema marks one", () => {
    // The heuristic, stated as a test: shuffle the input and the verdict is unchanged,
    // and moving the dates moves the FAT.
    const shuffled = [term[2], term[0], term[3], term[1]]
    expect(deriveDefaultGradingConfig(shuffled)!.categories[1].assessmentIds).toEqual(["fat"])

    const reordered = [
      assessment("a", "2026-09-01T00:00:00Z"),
      assessment("z", "2026-12-01T00:00:00Z"),
      assessment("m", "2026-10-01T00:00:00Z"),
    ]
    expect(deriveDefaultGradingConfig(reordered)!.categories[1].assessmentIds).toEqual(["z"])
  })

  it("uses the CAT 40 / FAT 60 split by default", () => {
    const config = deriveDefaultGradingConfig(term)!
    expect(config.categories[0].weight).toBe(DEFAULT_CATEGORY_WEIGHTS.CAT)
    expect(config.categories[1].weight).toBe(DEFAULT_CATEGORY_WEIGHTS.FAT)
    expect(config.categories[0].weight + config.categories[1].weight).toBe(100)
  })

  it("accepts an overridden split", () => {
    const config = deriveDefaultGradingConfig(term, { weights: { CAT: 60, FAT: 40 } })!
    expect(config.categories[0].weight).toBe(60)
    expect(config.categories[1].weight).toBe(40)
  })

  it("weights the CAT assessments equally, so their share follows the workload", () => {
    // No `assessmentWeights`: each carries 1, so a pool of n splits evenly. A teacher
    // can pin explicit weights instead.
    const config = deriveDefaultGradingConfig(term)!
    expect(config.categories[0].assessmentWeights).toBeUndefined()
  })

  it("returns null with fewer than two assessments", () => {
    // With one assessment there is no CAT/FAT distinction to draw, and a split would
    // invent one. The caller keeps the equal-weight single category instead.
    expect(deriveDefaultGradingConfig([])).toBeNull()
    expect(deriveDefaultGradingConfig([assessment("only", "2026-09-01T00:00:00Z")])).toBeNull()
  })

  it("does not mutate the assessments it is given", () => {
    const input = [...term]
    const before = input.map((a) => a.id)
    deriveDefaultGradingConfig(input)
    expect(input.map((a) => a.id)).toEqual(before)
  })
})

describe("isMarkIncludedInMean", () => {
  const past = { dueDate: "2026-09-01T00:00:00Z" }
  const future = { dueDate: "2026-12-01T00:00:00Z" }
  const published = { publishedAt: "2026-09-02T00:00:00Z" }
  const unpublished = { publishedAt: null }
  const now = new Date("2026-09-15T00:00:00Z")

  it("includes a published mark on a past-due assessment", () => {
    expect(isMarkIncludedInMean(past, published, now)).toBe(true)
  })

  it("excludes an assessment that is not yet due", () => {
    // The owner's rule: a mean taken mid-term must not contain an assessment students
    // have not sat. It also makes a weekly point stable while its assessment is open.
    expect(isMarkIncludedInMean(future, published, now)).toBe(false)
  })

  it("excludes an unpublished mark even when the assessment is past due", () => {
    expect(isMarkIncludedInMean(past, unpublished, now)).toBe(false)
  })

  it("excludes a mark that does not exist, rather than counting it as zero", () => {
    // Zero-filling drives the cohort boundary to a number that flags nobody — see
    // docs/plans/wave-3.md §8, U5.
    expect(isMarkIncludedInMean(past, null, now)).toBe(false)
  })

  it("includes a genuine zero, because a submitted zero is a real mark", () => {
    // "Exclude 0" is deliberately NOT implemented as "drop the value zero": doing so
    // would inflate a student's average, which is the same error as zero-filling in the
    // opposite direction. The mark here is published and past due; its value is
    // irrelevant to inclusion.
    expect(isMarkIncludedInMean(past, { publishedAt: "2026-09-02T00:00:00Z" }, now)).toBe(true)
  })

  it("treats an assessment due exactly now as included", () => {
    expect(isMarkIncludedInMean({ dueDate: now.toISOString() }, published, now)).toBe(true)
  })

  it("accepts Date and ISO string alike", () => {
    expect(isMarkIncludedInMean({ dueDate: new Date(past.dueDate) }, published, now)).toBe(true)
    expect(isMarkIncludedInMean(past, { publishedAt: new Date("2026-09-02T00:00:00Z") }, now)).toBe(
      true,
    )
  })
})

describe("isPastDue", () => {
  const now = new Date("2026-09-15T00:00:00Z")

  it("is true in the past and false in the future", () => {
    expect(isPastDue("2026-09-01T00:00:00Z", now)).toBe(true)
    expect(isPastDue("2026-12-01T00:00:00Z", now)).toBe(false)
  })

  it("is true exactly at the due instant", () => {
    expect(isPastDue(now.toISOString(), now)).toBe(true)
  })
})

describe("catProgress", () => {
  it("computes a weighted percentage over the included marks", () => {
    const progress = catProgress([
      { percentage: 80, included: true },
      { percentage: 60, included: true },
    ])
    expect(progress.percent).toBe(70)
    expect(progress.markedCount).toBe(2)
    expect(progress.totalCount).toBe(2)
    expect(progress.completionRatio).toBe(1)
  })

  it("honours per-assessment weights", () => {
    // A double-weighted 80 against a single-weighted 60 → (160+60)/3 = 73.33.
    const progress = catProgress([
      { percentage: 80, weight: 2, included: true },
      { percentage: 60, weight: 1, included: true },
    ])
    expect(progress.percent).toBe(73.33)
  })

  it("skips excluded marks rather than counting them as zero", () => {
    const progress = catProgress([
      { percentage: 90, included: true },
      { percentage: 0, included: false },
    ])
    expect(progress.percent).toBe(90)
    expect(progress.markedCount).toBe(1)
    expect(progress.totalCount).toBe(2)
    expect(progress.completionRatio).toBe(0.5)
  })

  it("reports a null percentage and zero completion when nothing is marked", () => {
    const progress = catProgress([{ percentage: 50, included: false }])
    expect(progress.percent).toBeNull()
    expect(progress.markedCount).toBe(0)
    expect(progress.completionRatio).toBe(0)
  })

  it("counts unmarked assessments when the caller passes them, which is required", () => {
    // The correct shape: one entry per CAT assessment, unmarked ones as included:false.
    // 1 of 3 marked is 33% complete, so the outcome is NOT judged — the student is not
    // failed on a pool that is two-thirds unmarked.
    const progress = catProgress([
      { percentage: 70, included: true },
      { percentage: 0, included: false },
      { percentage: 0, included: false },
    ])
    expect(progress.totalCount).toBe(3)
    expect(progress.completionRatio).toBeCloseTo(0.333, 3)
    expect(progress.percent).toBe(70)
    expect(evaluateCourseOutcome(progress, null)).toEqual({
      status: "not-judged",
      reason: "insufficient-cat-work",
    })
  })

  it("misreports completion if the caller passes only the marked assessments", () => {
    // **This test asserts the WRONG answer on purpose.** The precondition is that the
    // caller passes one entry per CAT assessment; passing only the marked one makes
    // `totalCount` 1, so completion reads as 100% and the insufficient-evidence guard
    // is cleared. That is the trap this module cannot catch from the inside, and it is
    // pinned here so the failure mode is visible in the suite rather than only in prose.
    const misused = catProgress([{ percentage: 70, included: true }])
    expect(misused.totalCount).toBe(1)
    expect(misused.completionRatio).toBe(1)
    expect(misused.percent).toBe(70)
  })

  it("handles an empty pool without dividing by zero", () => {
    expect(catProgress([])).toEqual({
      markedCount: 0,
      totalCount: 0,
      completionRatio: 0,
      percent: null,
    })
  })
})

describe("evaluateFatEligibility", () => {
  const full = (percent: number | null): CatProgress => ({
    markedCount: 10,
    totalCount: 10,
    completionRatio: 1,
    percent,
  })

  it("is disabled when no minimum is supplied", () => {
    // No defensible default exists for the minimum, so `null` means "no gate" rather
    // than a guessed threshold that could fail a student.
    expect(evaluateFatEligibility(full(10), { minimumCatPercent: null })).toEqual({
      eligible: true,
      catPercent: 10,
    })
  })

  it("passes a student at or above the minimum", () => {
    expect(evaluateFatEligibility(full(50), { minimumCatPercent: 50 })).toEqual({
      eligible: true,
      catPercent: 50,
    })
  })

  it("fails a student below the minimum, and says by how much", () => {
    const verdict = evaluateFatEligibility(full(42), { minimumCatPercent: 50 })
    expect(verdict).toEqual({
      eligible: false,
      reason: "below-cat-minimum",
      catPercent: 42,
      minimum: 50,
    })
  })

  it("reports insufficient CAT work as its own outcome, not as a failure", () => {
    // Three outcomes, not a boolean: "marking is unfinished" and "the student is below
    // the bar" are different facts, and only one of them is about the student.
    // Collapsing them would tell a student they cannot sit the exam when the truth is
    // that their teacher has not finished marking.
    const verdict = evaluateFatEligibility(
      { markedCount: 2, totalCount: 10, completionRatio: 0.2, percent: 30 },
      { minimumCatPercent: 50 },
    )
    expect(verdict).toEqual({ eligible: false, reason: "insufficient-cat-work" })
  })

  it("honours an overridden completion ratio", () => {
    const progress: CatProgress = {
      markedCount: 2,
      totalCount: 10,
      completionRatio: 0.2,
      percent: 30,
    }
    expect(
      evaluateFatEligibility(progress, {
        minimumCatPercent: 50,
        minimumCatCompletionRatio: 0.1,
      }),
    ).toEqual({ eligible: false, reason: "below-cat-minimum", catPercent: 30, minimum: 50 })
  })

  it("treats a null percentage with sufficient completion as below the minimum", () => {
    expect(evaluateFatEligibility(full(null), { minimumCatPercent: 50 })).toEqual({
      eligible: false,
      reason: "below-cat-minimum",
      catPercent: 0,
      minimum: 50,
    })
  })
})

describe("the FAT minimum default", () => {
  it("defaults to 30% so callers need not pass one", () => {
    expect(DEFAULT_FAT_MINIMUM_CAT_PERCENT).toBe(30)
  })

  it("applies the default when options omit it", () => {
    const full = (percent: number | null): CatProgress => ({
      markedCount: 10,
      totalCount: 10,
      completionRatio: 1,
      percent,
    })
    expect(evaluateFatEligibility(full(31), { minimumCatPercent: null }).eligible).toBe(true)
    // Passing `undefined` is not expressible on the type, but the course outcome treats
    // an omitted minimum as the default, which is what these assert.
    expect(evaluateCourseOutcome(full(31), null).status).not.toBe("fail")
    expect(evaluateCourseOutcome(full(29), null)).toMatchObject({
      status: "fail",
      reason: "fat-ineligible",
      catPercent: 29,
      minimum: 30,
    })
  })
})

describe("evaluateCourseOutcome", () => {
  const fullyMarked = (percent: number | null): CatProgress => ({
    markedCount: 10,
    totalCount: 10,
    completionRatio: 1,
    percent,
  })

  it("passes a student at or above the pass mark", () => {
    expect(evaluateCourseOutcome(fullyMarked(60), 60)).toEqual({ status: "pass", grandTotal: 60 })
  })

  it("passes a student on exactly 50", () => {
    // Inclusive: VIT's absolute E band starts AT 50. "Above 50%" read literally would
    // fail this student, so the boundary is pinned rather than assumed.
    expect(evaluateCourseOutcome(fullyMarked(60), PASS_MARK)).toEqual({
      status: "pass",
      grandTotal: PASS_MARK,
    })
  })

  it("fails a student just below the pass mark", () => {
    expect(evaluateCourseOutcome(fullyMarked(60), 49.99)).toEqual({
      status: "fail",
      grandTotal: 49.99,
      reason: "below-pass-mark",
    })
  })

  it("fails a student below the CAT minimum without consulting the grand total", () => {
    // The gate comes first, because a student who may not sit the FAT cannot have a
    // grand total — a high one must not rescue them.
    expect(evaluateCourseOutcome(fullyMarked(20), 95)).toMatchObject({
      status: "fail",
      reason: "fat-ineligible",
      catPercent: 20,
      minimum: 30,
    })
  })

  it("does not judge when too little of the CAT pool is marked", () => {
    // Not a failure: the marking is unfinished. Reporting it as a fail would be wrong
    // for every student mid-term.
    const partial: CatProgress = {
      markedCount: 2,
      totalCount: 10,
      completionRatio: 0.2,
      percent: 10,
    }
    expect(evaluateCourseOutcome(partial, 80)).toEqual({
      status: "not-judged",
      reason: "insufficient-cat-work",
    })
  })

  it("does not judge when the FAT has not been taken", () => {
    expect(evaluateCourseOutcome(fullyMarked(60), null)).toEqual({
      status: "not-judged",
      reason: "no-grand-total",
    })
  })

  it("honours an overridden pass mark and CAT minimum", () => {
    expect(evaluateCourseOutcome(fullyMarked(55), 55, { passMark: 60 })).toMatchObject({
      status: "fail",
      reason: "below-pass-mark",
    })
    expect(evaluateCourseOutcome(fullyMarked(55), 55, { minimumCatPercent: 60 })).toMatchObject({
      status: "fail",
      reason: "fat-ineligible",
    })
  })

  it("can disable the CAT gate entirely", () => {
    // `null` means "this course has no CAT gate", distinct from "the gate is at zero".
    expect(evaluateCourseOutcome(fullyMarked(5), 55, { minimumCatPercent: null })).toEqual({
      status: "pass",
      grandTotal: 55,
    })
  })
})
