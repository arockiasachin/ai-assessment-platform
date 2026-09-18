import type { GradingRegime, RegimeDecision } from "@/lib/analytics/grading-bands"

/**
 * Student-facing copy for the grading regime.
 *
 * ## Why this module exists
 *
 * `resolveRegimeForCourse` (`lib/analytics/grading-bands.ts`) decides whether a course is
 * graded on relative σ bands or VIT's absolute table, and for a fallback it also produces
 * the reason. That decision reached the teacher's analytics page only: a student looking at
 * their own marks saw no relative/absolute/band/letter string anywhere, so two cohorts graded
 * by opposite rules saw structurally identical pages (SN-16).
 *
 * This is the missing half — it **describes** an already-made `RegimeDecision` for a student.
 * It deliberately cannot decide a regime: it takes the decision as an argument and has no
 * inputs of its own, so there is still exactly one definition of the rule.
 *
 * Pure and free of `server-only`, so it is unit-testable and safe to import from the client
 * island that renders the notice (the same arrangement as `lib/grading/policy-view.ts`).
 *
 * ## The absolute branch reuses the notice verbatim
 *
 * `RegimeDecision` carries a `notice` for every absolute fallback, and its title/detail are
 * already the explanation of why absolute bands apply. Rendering those strings unchanged is
 * what keeps the student and the teacher reading the same reason rather than two paraphrases
 * that can drift. Only the relative branch needs new prose, because a relative decision has
 * no notice (it is the positive case, not a fallback).
 */

/** A tone the shared `Callout` accepts. Kept structural so this module needs no component import. */
export type RegimeTone = "info" | "warning"

export type StudentRegimeNote = {
  regime: GradingRegime
  tone: RegimeTone
  title: string
  detail: string
}

/**
 * The regime one offering is graded under, ready to render to a student.
 *
 * `offeringId` is retained even though the student view matches on `courseId` (the payload
 * it reads has no offering id — see `lib/student-assessments.ts`): it is what a future
 * migration to an offering-keyed payload will need, and dropping it would make that change
 * re-derive it.
 */
export type StudentCourseRegime = {
  offeringId: string
  courseId: string
  courseCode: string
  courseName: string
  note: StudentRegimeNote
}

/**
 * Describe an already-resolved regime for the student it applies to.
 *
 * Relative bands are the one case with no fallback notice to reuse, so the copy is written
 * here. It says the same thing two ways on purpose: the letter is a *position in this
 * class*, and it is awarded on the **course grand total** — a student who read only "graded
 * relatively" could reasonably expect the next quiz to carry a letter, which the platform
 * does not do (a single assessment is never letter-graded).
 */
export function studentRegimeNote(decision: RegimeDecision): StudentRegimeNote {
  if (decision.regime === "relative") {
    return {
      regime: "relative",
      tone: "info",
      title: "Graded on relative bands",
      detail:
        "Your final letter in this course is your position in the class's own distribution, not a fixed percentage. It is awarded on your course grand total — an individual assessment is never letter-graded on its own.",
    }
  }

  // Absolute: the rule that produced the fallback already explains itself, and the same
  // words are what the teacher's analytics callout renders.
  return {
    regime: "absolute",
    tone: decision.notice.tone,
    title: decision.notice.title,
    detail: decision.notice.detail,
  }
}

/**
 * The regime note for one course, or `null` when the student has none for it.
 *
 * `courseId` is the key the student assessment payload exposes (it carries no `offeringId`),
 * so the lookup is by course. A student enrolled in two offerings of one course would have
 * two entries and this returns the first; that ambiguity is what `StudentCourseRegime[]`
 * preserves, so a caller that needs both can group rather than look up.
 */
export function regimeForCourse(
  regimes: readonly StudentCourseRegime[],
  courseId: string,
): StudentCourseRegime | null {
  return regimes.find((regime) => regime.courseId === courseId) ?? null
}
