import { describe, expect, it } from "vitest"

import { gradeBand } from "@/lib/gradebook"
import { buildCohortDistribution, DEFAULT_PASS_THRESHOLD } from "@/lib/analytics/cohort"
import { gradeDistribution } from "@/lib/analytics/legacy"

/**
 * The VIT banding the client views use.
 *
 * These assert the *corrections*, because each replaced a number that appears in no VIT document:
 * the pass mark was 60 (VIT says 50), `E` did not exist (VIT's lowest passing grade), and `D` sat
 * at 60–69 (VIT puts it at 55–60).
 *
 * The absolute Table-6 bands themselves are asserted in `analytics-grading-bands.test.ts`, against
 * `absoluteLetter`. They used to be exercised here through `courseLetter`, a per-mark helper that
 * was removed: it applied *course* bands to a single assessment's mark, and no surface asked for it.
 */

describe("gradeBand", () => {
  it("passes at 50, not 60", () => {
    expect(gradeBand(50)).toBe("pass")
    expect(gradeBand(49)).toBe("fail")
  })

  it("still reports null as ungraded rather than a band", () => {
    expect(gradeBand(null)).toBe("ungraded")
  })
})

describe("buildCohortDistribution", () => {
  const scores = [
    { studentId: "a", percentage: 95 },
    { studentId: "b", percentage: 88 },
    { studentId: "c", percentage: 75 },
    { studentId: "d", percentage: 65 },
    { studentId: "e", percentage: 57 },
    { studentId: "f", percentage: 52 },
    { studentId: "g", percentage: 45 },
  ]

  it("emits seven buckets, one per VIT letter", () => {
    expect(buildCohortDistribution(scores).buckets.map((b) => b.grade)).toEqual([
      "S",
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
    ])
  })

  it("counts each student into the right VIT band", () => {
    const buckets = buildCohortDistribution(scores).buckets
    for (const bucket of buckets) {
      expect(bucket.count, `${bucket.grade} count`).toBe(1)
    }
  })

  it("derives bucket bounds from the VIT bands, with E at 50-55", () => {
    const e = buildCohortDistribution(scores).buckets.find((b) => b.grade === "E")!
    expect(e.min).toBe(50)
    expect(e.max).toBe(55)
    expect(e.label).toBe("E (50–55%)")
  })

  it("defaults the pass threshold to VIT's 50", () => {
    expect(DEFAULT_PASS_THRESHOLD).toBe(50)
    expect(buildCohortDistribution(scores).passThreshold).toBe(50)
  })

  it("counts a mark of exactly 50 as a pass", () => {
    // Inclusive, matching VIT's E band starting at 50.
    const dist = buildCohortDistribution([
      { studentId: "x", percentage: 50 },
      { studentId: "y", percentage: 49 },
    ])
    expect(dist.passRate).toBe(50)
  })

  it("reports the same pass rate a 50-bar implies, not a 60-bar", () => {
    // The old default moved this from 25% to 50% — the fix, made visible.
    const twenty = Array.from({ length: 20 }, (_, i) => ({
      studentId: `s${i}`,
      percentage: i < 5 ? 70 : 30,
    }))
    expect(buildCohortDistribution(twenty).passRate).toBe(25)
    const half = Array.from({ length: 20 }, (_, i) => ({
      studentId: `s${i}`,
      percentage: i < 10 ? 55 : 45,
    }))
    expect(buildCohortDistribution(half).passRate).toBe(50)
  })

  it("keeps an empty cohort as null aggregates rather than zeroes", () => {
    const dist = buildCohortDistribution([])
    expect(dist.average).toBeNull()
    expect(dist.passRate).toBeNull()
    expect(dist.highest).toBeNull()
    expect(dist.lowest).toBeNull()
    expect(dist.buckets.every((bucket) => bucket.count === 0)).toBe(true)
  })
})

describe("legacy gradeDistribution", () => {
  it("returns seven buckets in VIT band order", () => {
    const marks = {}
    const students = [{ id: "s1" }] as never[]
    const assessments = [{ id: "a1" }] as never[]
    const buckets = gradeDistribution(marks, students, assessments)
    expect(buckets.map((b) => b.grade)).toEqual(["S", "A", "B", "C", "D", "E", "F"])
  })

  it("counts zero for every band when there are no marks", () => {
    const buckets = gradeDistribution({}, [] as never[], [] as never[])
    expect(buckets.every((bucket) => bucket.count === 0)).toBe(true)
  })
})
