import type { AssessmentType } from "@/lib/generated/prisma/enums"
import { ASSESSMENT_KIND_LABEL } from "@/lib/labels"
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
 * The type filter the list offers.
 *
 * `WRITTEN` is a **filter grouping, not a stored type**: it matches the
 * `DESCRIPTIVE` and `ASSIGNMENT` kinds, which the enum keeps separate and a
 * student thinks of as one thing ("writing"). It exists because the sidebar's
 * Assessments menu lists them together, and inventing a stored enum value to
 * make a menu read well would be the wrong trade.
 */
export type AssessmentTypeFilter = "all" | AssessmentType | "WRITTEN"

const ASSESSMENT_TYPES = [
  "QUIZ",
  "DESCRIPTIVE",
  "CODE",
  "GROUP_PROJECT",
  "ASSIGNMENT",
] as const satisfies readonly AssessmentType[]

/** The stored kinds the `WRITTEN` grouping expands to. */
const WRITTEN_TYPES: readonly AssessmentType[] = ["DESCRIPTIVE", "ASSIGNMENT"]

/**
 * The course scope the hub starts on: every course the student is enrolled in.
 *
 * The scope is a single course **or** All, never a multi-select, because the
 * point of the control is to pick the course hub the student is looking at.
 */
export const ASSESSMENT_COURSE_FILTER_ALL = "all"

/**
 * The type filter's own label map.
 *
 * `WRITTEN` and `all` are filter groupings with no entry in the shared kind map,
 * so they are added here. This is the vocabulary the FilterBar options, the
 * compact icon toggles and the "what is applied" summary all read, so none of the
 * three can render a different word for the same filter.
 */
export const ASSESSMENT_TYPE_FILTER_LABEL: Record<AssessmentTypeFilter, string> = {
  all: "All types",
  ...ASSESSMENT_KIND_LABEL,
  WRITTEN: "Written and assignments",
}

export const ASSESSMENT_STATUS_FILTER_LABEL: Record<AssessmentStatusFilter, string> = {
  all: "All statuses",
  graded: "Graded",
  pending: "Pending",
  overdue: "Overdue",
}

/** A select option whose value is constrained to the filter it configures. */
export type AssessmentFilterOption<T extends string> = { value: T; label: string }

/**
 * The type options the control offers, in order.
 *
 * Deliberately not derived from `Object.entries(ASSESSMENT_KIND_LABEL)`: that
 * reads as "every stored kind" and would offer Descriptive and Assignment as two
 * separate entries, while the sidebar links them together as "Written and
 * assignments". A menu entry the sidebar never links to is a worse menu.
 */
export function assessmentTypeFilterOptions(): AssessmentFilterOption<AssessmentTypeFilter>[] {
  return [
    { value: "all", label: ASSESSMENT_TYPE_FILTER_LABEL.all },
    { value: "QUIZ", label: ASSESSMENT_TYPE_FILTER_LABEL.QUIZ },
    { value: "WRITTEN", label: ASSESSMENT_TYPE_FILTER_LABEL.WRITTEN },
    { value: "CODE", label: ASSESSMENT_TYPE_FILTER_LABEL.CODE },
    { value: "GROUP_PROJECT", label: ASSESSMENT_TYPE_FILTER_LABEL.GROUP_PROJECT },
  ]
}

export function assessmentStatusFilterOptions(): AssessmentFilterOption<AssessmentStatusFilter>[] {
  return [
    { value: "all", label: ASSESSMENT_STATUS_FILTER_LABEL.all },
    { value: "graded", label: ASSESSMENT_STATUS_FILTER_LABEL.graded },
    { value: "pending", label: ASSESSMENT_STATUS_FILTER_LABEL.pending },
    { value: "overdue", label: ASSESSMENT_STATUS_FILTER_LABEL.overdue },
  ]
}

/**
 * Whether an item belongs to the selected course hub.
 *
 * `"all"` (or an unknown/empty value) matches everything, so the default scope is
 * the full list. The filter matches on `courseId`, not the code, because the code
 * is display data and two offerings of one course share it.
 */
export function matchesCourseFilter(
  item: Pick<StudentAssessmentItem, "courseId">,
  courseFilter: string,
): boolean {
  if (!courseFilter || courseFilter === ASSESSMENT_COURSE_FILTER_ALL) return true
  return item.courseId === courseFilter
}

/**
 * The filters currently applied, named in words rather than raw values.
 *
 * The compact icon toggles have no visible text, so this is what tells the
 * student what is narrowing the list without making them open a select — and it
 * reads the same label maps the controls do, so a `?type=QUIZ` link says "Type:
 * Quiz", never "QUIZ".
 */
export function activeAssessmentFilters(input: {
  courseLabel: string | null
  typeFilter: AssessmentTypeFilter
  statusFilter: AssessmentStatusFilter
}): string[] {
  const applied: string[] = []
  if (input.courseLabel) applied.push(`Course: ${input.courseLabel}`)
  if (input.typeFilter !== "all") {
    applied.push(`Type: ${ASSESSMENT_TYPE_FILTER_LABEL[input.typeFilter]}`)
  }
  if (input.statusFilter !== "all") {
    applied.push(`Status: ${ASSESSMENT_STATUS_FILTER_LABEL[input.statusFilter]}`)
  }
  return applied
}

/**
 * Whether an item matches the type filter.
 *
 * The single definition shared by the Select and the sidebar's `?type=` links,
 * so the menu and the control cannot disagree about what "Written and
 * assignments" means.
 */
export function matchesTypeFilter(
  item: Pick<StudentAssessmentItem, "type">,
  filter: AssessmentTypeFilter,
): boolean {
  if (filter === "all") return true
  if (filter === "WRITTEN") return WRITTEN_TYPES.includes(item.type)
  return item.type === filter
}

/**
 * Read a `?type=` value from the URL, falling back to `all`.
 *
 * An unknown value is ignored rather than passed to the filter, so a stale or
 * hand-edited link shows the list rather than an empty one.
 */
export function parseAssessmentTypeFilter(value: string | null | undefined): AssessmentTypeFilter {
  if (value === "WRITTEN") return "WRITTEN"
  if (value && (ASSESSMENT_TYPES as readonly string[]).includes(value)) {
    return value as AssessmentType
  }
  return "all"
}

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
