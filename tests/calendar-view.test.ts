import { describe, expect, it } from "vitest"

import type { CalendarEventItem } from "@/lib/calendar"
import {
  calendarKindOptions,
  calendarMonthOptions,
  filterCalendarEvents,
  isFiltered,
  isUpcoming,
  monthKey,
  nextUpcoming,
} from "@/lib/calendar-view"

/**
 * Calendar view logic.
 *
 * Pure, and here rather than inside the component for the reason this repo keeps
 * rediscovering: no jsdom, no component-testing stack, so logic left in a `useMemo`
 * has no test at all. The kind and month selects render in a portal that snapshot
 * tooling cannot drive, so "does the month filter work" is only answerable here.
 */

function event(overrides: Partial<CalendarEventItem> = {}): CalendarEventItem {
  return {
    id: "evt_1",
    title: "Lecture — graphing linear functions",
    kind: "CLASS",
    startAt: "2026-09-19T09:00:00.000Z",
    endAt: "2026-09-19T10:30:00.000Z",
    location: "Room 12",
    courseCode: "DEMO-MATH-101",
    detail: "Bring the practice set.",
    ...overrides,
  }
}

const fixtures: CalendarEventItem[] = [
  event({ id: "a", title: "Lecture — graphing", kind: "CLASS", startAt: "2026-09-19T09:00:00Z" }),
  event({
    id: "d",
    title: "Quiz 1 closes this Friday",
    kind: "REMINDER",
    location: "Grade 10",
    startAt: "2026-09-21T09:00:00Z",
  }),
  event({
    id: "b",
    title: "Mid-term break",
    kind: "HOLIDAY",
    location: null,
    courseCode: null,
    startAt: "2026-10-07T00:00:00Z",
  }),
  event({
    id: "c",
    title: "Due: Linear Equations Check-in",
    kind: "ASSESSMENT",
    location: "Grade 10",
    startAt: "2026-10-19T08:00:00Z",
  }),
]

describe("monthKey", () => {
  it("groups by month and year in UTC with an explicit locale", () => {
    // Deterministic on both sides of hydration: an ambient locale or time zone here
    // is how a date-formatting hydration bug starts.
    expect(monthKey("2026-09-19T09:00:00.000Z")).toBe("September 2026")
    expect(monthKey("2026-10-07T00:00:00.000Z")).toBe("October 2026")
  })

  it("does not shift an event across a month boundary near midnight", () => {
    // 23:30 UTC on the 30th is still September in UTC, whatever the local zone is.
    expect(monthKey("2026-09-30T23:30:00.000Z")).toBe("September 2026")
  })
})

describe("filterCalendarEvents", () => {
  const none = { search: "", kind: "all" as const, month: "all" }

  it("returns everything when nothing is filtered", () => {
    expect(filterCalendarEvents(fixtures, none)).toHaveLength(4)
  })

  it("matches the title case-insensitively", () => {
    expect(
      filterCalendarEvents(fixtures, { ...none, search: "MID-TERM" }).map((e) => e.id),
    ).toEqual(["b"])
  })

  it("matches the location, since that is what 'search by location' promises", () => {
    const hits = filterCalendarEvents(fixtures, { ...none, search: "room 12" })
    expect(hits.map((e) => e.id)).toEqual(["a"])
  })

  it("does not crash on an event with a null location", () => {
    // The holiday has no location and no course; a naive `.includes` on null throws.
    const hits = filterCalendarEvents(fixtures, { ...none, search: "break" })
    expect(hits.map((e) => e.id)).toEqual(["b"])
  })

  it("ignores surrounding whitespace", () => {
    expect(filterCalendarEvents(fixtures, { ...none, search: "  break  " })).toHaveLength(1)
  })

  it("narrows by kind", () => {
    expect(filterCalendarEvents(fixtures, { ...none, kind: "CLASS" }).map((e) => e.id)).toEqual([
      "a",
    ])
  })

  it("narrows by month", () => {
    expect(
      filterCalendarEvents(fixtures, { ...none, month: "October 2026" }).map((e) => e.id),
    ).toEqual(["b", "c"])
  })

  it("applies kind, month and search together rather than either-or", () => {
    const hits = filterCalendarEvents(fixtures, {
      search: "due",
      kind: "ASSESSMENT",
      month: "October 2026",
    })
    expect(hits.map((e) => e.id)).toEqual(["c"])
    // The same search with a month that cannot match must return nothing.
    expect(
      filterCalendarEvents(fixtures, {
        search: "due",
        kind: "ASSESSMENT",
        month: "September 2026",
      }),
    ).toEqual([])
  })

  it("returns an empty list, not everything, when nothing matches", () => {
    expect(filterCalendarEvents(fixtures, { ...none, search: "zzz" })).toEqual([])
  })

  it("treats a whitespace-only search as no search", () => {
    expect(filterCalendarEvents(fixtures, { ...none, search: "   " })).toHaveLength(4)
  })

  it("does not mutate the list it is given", () => {
    const input = [...fixtures]
    filterCalendarEvents(input, { ...none, search: "break" })
    expect(input).toHaveLength(4)
  })
})

