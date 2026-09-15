import { describe, expect, it } from "vitest"

import { offeringLabel, toTeacherRosterRow, type RosterQueryRow } from "@/lib/teacher-roster"

/**
 * The class roster's projection.
 *
 * Pure and database-free. The invariant that matters most: a student with no
 * released marks averages `null`, **never `0`** — "not marked yet" and "scored
 * nothing" must not look the same on a roster a teacher reads.
 */

function row(overrides: Partial<RosterQueryRow> = {}): RosterQueryRow {
  return {
    offeringId: "off_1",
    offeringLabel: "MATH-101 · Algebra Foundations — Main Hall A · 2026 Odd",
    studentId: "stu_1",
    studentName: "Aarav Mehta",
    registerNumber: "REG-1",
    email: "aarav@example.edu",
    groupName: "Team Graphs",
    marks: [],
    submittedCount: 0,
    assessmentCount: 6,
    ...overrides,
  }
}

describe("offeringLabel", () => {
  it("joins the parts that exist", () => {
    expect(
      offeringLabel({
        course: { code: "MATH-101", name: "Algebra Foundations" },
        classRoom: { name: "Main Hall", section: "A" },
        term: "Odd",
        academicYear: 2026,
      }),
    ).toBe("MATH-101 · Algebra Foundations — Main Hall A · 2026 Odd")
  })

  it("omits an absent section", () => {
    expect(
      offeringLabel({
        course: { code: "MATH-101", name: "Algebra" },
        classRoom: { name: "Main Hall", section: null },
        term: "Odd",
        academicYear: 2026,
      }),
    ).toBe("MATH-101 · Algebra — Main Hall · 2026 Odd")
  })
})

describe("toTeacherRosterRow", () => {
  it("averages published marks as a percentage", () => {
    const result = toTeacherRosterRow(
      row({
        marks: [
          { points: 8, maxPoints: 10 },
          { points: 6, maxPoints: 10 },
        ],
      }),
    )
    expect(result.avgPercent).toBe(70)
  })

  it("resolves differing ceilings per assessment", () => {
    // 10/10 and 10/30 average to (100 + 33.33)/2 = 66.7
    const result = toTeacherRosterRow(
      row({
        marks: [
          { points: 10, maxPoints: 10 },
          { points: 10, maxPoints: 30 },
        ],
      }),
    )
    expect(result.avgPercent).toBe(66.7)
  })

  it("returns null, never zero, when nothing is marked", () => {
    const result = toTeacherRosterRow(row({ marks: [] }))
    expect(result.avgPercent).toBeNull()
    expect(result.avgPercent).not.toBe(0)
  })

  it("keeps a genuine zero mark as 0, distinct from no mark at all", () => {
    // A real 0/10 is a scored zero, so it must average to 0 — the distinction is
    // between "no mark" (null) and "scored zero" (0).
    const result = toTeacherRosterRow(row({ marks: [{ points: 0, maxPoints: 10 }] }))
    expect(result.avgPercent).toBe(0)
  })

  it("discards a non-finite or non-positive-ceiling mark rather than poisoning the mean", () => {
    const nan = toTeacherRosterRow(
      row({
        marks: [
          { points: "NaN", maxPoints: 10 },
          { points: 8, maxPoints: 10 },
        ],
      }),
    )
    expect(nan.avgPercent).toBe(80)

    const zeroCeiling = toTeacherRosterRow(
      row({
        marks: [
          { points: 5, maxPoints: 0 },
          { points: 8, maxPoints: 10 },
        ],
      }),
    )
    expect(zeroCeiling.avgPercent).toBe(80)
  })

  it("passes through identity, group and hand-in counts", () => {
    const result = toTeacherRosterRow(row({ groupName: null, submittedCount: 4 }))
    expect(result.groupName).toBeNull()
    expect(result.submittedCount).toBe(4)
    expect(result.assessmentCount).toBe(6)
    expect(result.studentName).toBe("Aarav Mehta")
  })
})
