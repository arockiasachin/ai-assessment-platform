import { describe, expect, it } from "vitest"

import type { CalendarEventItem } from "@/lib/calendar"
import {
  deadlineProgress,
  eventsExcludingAssessments,
  filterDeadlines,
  isDeadlineFiltered,
  releaseOptions,
} from "@/lib/planner-view"
import { toTeacherDeadlineItem, type TeacherDeadlineQueryRow } from "@/lib/teacher-planner"

/**
 * The planner's view logic and deadline projection.
 *
 * Pure, and here rather than in the component because this repo has no jsdom: logic
 * left inside a `useMemo` has no test at all, and the release select renders in a
 * portal that snapshot tooling cannot drive.
 */

function deadlineRow(overrides: Partial<TeacherDeadlineQueryRow> = {}): TeacherDeadlineQueryRow {
  return {
    id: "asm_1",
    title: "Linear Equations Check-in",
    type: "QUIZ",
    dueDate: new Date("2026-09-28T08:00:00.000Z"),
    maxMarks: 20,
    releasedAt: new Date("2026-09-14T08:00:00.000Z"),
    offering: { course: { code: "DEMO-MATH-101" } },
    _count: { submissions: 3, finalGrades: 1 },
    ...overrides,
  }
}

function deadline(overrides: Partial<ReturnType<typeof toTeacherDeadlineItem>> = {}) {
  return { ...toTeacherDeadlineItem(deadlineRow()), ...overrides }
}

function event(overrides: Partial<CalendarEventItem> = {}): CalendarEventItem {
  return {
    id: "evt_1",
    title: "Lecture — graphing linear functions",
    kind: "CLASS",
    startAt: "2026-09-19T09:00:00.000Z",
    endAt: "2026-09-19T10:30:00.000Z",
    location: "Grade 10",
    courseCode: "DEMO-MATH-101",
    detail: null,
    ...overrides,
  }
}

describe("toTeacherDeadlineItem", () => {
  it("passes the identity and calendar facts through", () => {
    const item = toTeacherDeadlineItem(deadlineRow())
    expect(item.id).toBe("asm_1")
    expect(item.title).toBe("Linear Equations Check-in")
    expect(item.kind).toBe("QUIZ")
    expect(item.dueDate).toBe("2026-09-28T08:00:00.000Z")
    expect(item.maxMarks).toBe(20)
    expect(item.courseCode).toBe("DEMO-MATH-101")
  })

  it("derives released from releasedAt rather than a separate flag", () => {
    // One source of truth, so the boolean and the timestamp cannot disagree.
    expect(toTeacherDeadlineItem(deadlineRow()).released).toBe(true)
    expect(toTeacherDeadlineItem(deadlineRow({ releasedAt: null })).released).toBe(false)
  })

  it("keeps a null releasedAt null rather than inventing an instant", () => {
    const item = toTeacherDeadlineItem(deadlineRow({ releasedAt: null }))
    expect(item.releasedAt).toBeNull()
    expect(item.releasedAt).not.toBe("")
  })

  it("emits releasedAt as an ISO string when present", () => {
    expect(toTeacherDeadlineItem(deadlineRow()).releasedAt).toBe("2026-09-14T08:00:00.000Z")
  })

  it("reads the real counts from the relations", () => {
    const item = toTeacherDeadlineItem(deadlineRow())
    expect(item.submitted).toBe(3)
    expect(item.graded).toBe(1)
  })

  it("keeps zero counts as zero rather than turning them into nulls", () => {
    // Zero submissions is a knowable fact, so it must not become an em dash.
    const item = toTeacherDeadlineItem(deadlineRow({ _count: { submissions: 0, finalGrades: 0 } }))
    expect(item.submitted).toBe(0)
    expect(item.graded).toBe(0)
  })

  it("does not mutate the row it is given", () => {
    const input = deadlineRow()
    toTeacherDeadlineItem(input)
    expect(input.dueDate.toISOString()).toBe("2026-09-28T08:00:00.000Z")
  })
})

