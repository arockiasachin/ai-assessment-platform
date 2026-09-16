import { describe, expect, it } from "vitest"

import {
  mean,
  median,
  passBoundary,
  standardDeviation,
  summariseSpread,
  PASS_BOUNDARY_CAP,
} from "@/lib/analytics/statistics"
import {
  buildWeeklySeries,
  termWeeks,
  weekIndexOf,
  WEEK_MS,
  type DatedMark,
} from "@/lib/analytics/weekly-series"

/**
 * The descriptive statistics and the weekly series.
 *
 * Pure, so no database. The rule under test throughout is the same one the analytics
 * codebase already follows: **`null` for absent data, never `0`**, because a zero and
 * an absence are different facts and rendering the first for the second is how a
 * dashboard lies to a teacher.
 */

describe("mean", () => {
  it("averages a list", () => {
    expect(mean([2, 4, 6])).toBe(4)
  })

  it("returns null for an empty list, not zero", () => {
    expect(mean([])).toBeNull()
  })

  it("handles a single value", () => {
    expect(mean([73])).toBe(73)
  })

  it("does not round, because the caller decides precision", () => {
    expect(mean([1, 2])).toBe(1.5)
  })
})

describe("median", () => {
  it("takes the middle value of an odd-length list", () => {
    expect(median([5, 1, 3])).toBe(3)
  })

  it("averages the two middle values of an even-length list", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })

  it("returns null for an empty list", () => {
    expect(median([])).toBeNull()
  })

  it("sorts numerically, not lexically", () => {
    // `[100, 9, 80]` sorted as strings would be `[100, 80, 9]` and yield 80. The
    // numeric sort must yield 9 — a wrong median for any value above 99 is exactly
    // the kind of silent bug a hand-rolled sort produces.
    expect(median([100, 9, 80])).toBe(80)
    expect(median([9, 100])).toBe(54.5)
  })

  it("is unmoved by an outlier, which is why it sits beside the mean", () => {
    const withOutlier = [70, 72, 74, 76, 100]
    const withoutOutlier = [70, 72, 74, 76]
    expect(median(withOutlier)).toBe(74)
    expect(median(withoutOutlier)).toBe(73)
  })

  it("does not mutate the array it is given", () => {
    const input = [5, 1, 3]
    const before = [...input]
    median(input)
    expect(input).toEqual(before)
  })
})

