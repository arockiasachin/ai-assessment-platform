import { describe, expect, it } from "vitest"

import { buildAtRiskRoster } from "@/lib/analytics/at-risk"
import { resolveRegimeForCourse } from "@/lib/analytics/grading-bands"

/**
 * The at-risk roster's grouping rules.
 *
 * Pure, so no database. The assertions target the three-group split, because collapsing it is
 * the mistake that matters: "below the line" and "has not been marked" are different facts and
 * only one of them is about the student.
 */

function student(id: string, percentages: number[]) {
  return { studentId: id, fullName: `Student ${id}`, registerNumber: `R-${id}`, percentages }
}

/** An absolute decision, which is what a small or non-theory course gets. */
const absolute = resolveRegimeForCourse({
  category: "THEORY",
  enrolledCount: 8,
  publishedTotals: [50, 60, 70],
})

/** A relative decision with a known mean and sigma: mean 60, sigma 10 -> boundary 40. */
const relative = resolveRegimeForCourse({
  category: "THEORY",
  enrolledCount: 20,
  publishedTotals: [50, 60, 70, 50, 60, 70, 50, 60, 70, 50, 60],
})

describe("buildAtRiskRoster — absolute regime", () => {
  it("uses VIT's fixed pass mark of 50", () => {
    const roster = buildAtRiskRoster([student("a", [45])], absolute)
    expect(roster.boundary).toBe(50)
  })

  it("flags a student below 50 and clears one at 50", () => {
    // Inclusive at the boundary: VIT's E band starts at 50, so 50 passes.
    const roster = buildAtRiskRoster([student("a", [49.99]), student("b", [50])], absolute)
    expect(roster.atRisk.map((s) => s.studentId)).toEqual(["a"])
    expect(roster.aboveBoundaryCount).toBe(1)
  })

  it("reports an unmarked student separately, not as at risk by marks", () => {
    // The important rule. Folding them into `below-boundary` would flag them on evidence that
    // does not exist; folding them into "fine" would hide that they have done nothing.
    const roster = buildAtRiskRoster([student("a", []), student("b", [45])], absolute)
    expect(roster.atRisk).toHaveLength(2)
    expect(roster.atRisk.map((s) => s.group).sort()).toEqual([
      "below-boundary",
      "no-published-work",
    ])
    const unmarked = roster.atRisk.find((s) => s.group === "no-published-work")!
    expect(unmarked.grandTotal).toBeNull()
  })

  it("averages a student's published marks into one grand total", () => {
    // 30 and 60 average to 45, which is below the 50 line — so this proves the total is the
    // mean of the marks rather than any single one, and that three marks is one entry.
    const roster = buildAtRiskRoster([student("a", [30, 60])], absolute)
    expect(roster.atRisk).toHaveLength(1)
    expect(roster.atRisk[0].grandTotal).toBe(45)
    expect(roster.atRisk[0].group).toBe("below-boundary")
  })

  it("does not flag a student whose average clears the line", () => {
    const roster = buildAtRiskRoster([student("a", [40, 60, 80])], absolute)
    expect(roster.atRisk.filter((s) => s.group === "below-boundary")).toHaveLength(0)
    expect(roster.aboveBoundaryCount).toBe(1)
  })

  it("sorts worst first, with the unmarked group last", () => {
    const roster = buildAtRiskRoster(
      [student("a", []), student("b", [30]), student("c", [45])],
      absolute,
    )
    expect(roster.atRisk.map((s) => s.studentId)).toEqual(["b", "c", "a"])
  })

  it("returns an empty roster for an empty cohort", () => {
    const roster = buildAtRiskRoster([], absolute)
    expect(roster.atRisk).toEqual([])
    expect(roster.aboveBoundaryCount).toBe(0)
  })
})

describe("buildAtRiskRoster — relative regime", () => {
  it("uses min(mean − 2σ, 50), which is below 50 for this cohort", () => {
    // mean 60, sigma 10 -> 40, which is below the cap, so the line is 40.
    if (relative.regime !== "relative") throw new Error("expected relative")
    const roster = buildAtRiskRoster([], relative)
    expect(roster.boundary).toBeLessThan(50)
    expect(roster.boundary).toBeCloseTo(relative.mean - 2 * relative.standardDeviation, 2)
  })

  it("clears a student who would fail absolute bands", () => {
    // 45 is below the absolute 50 but above this cohort's relative 40 — the case that makes
    // the regime matter rather than being cosmetic.
    const roster = buildAtRiskRoster([student("a", [45])], relative)
    expect(roster.atRisk.filter((s) => s.group === "below-boundary")).toHaveLength(0)
    expect(roster.aboveBoundaryCount).toBe(1)
  })

  it("never lets the line rise above 50 for a generous cohort", () => {
    // A high-averaging class: mean 90, sigma 5 -> 80, which would fail students the
    // institution passes. The cap applies.
    const generous = resolveRegimeForCourse({
      category: "THEORY",
      enrolledCount: 20,
      publishedTotals: [85, 90, 95, 88, 92, 85, 90, 95, 88, 92, 85],
    })
    if (generous.regime !== "relative") throw new Error("expected relative")
    const roster = buildAtRiskRoster([student("a", [60])], generous)
    expect(roster.boundary).toBe(50)
    expect(roster.atRisk.filter((s) => s.group === "below-boundary")).toHaveLength(0)
  })
})
