import type { CalendarEventItem } from "@/lib/calendar"
import type { TeacherDeadlineItem } from "@/lib/teacher-planner"

/**
 * Pure view logic for the teacher planner.
 *
 * Same reasoning as `lib/calendar-view.ts`: this runs in a client component, and
 * this repo has no jsdom, so anything left inside a `useMemo` has no test. It lives
 * in its own module rather than in `calendar-view.ts` because it depends on the
 * deadline type, which is `server-only` — importing a *type* across that boundary is
 * fine, a value is not, so keeping the dependency to types only is what makes this
 * module safe to load in the browser.
 */

export type ReleaseFilter = "all" | "released" | "unreleased"

export type DeadlineFilters = {
  search: string
  release: ReleaseFilter
}

/**
 * Decision E3: the planner's events table excludes `ASSESSMENT` rows, because the
 * deadlines table owns them.
 *
 * Consequences worth noting, both of which fall out for free rather than needing
 * special cases:
 *
 * - the kind filter for the events table is built from the *stripped* list, so it
 *   never offers "Assessment" as an option that could only ever empty the table;
 * - an assessment therefore appears exactly once in the planner, in the table whose
 *   columns can actually describe it.
 *
 * Applied to the table only, not to the "Upcoming" panel: that panel is a time
 * window over the next few entries, and a teacher's next deadline is exactly what it
 * is for.
 */
export function eventsExcludingAssessments(
  events: readonly CalendarEventItem[],
): CalendarEventItem[] {
  return events.filter((event) => event.kind !== "ASSESSMENT")
}

/**
 * Search matches the title and the course code. It deliberately does not match the
 * kind or the release state — both have their own control, and folding them into the
 * free-text box makes a search for "released" mean something the user did not ask
 * for.
 */
export function filterDeadlines(
  deadlines: readonly TeacherDeadlineItem[],
  filters: DeadlineFilters,
): TeacherDeadlineItem[] {
  const needle = filters.search.trim().toLowerCase()

  return deadlines.filter((deadline) => {
    if (filters.release === "released" && !deadline.released) return false
    if (filters.release === "unreleased" && deadline.released) return false
    if (needle === "") return true
    return (
      deadline.title.toLowerCase().includes(needle) ||
      deadline.courseCode.toLowerCase().includes(needle)
    )
  })
}

/** Whether the user has narrowed the deadline list, so the empty state can differ. */
export function isDeadlineFiltered(filters: DeadlineFilters): boolean {
  return filters.search.trim() !== "" || filters.release !== "all"
}

export type ReleaseOption = { value: string; label: string }

/** The three release states, always offered: unlike kinds, all three are meaningful. */
export function releaseOptions(): ReleaseOption[] {
  return [
    { value: "all", label: "All assessments" },
    { value: "released", label: "Released" },
    { value: "unreleased", label: "Not released" },
  ]
}

/**
 * A one-line progress summary for a deadline.
 *
 * Two facts, not one: `submitted` counts work handed in, `graded` counts marks
 * published. Reporting only the first would imply grading had happened; reporting
 * only the second would hide unmarked work. Both are real counts, so both are shown
 * as numbers — this is not the em-dash case, where a missing value must not read as
 * a zero.
 */
export function deadlineProgress(deadline: TeacherDeadlineItem): string {
  const submitted = `${deadline.submitted} submitted`
  const graded = `${deadline.graded} graded`
  return `${submitted} · ${graded}`
}
