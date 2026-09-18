import { describe, expect, it } from "vitest"

import {
  isSearchableQuery,
  normalizeSearchQuery,
  SEARCH_LIMIT_PER_GROUP,
  SEARCH_MAX_QUERY_LENGTH,
  SEARCH_MIN_QUERY_LENGTH,
  shapeSearchGroups,
  type SearchHit,
} from "@/lib/search"

/** A hit factory, so a test only names what it is about. */
function hit(id: string): SearchHit {
  return { id, label: id, description: null, href: `/x/${id}` }
}

/**
 * Quick-search shaping.
 *
 * These pin the three properties the route relies on to stay a convenience
 * rather than an enumeration oracle: a length floor, a per-group cap with no
 * totals, and a role-scoped group list enforced at shaping time.
 */

describe("normalizeSearchQuery", () => {
  it("trims and collapses internal whitespace", () => {
    expect(normalizeSearchQuery("  graph   traversal \n")).toBe("graph traversal")
  })

  it("caps the length so a huge query never reaches the database", () => {
    const normalized = normalizeSearchQuery("x".repeat(SEARCH_MAX_QUERY_LENGTH + 50))
    expect(normalized).toHaveLength(SEARCH_MAX_QUERY_LENGTH)
  })

  it("treats null/undefined/empty as empty string", () => {
    expect(normalizeSearchQuery(null)).toBe("")
    expect(normalizeSearchQuery(undefined)).toBe("")
    expect(normalizeSearchQuery("   ")).toBe("")
  })
})

describe("isSearchableQuery", () => {
  it("refuses a query below the floor", () => {
    expect(isSearchableQuery("")).toBe(false)
    expect(isSearchableQuery("a")).toBe(false)
    expect(SEARCH_MIN_QUERY_LENGTH).toBe(2)
  })

  it("accepts a query at the floor", () => {
    expect(isSearchableQuery("ab")).toBe(true)
  })
})

describe("shapeSearchGroups", () => {
  it("drops empty groups rather than rendering a heading with nothing under it", () => {
    const response = shapeSearchGroups("student", "math", {
      assessments: [hit("a1")],
      courses: [],
      resources: [],
    })
    expect(response.groups.map((group) => group.key)).toEqual(["assessments"])
  })

  it("caps each group and returns no total", () => {
    const response = shapeSearchGroups("student", "math", {
      assessments: Array.from({ length: SEARCH_LIMIT_PER_GROUP + 7 }, (_, index) =>
        hit(`a${index}`),
      ),
    })
    const group = response.groups[0]
    expect(group.items).toHaveLength(SEARCH_LIMIT_PER_GROUP)
    // Nothing on the response reports how many matched.
    expect(JSON.stringify(response)).not.toContain("total")
    expect(JSON.stringify(response)).not.toContain("count")
  })

  it("keeps the student and teacher group lists separate", () => {
    const student = shapeSearchGroups("student", "math", {
      assessments: [hit("a1")],
      courses: [hit("c1")],
      resources: [hit("r1")],
      // A query-layer bug handing a student teacher groups must not leak them.
      offerings: [hit("o1")],
      students: [hit("s1")],
    })
    expect(student.groups.map((group) => group.key)).toEqual([
      "assessments",
      "courses",
      "resources",
    ])
  })

  it("drops a stray group from a teacher response too", () => {
    const teacher = shapeSearchGroups("teacher", "math", {
      assessments: [hit("a1")],
      offerings: [hit("o1")],
      students: [hit("s1")],
      resources: [hit("r1")],
    })
    expect(teacher.groups.map((group) => group.key)).toEqual([
      "assessments",
      "offerings",
      "students",
    ])
  })

  it("returns nothing at all for a role with no search scope", () => {
    // `admin` has no designed search surface yet; an empty result is honest,
    // whereas falling back to any scope would be a new authorization surface.
    const admin = shapeSearchGroups("admin", "math", { assessments: [hit("a1")] })
    expect(admin.groups).toEqual([])
  })
})
