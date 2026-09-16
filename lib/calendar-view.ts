import type { CalendarEventItem } from "@/lib/calendar"
import { CALENDAR_KIND_LABEL } from "@/lib/labels"

/**
 * Pure view logic for the calendar pages.
 *
 * Separate from `lib/calendar.ts` on purpose: that module is `server-only` (it
 * queries Prisma), and the filtering below runs in a client component. Importing a
 * *type* across that boundary is fine — `import type` is erased, so no runtime
 * import of a server-only module happens — but a value would not be.
 *
 * The logic lives here rather than inside a `useMemo` for the same reason as the
 * resources page: this repo runs in a node environment with no jsdom, so filtering
 * left inside a component has no test at all.
 */

export type CalendarKindFilter = "all" | CalendarEventItem["kind"]

export type CalendarFilters = {
  search: string
  kind: CalendarKindFilter
  /** A month key from `monthKey`, or `"all"`. */
  month: string
}

/**
 * Explicit locale and time zone, never the ambient ones.
 *
 * `toLocaleString()` without a locale was the cause of a real hydration bug in this
 * codebase (server renders `en-US`, the browser renders the user's locale, React
 * detects a mismatch). Month grouping is derived from this string on both sides, so
 * it has to be deterministic.
 */
const MONTH_FORMAT = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
})

/** The month bucket an event falls in, e.g. `"September 2026"`. */
export function monthKey(iso: string): string {
  return MONTH_FORMAT.format(new Date(iso))
}

/**
 * Search matches the title and the location. It deliberately does **not** match the
 * course code or the kind: those have their own controls, and folding them into the
 * free-text box makes a search for "Grade 10" silently mean something else.
 */
export function filterCalendarEvents(
  events: readonly CalendarEventItem[],
  filters: CalendarFilters,
): CalendarEventItem[] {
  const needle = filters.search.trim().toLowerCase()

  return events.filter((event) => {
    if (filters.kind !== "all" && event.kind !== filters.kind) return false
    if (filters.month !== "all" && monthKey(event.startAt) !== filters.month) return false
    if (needle === "") return true
    return (
      event.title.toLowerCase().includes(needle) ||
      (event.location?.toLowerCase().includes(needle) ?? false)
    )
  })
}

/** Whether the user has narrowed anything, so the empty state can differ. */
export function isFiltered(filters: CalendarFilters): boolean {
  return filters.search.trim() !== "" || filters.kind !== "all" || filters.month !== "all"
}

export type CalendarOption = { value: string; label: string }

/** Only the kinds actually present: a menu entry that can only empty the table is worse than a short menu. */
export function calendarKindOptions(events: readonly CalendarEventItem[]): CalendarOption[] {
  const present = [...new Set(events.map((event) => event.kind))].sort()
  // Labels come from the shared map, so the calendar and the planner cannot drift.
  return [
    { value: "all", label: "All kinds" },
    ...present.map((value) => ({ value, label: CALENDAR_KIND_LABEL[value] })),
  ]
}

/** Only the months actually present, in chronological order. */
export function calendarMonthOptions(events: readonly CalendarEventItem[]): CalendarOption[] {
  const months: string[] = []
  for (const event of [...events].sort((a, b) => a.startAt.localeCompare(b.startAt))) {
    const key = monthKey(event.startAt)
    if (!months.includes(key)) months.push(key)
  }
  return [{ value: "all", label: "All months" }, ...months.map((m) => ({ value: m, label: m }))]
}

/** Whether an event has not happened yet. */
export function isUpcoming(event: CalendarEventItem, now: Date): boolean {
  return new Date(event.startAt).getTime() >= now.getTime()
}

/**
 * The "Upcoming" panel: the next few entries after `now`, in order.
 *
 * `now` is a parameter rather than being read from the clock so the caller decides.
 * The page passes the **server's** now, which is what keeps this list out of the
 * hydration mismatch class of bug: a client-side `new Date()` would be evaluated
 * again during hydration and could disagree with the server about an event starting
 * in the next second.
 */
export function nextUpcoming(
  events: readonly CalendarEventItem[],
  now: Date,
  limit = 5,
): CalendarEventItem[] {
  return events.filter((event) => isUpcoming(event, now)).slice(0, limit)
}
