import { describe, expect, it } from "vitest"

import type { StudentMaterialView } from "@/lib/materials"
import {
  deriveMaterialKpis,
  filterMaterials,
  isFiltered,
  materialKindOptions,
} from "@/lib/materials-view"

/**
 * Resources-list view logic.
 *
 * These are pure functions rather than `useMemo` bodies for one reason: this repo
 * runs in a node environment with no jsdom and no component-testing stack, so
 * anything left inside a component has no test at all. The kind filter is the
 * concrete case — the app's `Select` renders its popup in a portal that snapshot
 * tooling cannot drive, so if the filtering lived in the component, "does the kind
 * filter work" would be unanswerable by machine.
 */

function material(overrides: Partial<StudentMaterialView> = {}): StudentMaterialView {
  return {
    id: "mat_1",
    title: "Linear equations — lecture notes",
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

const fixtures: StudentMaterialView[] = [
  material({ id: "a", title: "Linear equations", kind: "DOCUMENT", indexed: true, chunks: 5 }),
  material({ id: "b", title: "Graphing lines", kind: "SLIDE_DECK", indexed: true, chunks: 4 }),
  material({
    id: "c",
    title: "Solving systems by substitution",
    kind: "VIDEO",
    indexed: true,
    chunks: 4,
  }),
  material({ id: "d", title: "Khan Academy", kind: "LINK", indexed: false, chunks: 0 }),
  material({ id: "e", title: "Course syllabus", kind: "DOCUMENT", indexed: false, chunks: 0 }),
]

describe("filterMaterials", () => {
  it("returns everything when nothing is filtered", () => {
    expect(filterMaterials(fixtures, { search: "", kind: "all" })).toHaveLength(5)
  })

  it("matches on title, case-insensitively", () => {
    const hits = filterMaterials(fixtures, { search: "KHAN", kind: "all" })
    expect(hits.map((row) => row.id)).toEqual(["d"])
  })

  it("ignores surrounding whitespace in the search term", () => {
    // A trailing space after a paste should not silently return nothing.
    expect(filterMaterials(fixtures, { search: "  khan  ", kind: "all" })).toHaveLength(1)
  })

  it("matches on course code as well as title", () => {
    const hits = filterMaterials(fixtures, { search: "math-101", kind: "all" })
    expect(hits).toHaveLength(5)
  })

  it("narrows by kind", () => {
    const hits = filterMaterials(fixtures, { search: "", kind: "DOCUMENT" })
    expect(hits.map((row) => row.id).sort()).toEqual(["a", "e"])
  })

  it("applies the kind and the search together, not either-or", () => {
    const hits = filterMaterials(fixtures, { search: "syllabus", kind: "DOCUMENT" })
    expect(hits.map((row) => row.id)).toEqual(["e"])
    // The same search with a kind that cannot match must return nothing.
    expect(filterMaterials(fixtures, { search: "syllabus", kind: "VIDEO" })).toEqual([])
  })

  it("returns an empty list, not everything, when nothing matches", () => {
    // The failure that matters: a filter that falls back to the full list when it
    // finds nothing looks like it worked.
    expect(filterMaterials(fixtures, { search: "zzz", kind: "all" })).toEqual([])
  })

  it("does not mutate the list it is given", () => {
    const input = [...fixtures]
    filterMaterials(input, { search: "khan", kind: "all" })
    expect(input).toHaveLength(5)
  })

  it("treats a whitespace-only search as no search", () => {
    expect(filterMaterials(fixtures, { search: "   ", kind: "all" })).toHaveLength(5)
  })
})

describe("isFiltered", () => {
  it("is false only when neither control is set", () => {
    expect(isFiltered({ search: "", kind: "all" })).toBe(false)
    // Whitespace is not a filter, so the empty state must not claim it is.
    expect(isFiltered({ search: "  ", kind: "all" })).toBe(false)
  })

  it("is true when either control is set", () => {
    expect(isFiltered({ search: "khan", kind: "all" })).toBe(true)
    expect(isFiltered({ search: "", kind: "VIDEO" })).toBe(true)
  })
})

describe("materialKindOptions", () => {
  it("offers only the kinds present, plus All", () => {
    // A menu entry that can only ever produce an empty table is worse than a
    // shorter menu.
    const options = materialKindOptions(fixtures)
    expect(options.map((option) => option.value)).toEqual([
      "all",
      "DOCUMENT",
      "LINK",
      "SLIDE_DECK",
      "VIDEO",
    ])
  })

  it("labels its options from the shared label map", () => {
    const options = materialKindOptions(fixtures)
    expect(options.find((option) => option.value === "SLIDE_DECK")?.label).toBe("Slide deck")
    expect(options[0]).toEqual({ value: "all", label: "All kinds" })
  })

  it("does not offer OTHER when no material has that kind", () => {
    expect(materialKindOptions(fixtures).map((option) => option.value)).not.toContain("OTHER")
  })

  it("offers only All when there are no materials", () => {
    expect(materialKindOptions([])).toEqual([{ value: "all", label: "All kinds" }])
  })
})

describe("deriveMaterialKpis", () => {
  it("counts totals, indexed and chunks", () => {
    expect(deriveMaterialKpis(fixtures)).toEqual({
      total: 5,
      indexed: 3,
      pending: 2,
      chunks: 13,
    })
  })

  it("derives pending as total minus indexed, so the two cannot disagree", () => {
    const kpis = deriveMaterialKpis(fixtures)
    expect(kpis.pending + kpis.indexed).toBe(kpis.total)
  })

  it("counts zero chunks as a real zero rather than treating it as missing", () => {
    const unindexed = fixtures.filter((row) => !row.indexed)
    expect(unindexed.map((row) => row.chunks)).toEqual([0, 0])
    // The rule for the page: `chunks: 0` is knowable, so it is prose
    // ("Not searchable yet"), never a dash.
    expect(deriveMaterialKpis(unindexed).chunks).toBe(0)
  })

  it("handles an empty list without producing NaN", () => {
    expect(deriveMaterialKpis([])).toEqual({ total: 0, indexed: 0, pending: 0, chunks: 0 })
  })
})