describe("standardDeviation", () => {
  it("is zero when every value is the same", () => {
    expect(standardDeviation([70, 70, 70])).toBe(0)
  })

  it("computes population σ by default", () => {
    // Population σ of [2,4,4,4,5,5,7,9] is 2. Sample σ of the same is ~2.138.
    expect(standardDeviation([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 3)
  })

  it("computes sample σ when asked", () => {
    expect(standardDeviation([2, 4, 4, 4, 5, 5, 7, 9], { sample: true })).toBeCloseTo(2.138, 3)
  })

  it("returns null for an empty list", () => {
    expect(standardDeviation([])).toBeNull()
  })

  it("returns 0 for a single value in population mode", () => {
    // A lone value does not vary. Whether a cohort of one is worth reporting is the
    // caller's business, which is what the sample-size minimums are for.
    expect(standardDeviation([73])).toBe(0)
  })

  it("returns null for a single value in sample mode, rather than dividing by zero", () => {
    expect(standardDeviation([73], { sample: true })).toBeNull()
  })
})

describe("passBoundary", () => {
  it("lowers the pass line below 50 on a hard paper", () => {
    // mean 60, population σ = sqrt(800/3) ≈ 16.33 → mean − 2σ ≈ 27.34, below the cap,
    // so the boundary is 27.34. VIT: "if the mark range for F grade … is <50 … that
    // value is used … instead of 50". Students from 27.34 to 50 pass.
    expect(passBoundary([40, 60, 80])).toBe(27.34)
  })

  it("caps the pass line at 50 on a generous paper", () => {
    // mean 90, σ ≈ 4.08 → mean − 2σ ≈ 81.84, which exceeds 50, so the cap applies
    // and the boundary is 50. VIT: marks above 50 "may result in F grade … the
    // student will be awarded E and declared pass".
    expect(passBoundary([85, 90, 95])).toBe(PASS_BOUNDARY_CAP)
  })

  it("never returns above the cap", () => {
    // The direction of the inequality is the whole rule: a boundary above 50 would
    // fail students the institution passes.
    for (const cohort of [
      [40, 60, 80],
      [85, 90, 95],
      [70, 70, 70],
      [95, 99, 100],
    ]) {
      expect(passBoundary(cohort)).toBeLessThanOrEqual(PASS_BOUNDARY_CAP)
    }
  })

  it("returns the raw boundary when it sits below the cap", () => {
    // mean 50, population σ ≈ 16.33 → 17.34, below 50, so it is used as-is rather
    // than raised to the cap.
    expect(passBoundary([30, 50, 70])).toBe(17.34)
  })

  it("does not raise a low boundary to the cap", () => {
    // The specific bug an earlier version had: `max` would report 50 here and fail
    // everyone between 15 and 50, whom VIT passes.
    expect(passBoundary([10, 20, 30])).toBeLessThan(PASS_BOUNDARY_CAP)
  })

  it("returns null without a cohort rather than defaulting to a number", () => {
    expect(passBoundary([])).toBeNull()
  })

  it("returns the mean for a tight cohort, since σ is zero", () => {
    // Every student on 70: mean − 0 = 70, above the cap → 50. Nobody fails, which
    // is right for a cohort that all scored 70.
    expect(passBoundary([70, 70, 70])).toBe(PASS_BOUNDARY_CAP)
  })

  it("returns the mean when a tight cohort sits below the cap", () => {
    // Every student on 40: mean − 0 = 40, below 50 → 40. The cap does not lift it.
    expect(passBoundary([40, 40, 40])).toBe(40)
  })
})

describe("summariseSpread", () => {
  it("reports everything at once", () => {
    const spread = summariseSpread([70, 80, 90])
    expect(spread.count).toBe(3)
    expect(spread.mean).toBe(80)
    expect(spread.median).toBe(80)
    expect(spread.highest).toBe(90)
    expect(spread.lowest).toBe(70)
    expect(spread.standardDeviation).not.toBeNull()
  })

  it("returns nulls for an empty cohort rather than zeroes", () => {
    const spread = summariseSpread([])
    expect(spread).toEqual({
      count: 0,
      mean: null,
      median: null,
      standardDeviation: null,
      passBoundary: null,
      highest: null,
      lowest: null,
    })
  })

  it("quantises to two decimals like the existing cohort average", () => {
    const spread = summariseSpread([1, 2, 2])
    expect(spread.mean).toBe(1.67)
  })

  it("reports a median that can differ from the mean", () => {
    // The point of showing both: an outlier moves the mean and not the median.
    const spread = summariseSpread([70, 72, 74, 100])
    expect(spread.median).toBe(73)
    expect(spread.mean).not.toBe(73)
  })

  it("does not mutate the input", () => {
    const input = [3, 1, 2]
    const before = [...input]
    summariseSpread(input)
    expect(input).toEqual(before)
  })
})

describe("weekIndexOf", () => {
  const startsOn = new Date("2026-09-01T00:00:00.000Z")

  it("puts the first instant of the term in week 1", () => {
    expect(weekIndexOf(startsOn, startsOn)).toBe(1)
  })

  it("keeps the last instant of week 1 in week 1", () => {
    const lateInWeekOne = new Date(startsOn.getTime() + WEEK_MS - 1)
    expect(weekIndexOf(lateInWeekOne, startsOn)).toBe(1)
  })

  it("rolls to week 2 exactly one week in", () => {
    expect(weekIndexOf(new Date(startsOn.getTime() + WEEK_MS), startsOn)).toBe(2)
  })

  it("returns below 1 for a mark before the term", () => {
    // The caller drops these rather than folding them into week 1.
    expect(weekIndexOf(new Date(startsOn.getTime() - WEEK_MS), startsOn)).toBe(0)
  })
})

describe("termWeeks", () => {
  it("counts a 15-week term as 15", () => {
    const start = new Date("2026-09-01T00:00:00.000Z")
    expect(termWeeks(start, new Date(start.getTime() + 15 * WEEK_MS))).toBe(15)
  })

  it("never returns less than one", () => {
    const start = new Date("2026-09-01T00:00:00.000Z")
    expect(termWeeks(start, start)).toBe(1)
  })
})

describe("buildWeeklySeries", () => {
  const startsOn = new Date("2026-09-01T00:00:00.000Z")
  const endsOn = new Date(startsOn.getTime() + 15 * WEEK_MS)
  const term = { startsOn, endsOn }

  const mark = (weekOffset: number, percentage: number): DatedMark => ({
    at: new Date(startsOn.getTime() + weekOffset * WEEK_MS + 60 * 60 * 1000),
    percentage,
  })

  it("emits one point per week of the term", () => {
    const series = buildWeeklySeries([], term)
    expect(series?.weeks).toBe(15)
    expect(series?.points).toHaveLength(15)
  })

  it("averages the marks that fall in a week", () => {
    const series = buildWeeklySeries([mark(0, 60), mark(0, 80)], term)
    expect(series?.points[0]).toEqual({ week: 1, average: 70, count: 2 })
  })

  it("emits null, not zero, for a week with no assessed work", () => {
    // The behaviour the whole module exists to get right: zero would draw a point at
    // the bottom and read as "the class scored nothing".
    const series = buildWeeklySeries([mark(0, 70)], term)
    expect(series?.points[1]).toEqual({ week: 2, average: null, count: 0 })
  })

  it("drops a mark from before the term rather than folding it into week 1", () => {
    const before = { at: new Date(startsOn.getTime() - WEEK_MS), percentage: 100 }
    const series = buildWeeklySeries([before, mark(0, 70)], term)
    expect(series?.points[0]).toEqual({ week: 1, average: 70, count: 1 })
  })

  it("drops a mark past the end of the term", () => {
    const series = buildWeeklySeries([mark(20, 100)], term)
    expect(series?.points.every((point) => point.average === null)).toBe(true)
  })

  it("returns null when either term date is missing", () => {
    // No axis, so no series — rather than guessing a start and putting real marks in
    // the wrong week.
    expect(buildWeeklySeries([mark(0, 70)], { startsOn: null, endsOn })).toBeNull()
    expect(buildWeeklySeries([mark(0, 70)], { startsOn, endsOn: null })).toBeNull()
    expect(buildWeeklySeries([mark(0, 70)], { startsOn: null, endsOn: null })).toBeNull()
  })

  it("returns null when the window is not a window", () => {
    expect(buildWeeklySeries([], { startsOn: endsOn, endsOn: startsOn })).toBeNull()
  })

  it("clamps an absurd term length instead of allocating it", () => {
    const decade = new Date(startsOn.getTime() + 520 * WEEK_MS)
    const series = buildWeeklySeries([], { startsOn, endsOn: decade }, { maxWeeks: 30 })
    expect(series?.weeks).toBe(30)
  })

  it("rounds an average to two decimals", () => {
    const series = buildWeeklySeries([mark(0, 1), mark(0, 2), mark(0, 2)], term)
    expect(series?.points[0].average).toBe(1.67)
  })

  it("carries the term window back so a caller can label the axis", () => {
    const series = buildWeeklySeries([], term)
    expect(series?.startsOn).toBe(startsOn.toISOString())
    expect(series?.endsOn).toBe(endsOn.toISOString())
  })

  it("does not mutate the marks it is given", () => {
    const marks = [mark(0, 70), mark(1, 80)]
    const before = marks.map((entry) => entry.percentage)
    buildWeeklySeries(marks, term)
    expect(marks.map((entry) => entry.percentage)).toEqual(before)
  })
})
