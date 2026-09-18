import { describe, expect, it } from "vitest"

import { classroomLabel } from "@/lib/classroom-label"

/**
 * The one definition of a classroom's display label (TN-24 / TL-6).
 *
 * The failure this guards against is concrete: the courses seed stores
 * `M.Tech (CSE) BDA — DSA — Section A`, and every reader appended the
 * `section` column, rendering `Section A A` on nine teacher pages. The rule is
 * idempotent — a name that already carries its section is left alone.
 */
describe("classroomLabel", () => {
  it("appends the section when the name does not carry it", () => {
    expect(classroomLabel("Grade 10", "A")).toBe("Grade 10 A")
    expect(classroomLabel("Main Hall", "B")).toBe("Main Hall B")
  })

  it("does not repeat a section the name already ends with", () => {
    expect(classroomLabel("M.Tech (CSE) BDA — DSA — Section A", "A")).toBe(
      "M.Tech (CSE) BDA — DSA — Section A",
    )
    expect(classroomLabel("Main Hall — Section B", "B")).toBe("Main Hall — Section B")
  })

  it("folds case when deciding the section is already present", () => {
    expect(classroomLabel("Physics — SECTION a", "A")).toBe("Physics — SECTION a")
  })

  it("requires a token boundary, so a section letter inside a word does not match", () => {
    // "Data" ends with "a" but is not the section "A".
    expect(classroomLabel("Intro to Data", "A")).toBe("Intro to Data A")
    expect(classroomLabel("Calculus", "A")).toBe("Calculus A")
  })

  it("treats a bare trailing token, dash and em dash as already carrying the section", () => {
    expect(classroomLabel("Grade 10 A", "A")).toBe("Grade 10 A")
    expect(classroomLabel("Grade 10-A", "A")).toBe("Grade 10-A")
    expect(classroomLabel("Grade 10 — A", "A")).toBe("Grade 10 — A")
  })

  it("returns the trimmed name when there is no section", () => {
    expect(classroomLabel("  Grade 10  ", null)).toBe("Grade 10")
    expect(classroomLabel("Grade 10", "")).toBe("Grade 10")
    expect(classroomLabel("Grade 10", "   ")).toBe("Grade 10")
  })

  it("handles a multi-character section and regex metacharacters literally", () => {
    expect(classroomLabel("Cohort", "Section A")).toBe("Cohort Section A")
    expect(classroomLabel("Cohort Section A", "Section A")).toBe("Cohort Section A")
    expect(classroomLabel("Cohort", "A+B")).toBe("Cohort A+B")
    expect(classroomLabel("Cohort A+B", "A+B")).toBe("Cohort A+B")
  })
})