describe("isFiltered", () => {
  it("is false only when every control is at its default", () => {
    expect(isFiltered({ search: "", kind: "all", month: "all" })).toBe(false)
    expect(isFiltered({ search: "  ", kind: "all", month: "all" })).toBe(false)
  })

  it("is true when any control is set", () => {
    expect(isFiltered({ search: "x", kind: "all", month: "all" })).toBe(true)
    expect(isFiltered({ search: "", kind: "HOLIDAY", month: "all" })).toBe(true)
    expect(isFiltered({ search: "", kind: "all", month: "October 2026" })).toBe(true)
  })
})

describe("calendarKindOptions", () => {
  it("offers only the kinds present, plus All", () => {
    expect(calendarKindOptions(fixtures).map((o) => o.value)).toEqual([
      "all",
      "ASSESSMENT",
      "CLASS",
      "HOLIDAY",
      "REMINDER",
    ])
  })

  it("labels options from the shared map", () => {
    const options = calendarKindOptions(fixtures)
    expect(options.find((o) => o.value === "HOLIDAY")?.label).toBe("Holiday")
    expect(options[0]).toEqual({ value: "all", label: "All kinds" })
  })

  it("offers only All when there are no events", () => {
    expect(calendarKindOptions([])).toEqual([{ value: "all", label: "All kinds" }])
  })
})

describe("calendarMonthOptions", () => {
  it("lists only the months present, in chronological order", () => {
    expect(calendarMonthOptions(fixtures).map((o) => o.value)).toEqual([
      "all",
      "September 2026",
      "October 2026",
    ])
  })

  it("orders by date, not by the order events arrive", () => {
    const reversed = [...fixtures].reverse()
    expect(calendarMonthOptions(reversed).map((o) => o.value)).toEqual([
      "all",
      "September 2026",
      "October 2026",
    ])
  })

  it("offers only All when there are no events", () => {
    expect(calendarMonthOptions([])).toEqual([{ value: "all", label: "All months" }])
  })
})

describe("isUpcoming", () => {
  const now = new Date("2026-09-20T12:00:00.000Z")

  it("is true for a future event and false for a past one", () => {
    // `d` starts on the 21st, `a` on the 19th, so the same `now` separates them.
    expect(isUpcoming(fixtures[1], now)).toBe(true)
    expect(isUpcoming(fixtures[0], now)).toBe(false)
  })

  it("treats an event starting exactly now as upcoming", () => {
    expect(isUpcoming(event({ startAt: now.toISOString() }), now)).toBe(true)
  })
})

describe("nextUpcoming", () => {
  const now = new Date("2026-09-20T12:00:00.000Z")

  it("returns only future events", () => {
    expect(nextUpcoming(fixtures, now).map((e) => e.id)).toEqual(["d", "b", "c"])
  })

  it("preserves the incoming order, which the reader already sorted ascending", () => {
    const ids = nextUpcoming(fixtures, now).map((e) => e.id)
    const starts = nextUpcoming(fixtures, now).map((e) => e.startAt)
    expect([...starts].sort()).toEqual(starts)
    expect(ids[0]).toBe("d")
  })

  it("caps the list at the requested number", () => {
    expect(nextUpcoming(fixtures, now, 2).map((e) => e.id)).toEqual(["d", "b"])
  })

  it("returns nothing when every event is in the past", () => {
    // The empty-state branch of the Upcoming panel.
    const past = [event({ id: "x", startAt: "2020-01-01T00:00:00Z" })]
    expect(nextUpcoming(past, now)).toEqual([])
  })
})
