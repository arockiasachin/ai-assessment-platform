import type { ArrearReason } from "@/lib/arrears"

/**
 * Pure view logic for the student course catalog.
 *
 * Like `lib/materials-view.ts` and `lib/calendar-view.ts`, this is kept out of the
 * component so it has a test: the dates are formatted with an explicit locale and
 * time zone (a missing locale caused a real hydration bug here before), and the
 * window labels used to render `— → —` for every row because both ends were null
 * and neither was special-cased (SN-19).
 *
 * The arrear copy lives here too, because the enrolment refusal and the catalogue's
 * acknowledgement affordance must say the same thing: the server's 409 body and the
 * disabled register control are two renderings of one message. It is pure and
 * client-safe, so the route and the client component share it rather than each
 * keeping its own sentence.
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

/**
 * Why an arrear triggered, in the student's terms.
 *
 * The refusal is **derived from grade data**, so it can in principle be wrong when
 * marking is incomplete. Naming the reason is therefore load-bearing rather than
 * decorative: it is what a student with a missing mark needs in order to contest a
 * block they believe is mistaken. The two reasons are kept distinct for the same
 * reason `lib/arrears.ts` keeps them distinct — "did not pass" and "was not marked"
 * call for different follow-ups.
 */
export function arrearReasonLabel(reason: ArrearReason): string {
  return reason === "failed"
    ? "you did not pass the final assessment"
    : "no final assessment mark was recorded for you"
}

/**
 * The full refusal for a new-course registration, naming the course and the reason.
 *
 * Ends with both ways out, because the gate must never be a dead end: acknowledge the
 * arrear to register for other courses, or re-register for the arrear's own course —
 * the one action that clears it.
 */
export function arrearRefusalMessage(input: {
  courseName: string
  courseCode: string
  term: string
  academicYear: number
  reason: ArrearReason
}): string {
  return (
    `You have an outstanding arrear in ${input.courseName} (${input.courseCode}, ` +
    `${input.term} ${input.academicYear}): ${arrearReasonLabel(input.reason)}. ` +
    `Acknowledge it to register for other courses, or re-register for ${input.courseCode} ` +
    `to clear it.`
  )
}