describe("eventsExcludingAssessments", () => {
  const events = [
    event({ id: "a", kind: "CLASS" }),
    event({ id: "b", kind: "ASSESSMENT", title: "Due: Linear Equations Check-in" }),
    event({ id: "c", kind: "HOLIDAY", location: null, courseCode: null }),
    event({ id: "d", kind: "REMINDER" }),
  ]

  it("removes assessment events, which the deadlines table owns (E3)", () => {
    expect(eventsExcludingAssessments(events).map((e) => e.id)).toEqual(["a", "c", "d"])
  })

  it("keeps every other kind", () => {
    const kinds = eventsExcludingAssessments(events).map((e) => e.kind)
    expect(kinds).toEqual(["CLASS", "HOLIDAY", "REMINDER"])
  })

  it("returns an empty list when every event is an assessment", () => {
    expect(eventsExcludingAssessments([event({ kind: "ASSESSMENT" })])).toEqual([])
  })

  it("does not mutate the list it is given", () => {
    const input = [...events]
    eventsExcludingAssessments(input)
    expect(input).toHaveLength(4)
  })
})

describe("filterDeadlines", () => {
  const none = { search: "", release: "all" as const }
  const fixtures = [
    deadline({ id: "a", title: "Linear Equations Check-in", released: true }),
    deadline({ id: "b", title: "Group project", released: false }),
    deadline({ id: "c", title: "Fix the slope calculator", released: true }),
  ]

  it("returns everything when nothing is filtered", () => {
    expect(filterDeadlines(fixtures, none)).toHaveLength(3)
  })

  it("filters to released assessments", () => {
    expect(filterDeadlines(fixtures, { ...none, release: "released" }).map((d) => d.id)).toEqual([
      "a",
      "c",
    ])
  })

  it("filters to unreleased assessments", () => {
    // The filter that matters most: this is how a teacher finds what students
    // cannot see yet.
    expect(filterDeadlines(fixtures, { ...none, release: "unreleased" }).map((d) => d.id)).toEqual([
      "b",
    ])
  })

  it("matches the title case-insensitively", () => {
    expect(filterDeadlines(fixtures, { ...none, search: "GROUP" }).map((d) => d.id)).toEqual(["b"])
  })

  it("matches the course code", () => {
    expect(filterDeadlines(fixtures, { ...none, search: "math-101" })).toHaveLength(3)
  })

  it("applies the search and the release filter together", () => {
    expect(filterDeadlines(fixtures, { search: "slope", release: "unreleased" })).toEqual([])
  })

  it("returns an empty list, not everything, when nothing matches", () => {
    expect(filterDeadlines(fixtures, { ...none, search: "zzz" })).toEqual([])
  })

  it("ignores surrounding whitespace", () => {
    expect(filterDeadlines(fixtures, { ...none, search: "  group  " })).toHaveLength(1)
  })
})

describe("isDeadlineFiltered", () => {
  it("is false only at the defaults", () => {
    expect(isDeadlineFiltered({ search: "", release: "all" })).toBe(false)
    expect(isDeadlineFiltered({ search: "  ", release: "all" })).toBe(false)
  })

  it("is true when either control is set", () => {
    expect(isDeadlineFiltered({ search: "x", release: "all" })).toBe(true)
    expect(isDeadlineFiltered({ search: "", release: "unreleased" })).toBe(true)
  })
})

describe("releaseOptions", () => {
  it("offers all three states, because all three are meaningful", () => {
    // Unlike kinds, none of these can only ever produce an empty table.
    expect(releaseOptions().map((o) => o.value)).toEqual(["all", "released", "unreleased"])
  })
})

describe("deadlineProgress", () => {
  it("reports submitted and graded separately", () => {
    // Both are real, and reporting only one would mislead: "3 submitted" alone
    // implies marking has happened, "1 graded" alone hides unmarked work.
    expect(deadlineProgress(deadline({ submitted: 3, graded: 1 }))).toBe("3 submitted · 1 graded")
  })

  it("shows zeroes as zeroes rather than dashes", () => {
    expect(deadlineProgress(deadline({ submitted: 0, graded: 0 }))).toBe("0 submitted · 0 graded")
  })
})
