/**
 * Pure view logic for the student course catalog.
 *
 * Like `lib/materials-view.ts` and `lib/calendar-view.ts`, this is kept out of the
 * component so it has a test: the dates are formatted with an explicit locale and
 * time zone (a missing locale caused a real hydration bug here before), and the
 * window labels used to render `— → —` for every row because both ends were null
 * and neither was special-cased (SN-19).
 */

const DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
})

/** `null` is "no date", so it renders as an em dash — never as an empty cell. */
export function formatCourseDate(iso: string | null): string {
  return iso ? DATE_FORMATTER.format(new Date(iso)) : "—"
}

/**
 * The registration window, when there is one.
 *
 * "— → —" was a range-shaped placeholder for "there is no window", which read as a
 * window the data had lost. "Not scheduled" says what it is; a one-sided window
 * names the side that exists rather than printing a dash beside it.
 */
export function registrationWindowLabel(input: {
  openAt: string | null
  closeAt: string | null
}): string {
  const { openAt, closeAt } = input
  if (!openAt && !closeAt) return "Not scheduled"
  if (openAt && !closeAt) return `Opens ${formatCourseDate(openAt)}`
  if (!openAt && closeAt) return `Closes ${formatCourseDate(closeAt)}`
  return `${formatCourseDate(openAt)} → ${formatCourseDate(closeAt)}`
}

/** The course's run dates, with the same "no window" handling as registration. */
export function courseRunWindowLabel(input: {
  startsOn: string | null
  endsOn: string | null
}): string {
  const { startsOn, endsOn } = input
  if (!startsOn && !endsOn) return "Not scheduled"
  if (startsOn && !endsOn) return `From ${formatCourseDate(startsOn)}`
  if (!startsOn && endsOn) return `Until ${formatCourseDate(endsOn)}`
  return `${formatCourseDate(startsOn)} → ${formatCourseDate(endsOn)}`
}
