import { describe, expect, it } from "vitest"

import { toCalendarEventItem, type CalendarEventQueryRow } from "@/lib/calendar"
import { isUpcoming } from "@/lib/calendar-view"

/**
 * The calendar projection.
 *
 * Pure and database-free. The two things worth pinning are the **derived**
 * `location` (there is no column for it — decision E2) and the **fallback chain**
 * for `courseCode`, because an event hangs off an offering, an assessment, or
 * neither, and getting the precedence wrong silently blanks a whole column.
 */

function row(overrides: Partial<CalendarEventQueryRow> = {}): CalendarEventQueryRow {
  return {
    id: "evt_1",
    title: "Lecture — graphing linear functions",
    eventType: "CLASS",
    description: "Bring the practice set.",
    startAt: new Date("2026-09-19T09:00:00.000Z"),
    endAt: new Date("2026-09-19T10:30:00.000Z"),
    classRoom: { name: "Room 12" },
    offering: { course: { code: "DEMO-MATH-101" } },
    assessment: null,
    ...overrides,
  }
}

describe("toCalendarEventItem", () => {
  it("passes identity and the event type through", () => {
    const item = toCalendarEventItem(row())
    expect(item.id).toBe("evt_1")
    expect(item.title).toBe("Lecture — graphing linear functions")
    expect(item.kind).toBe("CLASS")
  })

  it("maps every EventType without translating it", () => {
    // The four enum names are the view union verbatim, so a translation table
    // would be a bug waiting to happen. If Prisma adds a fifth, this fails.
    for (const kind of ["CLASS", "ASSESSMENT", "HOLIDAY", "REMINDER"] as const) {
      expect(toCalendarEventItem(row({ eventType: kind })).kind).toBe(kind)
    }
  })

  it("derives location from the class room name", () => {
    // There is no `location` column; it is the class room or nothing (E2).
    expect(toCalendarEventItem(row()).location).toBe("Room 12")
  })

  it("leaves location null for an event with no class, so it renders an em dash", () => {
    const item = toCalendarEventItem(row({ classRoom: null, eventType: "HOLIDAY" }))
    expect(item.location).toBeNull()
    expect(item.location).not.toBe("")
  })

  it("prefers the offering's course code", () => {
    const item = toCalendarEventItem(
      row({
        offering: { course: { code: "OFFERING-CODE" } },
        assessment: { course: { code: "ASSESSMENT-CODE" } },
      }),
    )
    expect(item.courseCode).toBe("OFFERING-CODE")
  })

  it("falls back to the assessment's course code when there is no offering", () => {
    // An assessment event whose offering link is absent still knows its course.
    const item = toCalendarEventItem(
      row({ offering: null, assessment: { course: { code: "ASSESSMENT-CODE" } } }),
    )
    expect(item.courseCode).toBe("ASSESSMENT-CODE")
  })

  it("leaves the course code null when the event hangs off neither", () => {
    const item = toCalendarEventItem(
      row({ offering: null, assessment: null, eventType: "HOLIDAY" }),
    )
    expect(item.courseCode).toBeNull()
  })

  it("keeps a null endAt null rather than inventing a duration", () => {
    expect(toCalendarEventItem(row({ endAt: null })).endAt).toBeNull()
  })

  it("emits both timestamps as ISO strings", () => {
    const item = toCalendarEventItem(row())
    expect(item.startAt).toBe("2026-09-19T09:00:00.000Z")
    expect(item.endAt).toBe("2026-09-19T10:30:00.000Z")
  })

  it("carries the description into detail, and a missing one stays null", () => {
    expect(toCalendarEventItem(row()).detail).toBe("Bring the practice set.")
    expect(toCalendarEventItem(row({ description: null })).detail).toBeNull()
  })

  it("does not mutate the row it is given", () => {
    const input = row()
    toCalendarEventItem(input)
    expect(input.classRoom?.name).toBe("Room 12")
  })
})

describe("isUpcoming", () => {
  const now = new Date("2026-09-16T12:00:00.000Z")

  it("is true for an event in the future", () => {
    expect(isUpcoming(toCalendarEventItem(row()), now)).toBe(true)
  })

  it("is false for an event in the past", () => {
    const past = row({ startAt: new Date("2026-09-09T09:00:00.000Z") })
    expect(isUpcoming(toCalendarEventItem(past), now)).toBe(false)
  })

  it("treats an event starting exactly now as upcoming", () => {
    // Inclusive, so an event does not vanish from the panel in the same moment it
    // starts.
    const exact = row({ startAt: new Date(now.getTime()) })
    expect(isUpcoming(toCalendarEventItem(exact), now)).toBe(true)
  })

  it("derives from startAt, not from a stored flag", () => {
    // The whole point: `isUpcoming` in the database can go stale, so the panel
    // must ask the clock instead. This function takes no stored flag at all.
    const past = row({ startAt: new Date("2020-01-01T00:00:00.000Z") })
    expect(isUpcoming(toCalendarEventItem(past), now)).toBe(false)
  })
})
