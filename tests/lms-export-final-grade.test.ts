import { describe, expect, it } from "vitest"

import type { FinalGradeConfig } from "@/lib/contracts/lms-export"
import { computeFinalGrade, resolveMarks, type GradeCandidateInput } from "@/lib/lms-export"

/**
 * The invariant this pod exists to protect: an unpublished modern `Grade` is
 * excluded from a final grade. `AssessmentGrade` has been retired, so there is
 * no legacy fallback to reason about.
 */
describe("resolveMarks — published-only", () => {
  it("includes a published modern grade", () => {
    const resolved = resolveMarks([
      {
        assessmentId: "a1",
        modern: { points: 16, maxPoints: 20, publishedAt: new Date("2026-11-01T00:00:00Z") },
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

  it("excludes an unpublished modern grade", () => {
    const resolved = resolveMarks([
      { assessmentId: "a1", modern: { points: 20, maxPoints: 20, publishedAt: null } },
    ])
    expect(resolved.marks).toEqual([])
    expect(resolved.excludedUnpublishedAssessmentIds).toEqual(["a1"])
  })

  it("ignores an assessment with no modern grade at all", () => {
    const resolved = resolveMarks([{ assessmentId: "a1", modern: null }])
    expect(resolved.marks).toEqual([])
    expect(resolved.excludedUnpublishedAssessmentIds).toEqual([])
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
      { assessmentId: "a1", modern: pub(16, 20) },
      { assessmentId: "a2", modern: pub(8, 10) },
      { assessmentId: "a3", modern: pub(27, 30) },
    ])
    const final = computeFinalGrade(config, resolved)
    expect(final.percentage).toBe(83)
    // No letter assertion: the export deliberately carries no letter, because the
    // platform cannot know which of VIT's two regimes applies without a course
    // category. See the note on `FinalGradeComputation`.
    expect(final.completedWeight).toBe(100)
    expect(final.incomplete).toBe(false)
    expect(final.categories.map((category) => category.score)).toEqual([80, 87.5])
  })

  it("renormalises over categories that have marks", () => {
    // Only the 60-weight exams category has a mark, so the final grade is 80,
    // not 48 (which is what zero-scoring the ungraded category would produce).
    const resolved = resolveMarks([{ assessmentId: "a1", modern: pub(16, 20) }])
    const final = computeFinalGrade(config, resolved)
    expect(final.percentage).toBe(80)
    expect(final.completedWeight).toBe(60)
    expect(final.totalWeight).toBe(100)
    expect(final.incomplete).toBe(true)
    const coursework = final.categories.find((category) => category.id === "coursework")
    expect(coursework).toMatchObject({ included: false, score: null })
  })

  it("never lets an unpublished draft influence the final grade", () => {
    const publishedOnly = computeFinalGrade(
      config,
      resolveMarks([
        { assessmentId: "a1", modern: pub(16, 20) },
        { assessmentId: "a2", modern: pub(8, 10) },
        { assessmentId: "a3", modern: pub(27, 30) },
      ]),
    )

    // The same student, but with a high-scoring *unpublished* draft for a1.
    const withDraft = computeFinalGrade(
      config,
      resolveMarks([
        { assessmentId: "a1", modern: { points: 20, maxPoints: 20, publishedAt: null } },
        { assessmentId: "a2", modern: pub(8, 10) },
        { assessmentId: "a3", modern: pub(27, 30) },
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
      resolveMarks([{ assessmentId: "a1", modern: pub(20, 20, null) }]),
    )
    expect(final.percentage).toBeNull()
    expect(final.completedWeight).toBe(0)
  })

  it("prorates completed weight by the marked share of a category (TN-53)", () => {
    // DEMO-0004's shape: one 100-weight category of five equally-weighted
    // assessments, with one published mark. The student is one fifth of the way
    // through the term, not complete.
    const five: FinalGradeConfig = {
      categories: [
        {
          id: "all-assessments",
          name: "All assessments",
          weight: 100,
          assessmentIds: ["a1", "a2", "a3", "a4", "a5"],
        },
      ],
    }
    const final = computeFinalGrade(
      five,
      resolveMarks([{ assessmentId: "a1", modern: pub(0, 10) }]),
    )
    expect(final.percentage).toBe(0)
    expect(final.completedWeight).toBe(20)
    expect(final.totalWeight).toBe(100)
    expect(final.incomplete).toBe(true)
  })

  it("prorates by relative assessment weight when a category weights its assessments", () => {
    // Category weight 40 over a1(1) and a2(3); only the weight-3 assessment is
    // marked, so three quarters of the category's weight is accounted for.
    const weighted: FinalGradeConfig = {
      categories: [
        {
          id: "coursework",
          name: "Coursework",
          weight: 40,
          assessmentIds: ["a1", "a2"],
          assessmentWeights: { a1: 1, a2: 3 },
        },
      ],
    }
    const final = computeFinalGrade(
      weighted,
      resolveMarks([{ assessmentId: "a2", modern: pub(30, 40) }]),
    )
    expect(final.percentage).toBe(75)
    expect(final.completedWeight).toBe(30)
    expect(final.incomplete).toBe(true)
  })

  it("marks an empty configuration incomplete rather than done (TN-54)", () => {
    const final = computeFinalGrade({ categories: [] }, resolveMarks([]))
    expect(final.percentage).toBeNull()
    expect(final.completedWeight).toBe(0)
    expect(final.totalWeight).toBe(0)
    expect(final.incomplete).toBe(true)
    expect(final.categories).toEqual([])
  })
})

function pub(points: number, maxPoints: number, publishedAt: Date | null = new Date()) {
  return { points, maxPoints, publishedAt } satisfies GradeCandidateInput["modern"]
}
