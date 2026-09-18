import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import type { CalendarEventItem } from "@/lib/calendar"
import {
  calendarCourseOptions,
  filterCalendarEvents,
  isFiltered as isCalendarFiltered,
} from "@/lib/calendar-view"
import type { StudentMaterialView } from "@/lib/materials"
import {
  filterMaterials,
  isFiltered as isMaterialFiltered,
  materialCourseOptions,
} from "@/lib/materials-view"

/**
 * The course filter every course-related student list gets.
 *
 * Both lists are course-scoped now — a top filter with All as the default — and
 * the rule lives in the pure view modules because, with no jsdom and a portalled
 * Select, filtering left inside a `useMemo` has no test at all.
 */

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..")

function readCode(relative: string): string {
  return fs
    .readFileSync(path.join(repoRoot, relative), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
}

function event(overrides: Partial<CalendarEventItem> = {}): CalendarEventItem {
  return {
    id: "evt_1",
    title: "Lecture",
    kind: "CLASS",
    startAt: "2026-09-19T09:00:00.000Z",
    endAt: "2026-09-19T10:30:00.000Z",
    location: "Room 12",
    courseCode: "DEMO-MATH-101",
    detail: null,
    ...overrides,
  }
}

const events: CalendarEventItem[] = [
  event({ id: "math-class", courseCode: "DEMO-MATH-101" }),
  event({
    id: "phys-due",
    kind: "ASSESSMENT",
    courseCode: "DEMO-PHY-201",
    startAt: "2026-10-01T08:00:00.000Z",
  }),
  event({ id: "holiday", kind: "HOLIDAY", courseCode: null, location: null }),
]

function material(overrides: Partial<StudentMaterialView> = {}): StudentMaterialView {
  return {
    id: "mat_1",
    title: "Lecture notes",
    kind: "DOCUMENT",
    sourceUrl: null,
    mimeType: "text/plain",
    updatedAt: "2026-09-10T09:00:00.000Z",
    courseCode: "DEMO-MATH-101",
    indexed: true,
    chunks: 5,
    ...overrides,
  }
}

const materials: StudentMaterialView[] = [
  material({ id: "math-notes", courseCode: "DEMO-MATH-101" }),
  material({ id: "phys-slides", kind: "SLIDE_DECK", courseCode: "DEMO-PHY-201" }),
  material({ id: "math-video", kind: "VIDEO", courseCode: "DEMO-MATH-101" }),
]

const noFilters = { search: "", kind: "all" as const, month: "all", course: "all" }

describe("filterCalendarEvents course scope", () => {
  it("shows everything, including course-less holidays, for All", () => {
    expect(filterCalendarEvents(events, noFilters).map((row) => row.id)).toEqual([
      "math-class",
      "phys-due",
      "holiday",
    ])
  })

  it("scopes to one course", () => {
    expect(
      filterCalendarEvents(events, { ...noFilters, course: "DEMO-PHY-201" }).map((row) => row.id),
    ).toEqual(["phys-due"])
  })

  it("excludes a course-less holiday when scoped, rather than claiming it belongs", () => {
    // A holiday is institution-wide. Under a course scope it must not appear.
    const scoped = filterCalendarEvents(events, { ...noFilters, course: "DEMO-MATH-101" })
    expect(scoped.map((row) => row.id)).toEqual(["math-class"])
    expect(scoped.map((row) => row.id)).not.toContain("holiday")
  })

  it("treats an omitted course as All, so older callers keep working", () => {
    expect(filterCalendarEvents(events, { search: "", kind: "all", month: "all" })).toHaveLength(3)
  })

  it("applies the course with the other filters, not instead of them", () => {
    expect(
      filterCalendarEvents(events, {
        ...noFilters,
        kind: "ASSESSMENT",
        course: "DEMO-MATH-101",
      }),
    ).toEqual([])
  })
})

describe("calendarCourseOptions", () => {
  it("offers All plus only the courses present, sorted", () => {
    expect(calendarCourseOptions(events).map((option) => option.value)).toEqual([
      "all",
      "DEMO-MATH-101",
      "DEMO-PHY-201",
    ])
  })

  it("does not offer a course-less event as a fake course", () => {
    // The only event is a holiday with no course, so All is the whole menu.
    expect(calendarCourseOptions([event({ courseCode: null })])).toEqual([
      { value: "all", label: "All courses" },
    ])
  })

  it("offers only All when there are no events", () => {
    expect(calendarCourseOptions([])).toEqual([{ value: "all", label: "All courses" }])
  })
})

describe("calendar isFiltered includes the course scope", () => {
  it("is false when only the course is at its default", () => {
    expect(isCalendarFiltered({ search: "", kind: "all", month: "all", course: "all" })).toBe(false)
  })

  it("is true when a course is scoped", () => {
    expect(
      isCalendarFiltered({ search: "", kind: "all", month: "all", course: "DEMO-PHY-201" }),
    ).toBe(true)
  })
})

describe("filterMaterials course scope", () => {
  it("returns every material for All", () => {
    expect(filterMaterials(materials, { search: "", kind: "all", course: "all" })).toHaveLength(3)
  })

  it("scopes to one course", () => {
    expect(
      filterMaterials(materials, { search: "", kind: "all", course: "DEMO-MATH-101" }).map(
        (row) => row.id,
      ),
    ).toEqual(["math-notes", "math-video"])
  })

  it("applies the course with the kind, not either-or", () => {
    expect(
      filterMaterials(materials, {
        search: "",
        kind: "VIDEO",
        course: "DEMO-MATH-101",
      }).map((row) => row.id),
    ).toEqual(["math-video"])
    expect(
      filterMaterials(materials, { search: "", kind: "VIDEO", course: "DEMO-PHY-201" }),
    ).toEqual([])
  })
})

describe("materialCourseOptions", () => {
  it("offers All plus only the courses present, sorted", () => {
    expect(materialCourseOptions(materials).map((option) => option.value)).toEqual([
      "all",
      "DEMO-MATH-101",
      "DEMO-PHY-201",
    ])
  })

  it("offers only All when there are no materials", () => {
    expect(materialCourseOptions([])).toEqual([{ value: "all", label: "All courses" }])
  })
})

describe("material isFiltered includes the course scope", () => {
  it("is false when only the course is at its default", () => {
    expect(isMaterialFiltered({ search: "", kind: "all", course: "all" })).toBe(false)
  })

  it("is true when a course is scoped", () => {
    expect(isMaterialFiltered({ search: "", kind: "all", course: "DEMO-PHY-201" })).toBe(true)
  })
})

describe("the events bar moved to the table it filters", () => {
  const source = readCode("components/student-events-view.tsx")

  it("sits after the Upcoming panel and with the All events list", () => {
    const upcoming = source.indexOf('title="Upcoming"')
    const bar = source.indexOf("<FilterBar")
    const allEvents = source.indexOf('title="All events"')
    expect(upcoming).toBeGreaterThan(-1)
    expect(bar).toBeGreaterThan(upcoming)
    expect(allEvents).toBeGreaterThan(bar)
  })

  it("offers a course select with All as the default", () => {
    expect(source).toContain('id: "event-course"')
    expect(source).toContain("calendarCourseOptions")
    expect(source).toContain('label: "Course"')
  })
})

describe("the resources list has a top course filter", () => {
  const source = readCode("components/student-resources-view.tsx")

  it("offers a course select with All as the default", () => {
    expect(source).toContain('id: "material-course"')
    expect(source).toContain("materialCourseOptions")
    expect(source).toContain('label: "Course"')
  })

  it("passes the course into the shared filter", () => {
    expect(source).toContain("filterMaterials(materials, filters)")
  })
})
