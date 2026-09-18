import type { StudentAssessmentItem, SubmissionState } from "@/lib/student-assessments"

/**
 * Pure view logic for the student assessments list.
 *
 * Kept out of the component for the same reason as `lib/materials-view.ts` and
 * `lib/calendar-view.ts`: this repo runs in a node environment with no jsdom, so
 * anything left inside a `useMemo` has no test at all. The three rules here each
 * had two renderings that disagreed:
 *
 * - **SN-22/SN-25** — the due label and the status filter were derived ad hoc in
 *   the component. `dueLabel` read `daysUntilDue` first, which is a ceiling and
 *   reads `0` for anything up to a day past its deadline, so an assessment due
 *   yesterday afternoon still said "Due today" while the badge beside it was the
 *   destructive overdue tone. Checking `isPastDue` first is the whole fix.
 * - **SN-25** — the Overdue filter keyed on `isPastDue` alone, so a sitting that
 *   was handed in late was counted as still overdue. "Overdue" is an *actionable*
 *   state; once the work is in, the row is not overdue, whatever the badge said.
 * - **SN-18/SN-46** — the empty state blamed "the current filters" even when the
 *   student had no assessments and no filter was set.
 */

/** The status filter the list offers. */
export type AssessmentStatusFilter = "all" | "graded" | "pending" | "overdue"

/**
 * The states in which the student has handed the work in.
 *
 * `late` is included: a late submission is submitted, just after the deadline.
 * `draft` is deliberately **not**: a draft is not handed in, so a past-due draft
 * is still actionable and still overdue.
 */
const HANDED_IN_STATES: readonly SubmissionState[] = ["submitted", "resubmitted", "graded", "late"]

export function isHandedIn(state: SubmissionState): boolean {
  return HANDED_IN_STATES.includes(state)
}

/**
 * Whether an item matches the status filter.
 *
 * `pending` is "anything not graded", which is the same predicate the badge and
 * the summary use. `overdue` is past-due **and** not handed in — see
 * `isHandedIn` for why that second clause matters.
 */
export function matchesStatusFilter(
  item: Pick<StudentAssessmentItem, "isPastDue" | "submissionState">,
  filter: AssessmentStatusFilter,
): boolean {
  if (filter === "all") return true
  if (filter === "graded") return item.submissionState === "graded"
  if (filter === "pending") return item.submissionState !== "graded"
  return item.isPastDue && !isHandedIn(item.submissionState)
}

/**
 * The due-window badge.
 *
 * `isPastDue` is checked first. `daysUntilDue` is `ceil((due - now) / day)`, so it
 * is `0` for the whole first day past the deadline — using it as the first branch
 * (the previous bug) labelled an overdue item "Due today". For an overdue item the
 * magnitude is still a useful detail, so it is reported as "N days overdue"; below
 * one day it is just "Overdue".
 */
export function dueLabel(item: Pick<StudentAssessmentItem, "isPastDue" | "daysUntilDue">): string {
  if (item.isPastDue) {
    const days = Math.abs(item.daysUntilDue)
    return days === 0 ? "Overdue" : `${days} day${days === 1 ? "" : "s"} overdue`
  }
  if (item.daysUntilDue === 0) return "Due today"
  if (item.daysUntilDue === 1) return "Due tomorrow"
  return `Due in ${item.daysUntilDue} days`
}

/**
 * What the empty list means.
 *
 * "No assessments match the current filters" is only true when there is something
 * to filter. A student with no assessments at all was told to adjust filters that
 * could not exist (SN-18/SN-46); with none, the copy names the real state instead.
 */
export function assessmentsEmptyDescription(totalAssessments: number): string {
  if (totalAssessments === 0) {
    return "You have no assessments yet. Assessments appear here once your teachers release them to your class."
  }
  return "No assessments match the current filters."
}
