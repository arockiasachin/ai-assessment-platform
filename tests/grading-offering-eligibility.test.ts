import { describe, expect, it } from "vitest"

import type { OfferingGradingConfigValue } from "@/lib/contracts/courses"
import { buildCatEligibility, type EligibilityStudent } from "@/lib/grading/offering-eligibility"
import type { AssessmentType } from "@/lib/generated/prisma/client"

/**
 * Who may sit the final assessment.
 *
 * The behaviour these protect is the owner's rule: a student needs a minimum continuous-
 * assessment score to sit the FAT. `evaluateFatEligibility` encoded it but nothing called it,
 * so before this module the rule applied to nobody.
 *
 * The tests are written around **which** marks count, because that is where this can go
 * quietly wrong: including the FAT's own mark, zero-filling an unmarked assessment, or
 * treating a future-dated assessment as absent work would each produce a plausible percentage
 * and a wrong verdict.
 *
 * Three CAT assessments, so "some marked" and "mostly marked" are distinguishable — the
 * completion threshold is a ratio, and with two assessments a single mark lands exactly on it.
 */

const ASSESSMENTS: { id: string; title: string; type: AssessmentType; dueDate: Date }[] = [
  { id: "cat1", title: "Quiz 1", type: "QUIZ", dueDate: new Date("2026-09-01") },
  { id: "cat2", title: "Quiz 2", type: "QUIZ", dueDate: new Date("2026-09-15") },
  { id: "cat3", title: "Assignment 1", type: "ASSIGNMENT", dueDate: new Date("2026-10-01") },
  { id: "fat", title: "Final exam", type: "DESCRIPTIVE", dueDate: new Date("2026-12-01") },
]

/** CAT pool is `cat1`–`cat3`; `fat` is the last to fall due, so it is the derived FAT. */
const STORED: OfferingGradingConfigValue = {
  catWeight: 40,
  fatWeight: 60,
  finalAssessmentId: null,
  minimumCatPercent: 30,
}

/**
 * The clock every test is judged against, passed explicitly.
 *
 * Needed because the inclusion rule requires an assessment to be past due, so a fixture dated
 * relative to "today" would change a verdict depending on the day the suite ran.
 */
const NOW = new Date("2026-11-01")

/** Published unless a test says otherwise. */
const PUBLISHED = new Date("2026-10-15")

function student(
  id: string,
  marks: { assessmentId: string; percentage: number; publishedAt?: Date | null }[],
): EligibilityStudent {
  return {
    id,
    name: `Student ${id}`,
    registerNumber: `R-${id}`,
    marks: marks.map((mark) => ({
      assessmentId: mark.assessmentId,
      percentage: mark.percentage,
      publishedAt: mark.publishedAt === undefined ? PUBLISHED : mark.publishedAt,
    })),
  }
}

const allCat = (percentage: number) =>
  ["cat1", "cat2", "cat3"].map((assessmentId) => ({ assessmentId, percentage }))

function rowsFor(students: EligibilityStudent[], stored = STORED) {
  return buildCatEligibility(stored, ASSESSMENTS, students, { now: NOW })
}

