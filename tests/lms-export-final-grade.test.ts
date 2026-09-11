import { describe, expect, it } from "vitest"

import type { FinalGradeConfig } from "@/lib/contracts/lms-export"
import { computeFinalGrade, resolveMarks, type GradeCandidateInput } from "@/lib/lms-export"

/**
 * The two invariants this pod exists to protect:
 *  - an unpublished modern `Grade` is excluded from a final grade, and
 *  - a modern `Grade` row always takes precedence over a legacy `AssessmentGrade`.
 */
describe("resolveMarks — published-only and modern-over-legacy", () => {
  it("includes a published modern grade", () => {
    const resolved = resolveMarks([
      {
        assessmentId: "a1",
        modern: { points: 16, maxPoints: 20, publishedAt: new Date("2026-11-01T00:00:00Z") },
        legacy: null,
      },
    ])
    expect(resolved.marks).toHaveLength(1)
    expect(resolved.marks[0]).toMatchObject({
      assessmentId: "a1",
      points: 16,
      maxPoints: 20,
      percentage: 80,
      origin: "modern-grade",
    })
    expect(resolved.excludedUnpublishedAssessmentIds).toEqual([])
  })

  it("excludes an unpublished modern grade and does NOT fall back to legacy", () => {
    const resolved = resolveMarks([
      {
        assessmentId: "a1",
        modern: { points: 20, maxPoints: 20, publishedAt: null },
        legacy: { marksObtained: 2, maxMarks: 20 },
      },
    ])
    expect(resolved.marks).toEqual([])
    expect(resolved.excludedUnpublishedAssessmentIds).toEqual(["a1"])
    expect(resolved.legacyFallbackAssessmentIds).toEqual([])
  })

  it("prefers a published modern grade over a legacy mark", () => {
    const resolved = resolveMarks([
      {
        assessmentId: "a1",
        modern: { points: 18, maxPoints: 20, publishedAt: new Date("2026-11-01T00:00:00Z") },
        legacy: { marksObtained: 2, maxMarks: 20 },
      },
    ])
    expect(resolved.marks).toHaveLength(1)
    expect(resolved.marks[0].origin).toBe("modern-grade")
    expect(resolved.marks[0].percentage).toBe(90)
    expect(resolved.legacyFallbackAssessmentIds).toEqual([])
  })

  it("uses the legacy mark only when no modern row exists", () => {
    const resolved = resolveMarks([
      {
        assessmentId: "a1",
        modern: null,
        legacy: { marksObtained: 5, maxMarks: 10 },
      },
    ])
    expect(resolved.marks).toHaveLength(1)
    expect(resolved.marks[0].origin).toBe("legacy-grade")
    expect(resolved.marks[0].percentage).toBe(50)
    expect(resolved.legacyFallbackAssessmentIds).toEqual(["a1"])
  })
})

describe("computeFinalGrade", () => {
  const config: FinalGradeConfig = {
    categories: [
      { id: "exams", name: "Exams", weight: 60, assessmentIds: ["a1"] },
      {
        id: "coursework",
        name: "Coursework",
        weight: 40,
        assessmentIds: ["a2", "a3"],
        assessmentWeights: { a2: 1, a3: 3 },
      },
    ],
  }

  it("weights categories and assessments", () => {
    // Exams 80; Coursework (80*1 + 90*3) / 4 = 87.5; final = 80*.6 + 87.5*.4 = 83.
    const resolved = resolveMarks([
      { assessmentId: "a1", modern: pub(16, 20), legacy: null },
      { assessmentId: "a2", modern: null, legacy: { marksObtained: 8, maxMarks: 10 } },
      { assessmentId: "a3", modern: pub(27, 30), legacy: null },
    ])
    const final = computeFinalGrade(config, resolved)
    expect(final.percentage).toBe(83)
    expect(final.letter).toBe("B")
    expect(final.completedWeight).toBe(100)
    expect(final.incomplete).toBe(false)
    expect(final.categories.map((category) => category.score)).toEqual([80, 87.5])
  })

  it("renormalises over categories that have marks", () => {
    // Only the 60-weight exams category has a mark, so the final grade is 80,
    // not 48 (which is what zero-scoring the ungraded category would produce).
    const resolved = resolveMarks([{ assessmentId: "a1", modern: pub(16, 20), legacy: null }])
    const final = computeFinalGrade(config, resolved)
    expect(final.percentage).toBe(80)
    expect(final.completedWeight).toBe(60)
    expect(final.totalWeight).toBe(100)
    expect(final.incomplete).toBe(true)
    const coursework = final.categories.find((category) => category.id === "coursework")
    expect(coursework).toMatchObject({ included: false, score: null })
  })

  it("never lets an unpublished suggestion influence the final grade", () => {
    const publishedOnly = computeFinalGrade(
      config,
      resolveMarks([
        { assessmentId: "a1", modern: pub(16, 20), legacy: null },
        { assessmentId: "a2", modern: null, legacy: { marksObtained: 8, maxMarks: 10 } },
        { assessmentId: "a3", modern: null, legacy: { marksObtained: 27, maxMarks: 30 } },
      ]),
    )

    // The same student, but with a high-scoring *unpublished* suggestion for a1
    // and a legacy mark that a naive implementation might fall back to.
    const withDraft = computeFinalGrade(
      config,
      resolveMarks([
        {
          assessmentId: "a1",
          modern: { points: 20, maxPoints: 20, publishedAt: null },
          legacy: null,
        },
        { assessmentId: "a2", modern: null, legacy: { marksObtained: 8, maxMarks: 10 } },
        { assessmentId: "a3", modern: null, legacy: { marksObtained: 27, maxMarks: 30 } },
      ]),
    )

    expect(publishedOnly.percentage).toBe(83)
    // a1 was dropped (not scored 0, not scored 20): the coursework category
    // renormalises to 87.5 and becomes the whole grade.
    expect(withDraft.percentage).toBe(87.5)
    expect(withDraft.percentage).not.toBe(100)
    expect(withDraft.percentage).not.toBe(48)
  })

  it("returns null when there are no usable marks", () => {
    const final = computeFinalGrade(
      config,
      resolveMarks([{ assessmentId: "a1", modern: pub(20, 20, null), legacy: null }]),
    )
    expect(final.percentage).toBeNull()
    expect(final.letter).toBeNull()
    expect(final.completedWeight).toBe(0)
  })
})

function pub(points: number, maxPoints: number, publishedAt: Date | null = new Date()) {
  return { points, maxPoints, publishedAt } satisfies GradeCandidateInput["modern"]
}
