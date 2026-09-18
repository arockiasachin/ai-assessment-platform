import { describe, expect, it } from "vitest"

import { resolveRegimeForCourse } from "@/lib/analytics/grading-bands"
import {
  regimeForCourse,
  studentRegimeNote,
  type StudentCourseRegime,
} from "@/lib/grading/regime-view"

/**
 * The student-facing description of a grading regime (SN-16).
 *
 * The invariant that matters most is negative: `studentRegimeNote` must not be able to
 * *decide* a regime, only describe one. It takes a `RegimeDecision`, and for every absolute
 * fallback the title and detail are the resolved notice's own strings — so a student and a
 * teacher can never be shown two different reasons for the same course. The assertions below
 * pin that identity rather than a paraphrase of it.
 */

/** A spread of marks wide enough that the standard deviation is not zero. */
const ELEVEN_TOTALS = [40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90]

function relativeDecision() {
  return resolveRegimeForCourse({
    category: "THEORY",
    enrolledCount: 20,
    publishedTotals: ELEVEN_TOTALS,
  })
}

describe("studentRegimeNote", () => {
  it("names relative bands for a relative course", () => {
    const decision = relativeDecision()
    expect(decision.regime).toBe("relative")

    const note = studentRegimeNote(decision)
    expect(note.regime).toBe("relative")
    expect(note.tone).toBe("info")
    expect(note.title).toBe("Graded on relative bands")
    // The letter is a course-grand-total fact, not a per-assessment one; a student who read
    // only "graded relatively" could expect the next quiz to carry a letter.
    expect(note.detail).toContain("grand total")
  })

  it("reuses the teacher's notice verbatim for category-unset", () => {
    const decision = resolveRegimeForCourse({
      category: null,
      enrolledCount: 20,
      publishedTotals: ELEVEN_TOTALS,
    })
    if (decision.regime !== "absolute") throw new Error("expected an absolute decision")

    const note = studentRegimeNote(decision)
    expect(note.title).toBe(decision.notice.title)
    expect(note.detail).toBe(decision.notice.detail)
    expect(note.tone).toBe(decision.notice.tone)
  })

  it("reuses the teacher's notice verbatim for a non-theory course", () => {
    const decision = resolveRegimeForCourse({
      category: "LABORATORY",
      enrolledCount: 40,
      publishedTotals: ELEVEN_TOTALS,
    })
    if (decision.regime !== "absolute") throw new Error("expected an absolute decision")

    const note = studentRegimeNote(decision)
    expect(decision.reason).toBe("non-theory-course")
    expect(note.title).toBe(decision.notice.title)
    expect(note.detail).toBe(decision.notice.detail)
  })

  it("reuses the teacher's notice verbatim for a small class", () => {
    const decision = resolveRegimeForCourse({
      category: "THEORY",
      enrolledCount: 9,
      publishedTotals: [60, 70],
    })
    if (decision.regime !== "absolute") throw new Error("expected an absolute decision")

    const note = studentRegimeNote(decision)
    expect(decision.reason).toBe("small-class")
    expect(note.title).toBe("Absolute bands (class of 9)")
    expect(note.title).toBe(decision.notice.title)
  })

  it("reuses the teacher's notice verbatim while metrics are still thin", () => {
    const decision = resolveRegimeForCourse({
      category: "THEORY",
      enrolledCount: 30,
      publishedTotals: [60, 70, 80],
    })
    if (decision.regime !== "absolute") throw new Error("expected an absolute decision")

    const note = studentRegimeNote(decision)
    expect(decision.reason).toBe("awaiting-base-metrics")
    expect(note.title).toBe(decision.notice.title)
    expect(note.detail).toBe(decision.notice.detail)
  })
})

describe("regimeForCourse", () => {
  const regimes: StudentCourseRegime[] = [
    {
      offeringId: "off-1",
      courseId: "course-1",
      courseCode: "MCSE501L",
      courseName: "Data Structures",
      note: studentRegimeNote(relativeDecision()),
    },
  ]

  it("finds the regime by the course id the student payload exposes", () => {
    expect(regimeForCourse(regimes, "course-1")?.offeringId).toBe("off-1")
  })

  it("returns null for a course the student has no regime for", () => {
    expect(regimeForCourse(regimes, "course-2")).toBeNull()
  })
})