describe("buildCatEligibility", () => {
  it("marks a student above the minimum as eligible, with their CAT percentage", () => {
    const [row] = rowsFor([
      student("s1", [
        { assessmentId: "cat1", percentage: 80 },
        { assessmentId: "cat2", percentage: 70 },
        { assessmentId: "cat3", percentage: 60 },
      ]),
    ])

    expect(row.status).toBe("eligible")
    expect(row.progress.percent).toBe(70)
    expect(row.progress.markedCount).toBe(3)
    expect(row.progress.totalCount).toBe(3)
  })

  it("fails the gate for a student below the minimum", () => {
    const [row] = rowsFor([student("s1", allCat(10))])

    expect(row.status).toBe("below-cat-minimum")
    expect(row.eligibility).toMatchObject({ reason: "below-cat-minimum", minimum: 30 })
  })

  it("reports insufficient work rather than failing a student on evidence that barely exists", () => {
    // One of three marked is 33% complete, below the default half — so the verdict is "not
    // enough marked yet", which is a fact about the marking, not about the student.
    const [row] = rowsFor([student("s1", [{ assessmentId: "cat1", percentage: 10 }])])

    expect(row.status).toBe("insufficient-cat-work")
    expect(row.progress.markedCount).toBe(1)
    expect(row.progress.totalCount).toBe(3)
  })

  it("judges at exactly the completion threshold rather than deferring", () => {
    // Three assessments, one named the FAT, so the pool is two and marking one is exactly 0.5.
    const threeAssessments = [ASSESSMENTS[0], ASSESSMENTS[1], ASSESSMENTS[2]]
    const [row] = buildCatEligibility(
      { ...STORED, finalAssessmentId: "cat3" },
      threeAssessments,
      [student("s1", [{ assessmentId: "cat1", percentage: 10 }])],
      { now: NOW },
    )

    expect(row.progress.totalCount).toBe(2)
    expect(row.progress.markedCount).toBe(1)
    expect(row.progress.completionRatio).toBe(0.5)
    expect(row.status).toBe("below-cat-minimum")
  })

  it("judges a fully-marked zero as below the minimum, not as missing work", () => {
    // A student who sat everything and scored nothing has a real 0% CAT. Collapsing that into
    // "insufficient work" would tell them to wait for marking that is already finished.
    const [row] = rowsFor([student("s1", allCat(0))])

    expect(row.status).toBe("below-cat-minimum")
    expect(row.progress.percent).toBe(0)
  })

  it("excludes an unpublished mark from the gate", () => {
    // The published-only rule, shared with the export. An unapproved AI suggestion is not a mark.
    const [row] = rowsFor([
      student("s1", [
        { assessmentId: "cat1", percentage: 90 },
        { assessmentId: "cat2", percentage: 90, publishedAt: null },
        { assessmentId: "cat3", percentage: 90, publishedAt: null },
      ]),
    ])

    expect(row.progress.markedCount).toBe(1)
    expect(row.progress.percent).toBe(90)
    expect(row.status).toBe("insufficient-cat-work")
  })

  it("excludes a mark for an assessment that is not yet due", () => {
    // `isMarkIncludedInMean` requires the due date to have passed, so a mean taken mid-term
    // does not contain an assessment students have not sat.
    // `cat2` falls due after the clock, so its published mark must not enter the mean.
    const future = ASSESSMENTS.map((assessment) =>
      assessment.id === "cat2" ? { ...assessment, dueDate: new Date("2026-12-15") } : assessment,
    )
    const [row] = buildCatEligibility(
      STORED,
      future,
      [
        student("s1", [
          { assessmentId: "cat1", percentage: 50 },
          { assessmentId: "cat2", percentage: 100 },
          { assessmentId: "cat3", percentage: 50 },
        ]),
      ],
      { now: NOW },
    )

    expect(row.progress.percent).toBe(50)
    expect(row.progress.markedCount).toBe(2)
  })

  it("does not let the FAT's own mark count toward the CAT gate", () => {
    // The whole point of the gate is that the final exam cannot rescue a student who did no
    // continuous work. Including the FAT's mark would invert the rule.
    const [row] = rowsFor([student("s1", [...allCat(0), { assessmentId: "fat", percentage: 100 }])])

    expect(row.progress.percent).toBe(0)
    expect(row.status).toBe("below-cat-minimum")
  })

  it("distinguishes a disabled gate from a cleared one", () => {
    // "No gate" and "passed the gate" are different facts, and only one is about the student.
    // The status must follow the course's configuration, not the student's marks — otherwise a
    // student with a good CAT score in a gated course would read as ungated.
    const [failing, passing] = rowsFor([student("s1", allCat(5)), student("s2", allCat(90))], {
      ...STORED,
      minimumCatPercent: null,
    })

    expect(failing.status).toBe("no-cat-gate")
    expect(passing.status).toBe("no-cat-gate")
  })

  it("moves the gate's pool when the policy names a different FAT", () => {
    // The pool follows the resolved configuration, so a teacher's choice moves the boundary
    // between "continuous assessment" and "final". Here `cat3` is the FAT, so its mark must not
    // count toward the gate even though it would by due date.
    const [row] = rowsFor([student("s1", [{ assessmentId: "cat3", percentage: 100 }])], {
      ...STORED,
      finalAssessmentId: "cat3",
    })

    // Everything except the named FAT is continuous assessment — including the exam that the
    // due-date heuristic would have chosen. So `cat3`'s mark must not count.
    //
    // The pool is 2, not 3: only CAT work that has **fallen due** counts toward the gate, and
    // `fat` is still ahead of the clock. `cat3` is excluded both as the named FAT and, had it
    // stayed continuous, as not yet due.
    expect(row.progress.totalCount).toBe(2)
    expect(row.progress.markedCount).toBe(0)
    expect(row.status).toBe("insufficient-cat-work")
  })

  it("returns no rows below two assessments, where there is no split to judge", () => {
    const options = { now: NOW }
    expect(buildCatEligibility(STORED, [ASSESSMENTS[0]], [student("s1", [])], options)).toEqual([])
    expect(buildCatEligibility(STORED, [], [student("s1", [])], options)).toEqual([])
  })

  it("reports a verdict for every enrolled student, including one with no marks", () => {
    // A student with nothing marked must still appear — omitting them would hide exactly the
    // student the teacher needs to chase.
    const rows = rowsFor([student("s1", allCat(80)), student("s2", [])])

    expect(rows).toHaveLength(2)
    expect(rows[1].status).toBe("insufficient-cat-work")
    expect(rows[1].progress.percent).toBeNull()
  })

  it("uses the documented defaults for an unusable stored policy", () => {
    // The column is read on the export path; a corrupt policy must default, not throw.
    const rows = buildCatEligibility(
      { catWeight: "nope" } as never,
      ASSESSMENTS,
      [student("s1", allCat(40))],
      { now: NOW },
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe("eligible")
  })

  it("counts only CAT work that has fallen due in the completion ratio", () => {
    // The bug this pins: the ratio's denominator included assessments still ahead on the
    // calendar, so a course mid-term reported `insufficient-cat-work` for the whole cohort —
    // not because marking was behind, but because the term was not over. The gate could never
    // reach a verdict until the final week.
    //
    // Here only `cat1` has fallen due and it is marked, so the cohort is judged. Under the old
    // denominator the ratio would be 1/3 and every student would read "too little marked".
    const mostlyAhead = [
      { ...ASSESSMENTS[0], dueDate: new Date("2026-09-01") },
      { ...ASSESSMENTS[1], dueDate: new Date("2026-12-01") },
      { ...ASSESSMENTS[2], dueDate: new Date("2026-12-15") },
      { ...ASSESSMENTS[3], dueDate: new Date("2027-01-15") },
    ]
    const [row] = buildCatEligibility(STORED, mostlyAhead, [
      student("s1", [{ assessmentId: "cat1", percentage: 80 }]),
    ])

    expect(row.progress.totalCount).toBe(1)
    expect(row.progress.completionRatio).toBe(1)
    expect(row.status).toBe("eligible")
  })

  it("returns no verdicts at all before any CAT work is due", () => {
    // An offering early in its term has no continuous assessment to judge, so it reports nothing
    // rather than failing everyone on work that has not happened.
    const allAhead = ASSESSMENTS.map((assessment) => ({
      ...assessment,
      dueDate: new Date("2027-01-01"),
    }))

    expect(buildCatEligibility(STORED, allAhead, [student("s1", [])])).toEqual([])
  })

  it("still excludes an unpublished mark from the judged pool", () => {
    // The published-only rule is separate from the due-date one and must survive the change:
    // the denominator correction must not start counting unapproved suggestions as marked.
    const pastOnly = [
      { ...ASSESSMENTS[0], dueDate: new Date("2026-09-01") },
      { ...ASSESSMENTS[1], dueDate: new Date("2026-12-01") },
      { ...ASSESSMENTS[2], dueDate: new Date("2026-12-15") },
      { ...ASSESSMENTS[3], dueDate: new Date("2027-01-15") },
    ]
    const [row] = buildCatEligibility(STORED, pastOnly, [
      student("s1", [{ assessmentId: "cat1", percentage: 90, publishedAt: null }]),
    ])

    expect(row.progress.totalCount).toBe(1)
    expect(row.progress.markedCount).toBe(0)
    expect(row.status).toBe("insufficient-cat-work")
  })

  it("preserves the caller's student order", () => {
    // The roster is ordered by register number at the query, and re-sorting here would silently
    // disagree with it.
    const rows = rowsFor([student("b", allCat(50)), student("a", allCat(50))])

    expect(rows.map((row) => row.studentId)).toEqual(["b", "a"])
  })
})
