import "server-only"

import type { EventType } from "@/lib/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"
import { resolveTeacherStaffId } from "@/lib/teacher-staff"

/**
 * The calendar reader, shared by the student events page and the teacher planner.
 *
 * **This is deliberately not the dashboard's existing calendar read.**
 * `lib/gradebook-db.ts` has one, and reusing it would be a trap: it filters
 * `isUpcoming: true`, takes 100, projects to a shape with **no `location` and no
 * `courseCode`**, and *synthesises* assessment due-date events for assessments with
 * no calendar row. A calendar page needs its own query, or "the calendar" silently
 * means something different from what is drawn.
 *
 * **`isUpcoming` is not used as a filter.** It is a *stored* boolean rather than
 * something derived from `startAt`, and the seed is its only writer, so it can go
 * stale. The table renders every event in scope; the "Upcoming" panel filters on
 * `startAt >= now`. That is why the seed sets `isUpcoming: false` on past events
 * but nothing depends on it.
 *
 * **No index was added.** The composite index is `(classId, offeringId)`, and a
 * query filtering only `offeringId` cannot use it well — `offeringId` is the
 * trailing column and Postgres has no B-tree skip scan. `@@index([offeringId,
 * startAt])` is the index that *would* be needed; the honest trigger for adding it
 * is an observed slow plan, not a hunch, so it is recorded rather than created.
 */

/**
 * One calendar row as a page renders it.
 *
 * Named `CalendarEventItem` rather than the mockup's `CalendarEventView` on
 * purpose: `lib/mock/types.ts` already exports that name, and two types sharing a
 * name across the tree is how a reader ends up trusting the wrong one. (The same
 * reasoning renamed the materials view model.)
 *
 * `location` is **derived** from `classRoom.name` — there is no `location` column
 * (decision E2). A holiday has no class, so it renders `—`, which is the em-dash
 * rule applied to live data rather than only in a mapper test.
 */
export type CalendarEventItem = {
  id: string
  title: string
  /** `EventType`'s four names match the view union verbatim — no translation. */
  kind: EventType
  /** ISO. */
  startAt: string
  endAt: string | null
  location: string | null
  courseCode: string | null
  detail: string | null
}

/** The subset of a `calendarEvent.findMany` row the projection reads. */
export type CalendarEventQueryRow = {
  id: string
  title: string
  eventType: EventType
  description: string | null
  startAt: Date
  endAt: Date | null
  classRoom: { name: string } | null
  offering: { course: { code: string } } | null
  assessment: { course: { code: string } } | null
}

/**
 * Pure projection, so the read path has a test that needs no database.
 *
 * The course code prefers the offering and falls back to the assessment: an event
 * hangs off one, the other, or neither, and neither must render as `null` so the
 * page can show an em dash instead of an empty cell.
 */
export function toCalendarEventItem(row: CalendarEventQueryRow): CalendarEventItem {
  return {
    id: row.id,
    title: row.title,
    kind: row.eventType,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt?.toISOString() ?? null,
    location: row.classRoom?.name ?? null,
    courseCode: row.offering?.course.code ?? row.assessment?.course.code ?? null,
    detail: row.description,
  }
}

/**
 * Events attached to neither an offering nor a class: a holiday, or an
 * institution-wide reminder.
 *
 * These belong to **everyone**. There is no cohort to scope them to, so the only
 * sensible reading of an unscoped event is that it is for the whole institution —
 * and without this tier a seeded holiday would be invisible to every student, which
 * would look like a bug in the reader rather than in the scope.
 *
 * The converse is worth stating because nothing enforces it: an event with a
 * `classId` but **no** `offeringId` has no teacher or student link at all, so it
 * would be visible to nobody. No code path creates one — there is no calendar write
 * path, and the seed must not.
 */
const INSTITUTION_WIDE = { offeringId: null, classId: null } as const

/** The columns both readers need. Kept in one place so the two cannot drift. */
const eventSelect = {
  id: true,
  title: true,
  eventType: true,
  description: true,
  startAt: true,
  endAt: true,
  classRoom: { select: { name: true } },
  offering: { select: { course: { select: { code: true } } } },
  assessment: { select: { course: { select: { code: true } } } },
} as const

/**
 * A student's calendar: their offerings, their classes, and anything
 * institution-wide.
 *
 * Scoped to **active** enrolments, matching the materials reader and the
 * gradebook.
 *
 * **Release governs visibility**, and this is the half of S5 that makes the release
 * concept observable: an event hanging off an un-released assessment is excluded,
 * while the same event stays visible to its teacher in `listTeacherCalendar`. The
 * filter is written against `assessmentId` so that non-assessment events (a class,
 * a holiday) are unaffected — only events that genuinely hang off an assessment
 * are subject to it.
 *
 * No `take`. The scope is already narrow, a semester is tens of rows, and an
 * ascending truncation would silently hide the *far future* — the worst kind of
 * missing data, because the list still looks complete. When a real institution's
 * history enters the picture the correct control is a date window, not a bigger
 * number.
 */
export async function listStudentCalendar(user: AuthUser): Promise<CalendarEventItem[]> {
  const student = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  // A missing profile is a broken invariant, not an empty calendar, so this is the
  // one case that returns nothing at all.
  if (!student) return []

  const enrollments = await prisma.enrollment.findMany({
    where: { studentId: student.id, status: "active" },
    select: { offeringId: true, offering: { select: { classId: true } } },
  })

  // No early return for an unenrolled student. Institution-wide events belong to
  // everyone, so returning `[]` here would contradict the rule two screens up: a
  // student between registrations would stop seeing the mid-term break. Empty id
  // lists simply match nothing in the two cohort tiers.
  const offeringIds = enrollments.map((enrollment) => enrollment.offeringId)
  const classIds = [...new Set(enrollments.map((enrollment) => enrollment.offering.classId))]

  const rows = await prisma.calendarEvent.findMany({
    where: {
      AND: [
        {
          OR: [
            { offeringId: { in: offeringIds } },
            { classId: { in: classIds } },
            INSTITUTION_WIDE,
          ],
        },
        // Anything hanging off an assessment is only visible once released.
        {
          OR: [{ assessmentId: null }, { assessment: { is: { releasedAt: { not: null } } } }],
        },
      ],
    },
    orderBy: { startAt: "asc" },
    select: eventSelect,
  })

  return rows.map(toCalendarEventItem)
}

/**
 * A teacher's calendar: events on offerings they teach, plus events hanging off
 * assessments they created, plus anything institution-wide.
 *
 * The "assessments they created" clause is not redundant. A teacher can create an
 * assessment on a colleague's offering (ownership is "created it **or** teach its
 * offering"), and a calendar event for that assessment carries the colleague's
 * `offeringId` — so filtering on offering alone would hide the teacher's own
 * assessment from their own planner.
 *
 * **No release filter.** A teacher sees un-released assessments, which is the whole
 * point of being able to release them. That asymmetry with the student reader is
 * what `tests/calendar-read.test.ts` pins.
 */
export async function listTeacherCalendar(user: AuthUser): Promise<CalendarEventItem[]> {
  const staffId = await resolveTeacherStaffId(user.id)
  if (!staffId) return []

  const rows = await prisma.calendarEvent.findMany({
    where: {
      OR: [
        { offering: { is: { teacherId: staffId } } },
        { assessment: { is: { createdById: staffId } } },
        INSTITUTION_WIDE,
      ],
    },
    orderBy: { startAt: "asc" },
    select: eventSelect,
  })

  return rows.map(toCalendarEventItem)
}
