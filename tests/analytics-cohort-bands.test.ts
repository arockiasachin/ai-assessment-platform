import { describe, expect, it } from "vitest"

import { courseLetter, gradeBand } from "@/lib/gradebook"
import { buildCohortDistribution, DEFAULT_PASS_THRESHOLD } from "@/lib/analytics/cohort"
import { gradeDistribution } from "@/lib/analytics/legacy"

/**
 * The VIT banding that the client views use.
 *
 * These assert the *corrections*, because each replaced a number that appears in no VIT
 * document: the pass mark was 60 (VIT says 50), `E` did not exist (VIT's lowest passing
 * grade), and `D` sat at 60–69 (VIT puts it at 55–60).
 */

describe("courseLetter", () => {
  it("uses VIT's absolute Table-6 bands, not the old local ones", () => {
    // The old function returned A>=90, B>=80, C>=70, D>=60, F<60 — five letters, no E.
    expect(courseLetter(95)).toBe("S")
    expect(courseLetter(88)).toBe("A")
    expect(courseLetter(75)).toBe("B")
    expect(courseLetter(65)).toBe("C")
    expect(courseLetter(57)).toBe("D")
    expect(courseLetter(52)).toBe("E")
  })

  it("has an E band, which the previous version lacked entirely", () => {
    // 50-55 was previously rendered as F — a passing band shown as a failure.
    expect(courseLetter(50)).toBe("E")
    expect(courseLetter(54.99)).toBe("E")
  })

  it("fails only below 50", () => {
    expect(courseLetter(49.99)).toBe("F")
    expect(courseLetter(0)).toBe("F")
  })

  it("puts D at 55-60 rather than 60-69", () => {
    expect(courseLetter(58)).toBe("D")
    expect(courseLetter(62)).toBe("C")
  })
})

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
