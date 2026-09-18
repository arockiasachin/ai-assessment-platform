import type { ArrearReason } from "@/lib/arrears"
import { formatPercent } from "@/lib/format"
import { PASS_MARK, type CourseOutcome } from "@/lib/grading/policy"
import type { StudentCourseOutcome } from "@/lib/student-course-outcome"

/**
 * Presentation logic for the completed-course surfaces: `/student/grades` and
 * `/student/arrears`.
 *
 * ## Why this is separate from the reader
 *
 * `lib/student-course-outcome.ts` is `server-only` and answers "what happened in each
 * course". This module answers "how do we say it, and in what order" — which is a
 * display decision, not a database one. Keeping it pure means the three distinctions
 * the pages exist to preserve are testable without a database:
 *
 * 1. **`not-judged` is not `fail`.** The verdict union is carried through untouched;
 *    nothing here maps an unjudgeable course onto a failure. A course is only ever
 *    "Failed" when `evaluateCourseOutcome` said so.
 * 2. **A missing number is `—`.** `grandTotal` is `null` when the FAT has no published
 *    mark, and `formatPercent(null)` renders an em dash. Nothing here substitutes `0`.
 * 3. **An arrear comes from `outcome.arrear`, never from `not-judged`.** The reader
 *    already computed it with `lib/arrears.ts`; these helpers only filter and label it,
 *    so the page cannot invent an arrear the rule did not stand behind.
 *
 * Type-only imports from the `server-only` reader, matching
 * `lib/student-grades-view`'s precedent — the import is erased, so this stays a pure
 * module usable from a test.
 */

export type OutcomeStatus = CourseOutcome["status"]

/** The verdict in a student's words. `not-judged` deliberately reads as neither outcome. */
export const OUTCOME_LABEL: Record<OutcomeStatus, string> = {
  pass: "Passed",
  fail: "Failed",
  "not-judged": "Not judged",
}

/**
 * A one-line gloss under each verdict, so a badge is never the only explanation.
 *
 * The `not-judged` line says "not a failure" out loud — that is the distinction the
 * page exists to make, and a bare "Not judged" chip next to a "Failed" chip leaves a
 * student to guess which is worse.
 */
export const OUTCOME_HINT: Record<OutcomeStatus, string> = {
  pass: "The weighted grand total reached the pass mark and the continuous-assessment gate was cleared.",
  fail: "The weighted grand total did not reach the pass mark, or the gate before the final assessment was not cleared.",
  "not-judged": "There is not enough evidence to judge this course yet. This is not a failure.",
}

/** The two arrear reasons the rule can produce, in a student's words. */
export const ARREAR_REASON_LABEL: Record<ArrearReason, string> = {
  failed: "Failed the final assessment",
  "did-not-appear": "Did not appear for the final assessment",
}

/** What each reason means, without promising an outcome the page cannot know. */
export const ARREAR_REASON_EXPLANATION: Record<ArrearReason, string> = {
  failed: "A published final-assessment mark was below the pass mark, so the course was failed.",
  "did-not-appear":
    "The course ended with no published final-assessment mark, which is recorded as not appearing for it.",
}

/** The evidence behind a verdict, spelled out. Never states a number that does not exist. */
export function outcomeExplanation(outcome: CourseOutcome): string {
  switch (outcome.status) {
    case "pass":
      return `Weighted grand total ${formatPercent(outcome.grandTotal, 1)} — at or above the ${PASS_MARK}% pass mark.`
    case "fail":
      if (outcome.reason === "below-pass-mark") {
        return `Weighted grand total ${formatPercent(outcome.grandTotal, 1)} — below the ${PASS_MARK}% pass mark.`
      }
      return `The final assessment could not be sat: the continuous-assessment result was ${formatPercent(outcome.catPercent)} against a minimum of ${outcome.minimum}%.`
    case "not-judged":
      return outcome.reason === "insufficient-cat-work"
        ? "Too little continuous-assessment work is marked for a verdict. This is not a failure."
        : "No published final-assessment mark, so the course cannot be judged yet. This is not a failure."
  }
}

/**
 * Newest period first, then term, then course code.
 *
 * The same total order `listStudentCourseOutcomes` sorts by, restated so a caller that
 * filters a subset — or a test that passes rows in any order — still gets a stable,
 * newest-first list. Two comparators would be two definitions of "newest"; this exists
 * so there is only one *here*.
 */
export function compareOutcomesNewestFirst(
  a: StudentCourseOutcome,
  b: StudentCourseOutcome,
): number {
  return (
    b.academicYear - a.academicYear ||
    a.term.localeCompare(b.term) ||
    a.courseCode.localeCompare(b.courseCode)
  )
}

/**
 * Completed courses only — the transcript view.
 *
 * `ended` is the completion predicate: an offering whose `endsOn` has passed. A
 * current-term course is deliberately excluded even when it has released marks, because
 * that reading belongs to Marks. A `not-judged` completed course *is* included — it has
 * finished, and hiding it would let "we cannot judge" masquerade as "nothing to show".
 */
export function completedCourses(
  outcomes: readonly StudentCourseOutcome[],
): StudentCourseOutcome[] {
  return outcomes.filter((outcome) => outcome.ended).sort(compareOutcomesNewestFirst)
}

/** One outstanding arrear, with the narrowed reason the rule produced. */
export type ArrearEntry = {
  offeringId: string
  courseCode: string
  courseName: string
  term: string
  academicYear: number
  reason: ArrearReason
}

/**
 * The outstanding list — `outcome.arrear`, never inferred from `not-judged`.
 *
 * The reason is narrowed at the boundary so a page cannot render an arrear without one,
 * and a course the rule did not flag has no entry at all.
 */
export function arrearEntries(outcomes: readonly StudentCourseOutcome[]): ArrearEntry[] {
  const entries: ArrearEntry[] = []
  for (const outcome of [...outcomes].sort(compareOutcomesNewestFirst)) {
    if (outcome.arrear === null) continue
    entries.push({
      offeringId: outcome.offeringId,
      courseCode: outcome.courseCode,
      courseName: outcome.courseName,
      term: outcome.term,
      academicYear: outcome.academicYear,
      reason: outcome.arrear,
    })
  }
  return entries
}

export type OutcomeSummary = {
  total: number
  passed: number
  failed: number
  notJudged: number
}

/** Counts by verdict, kept separate so the page can never add an arrear into a pass rate. */
export function summariseOutcomes(outcomes: readonly StudentCourseOutcome[]): OutcomeSummary {
  const summary: OutcomeSummary = { total: outcomes.length, passed: 0, failed: 0, notJudged: 0 }
  for (const outcome of outcomes) {
    if (outcome.outcome.status === "pass") summary.passed += 1
    else if (outcome.outcome.status === "fail") summary.failed += 1
    else summary.notJudged += 1
  }
  return summary
}
