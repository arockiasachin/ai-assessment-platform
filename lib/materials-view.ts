import type { StudentMaterialView } from "@/lib/materials"
import { MATERIAL_KIND_LABEL } from "@/lib/labels"

/**
 * Pure view logic for the resources list.
 *
 * Kept out of the component so it can be tested in this repo's node environment.
 * There is no jsdom and no component-testing stack here by design
 * (`vitest.config.ts`), so any interaction that cannot be expressed as a pure
 * function is an interaction with no test. Filtering and the KPI arithmetic are
 * exactly that kind of logic, so they live here rather than inside a `useMemo`.
 *
 * The browser is not a substitute: the app's `Select` renders its popup in a
 * portal, which the snapshot tooling cannot drive, so "it works because I clicked
 * it" was never going to be available for the kind filter.
 */

export type MaterialKindFilter = "all" | StudentMaterialView["kind"]

export type MaterialFilters = {
  search: string
  kind: MaterialKindFilter
  /**
   * A course code, or `"all"`.
   *
   * Optional so the existing callers and their tests keep the meaning they had:
   * no `course` key is the same as `"all"`. A material always has a course
   * (`courseId` is non-nullable), so unlike the calendar there is no null case —
   * every row is reachable under both All and its own course.
   */
  course?: string
}

/**
 * Search matches title and course code. It deliberately does **not** match the
 * material's `mimeType` or `kind`: those have their own control, and folding them
 * into the free-text box makes a search for "pdf" silently mean something the
 * user did not ask for.
 */
export function filterMaterials(
  materials: readonly StudentMaterialView[],
  filters: MaterialFilters,
): StudentMaterialView[] {
  const needle = filters.search.trim().toLowerCase()

  return materials.filter((material) => {
    if (filters.kind !== "all" && material.kind !== filters.kind) return false
    if (filters.course && filters.course !== "all" && material.courseCode !== filters.course) {
      return false
    }
    if (needle === "") return true
    return (
      material.title.toLowerCase().includes(needle) ||
      material.courseCode.toLowerCase().includes(needle)
    )
  })
}

/** Whether the user has narrowed the list at all, so the empty state can differ. */
export function isFiltered(filters: MaterialFilters): boolean {
  return (
    filters.search.trim() !== "" ||
    filters.kind !== "all" ||
    (filters.course !== undefined && filters.course !== "all")
  )
}

export type MaterialKindOption = { value: string; label: string }

/**
 * Only offers kinds that are actually present. A menu entry that can only ever
 * produce an empty table is worse than a shorter menu.
 */
export function materialKindOptions(
  materials: readonly StudentMaterialView[],
): MaterialKindOption[] {
  const present = [...new Set(materials.map((material) => material.kind))].sort()
  return [
    { value: "all", label: "All kinds" },
    ...present.map((value) => ({ value, label: MATERIAL_KIND_LABEL[value] })),
  ]
}

/**
 * Only the courses actually represented, plus All.
 *
 * Label and value are both the course code: the page has the code, not the name,
 * and inventing a name here would be a second vocabulary for one fact.
 */
export function materialCourseOptions(
  materials: readonly StudentMaterialView[],
): MaterialKindOption[] {
  const present = [...new Set(materials.map((material) => material.courseCode))].sort()
  return [
    { value: "all", label: "All courses" },
    ...present.map((code) => ({ value: code, label: code })),
  ]
}

export type MaterialKpis = {
  total: number
  indexed: number
  pending: number
  chunks: number
}

/**
 * The retrieval-chunk count, pluralized.
 *
 * The row printed `${row.chunks} chunks` unconditionally, so `chunks: 1` read
 * "1 chunks" on every single-chunk material (SN-21). A count of one has its own
 * word; that is the whole rule.
 */
export function chunkCountLabel(chunks: number): string {
  return `${chunks} chunk${chunks === 1 ? "" : "s"}`
}

/**
 * Derived from the **whole** list, never the filtered slice: the cards are a
 * summary of what the student has, and having them drop to 1 whenever a search is
 * typed would read as data loss.
 *
 * `pending` is `total - indexed` rather than a second count of empty-chunk rows,
 * so the two cards cannot disagree if a material somehow had neither state.
 */
export function deriveMaterialKpis(materials: readonly StudentMaterialView[]): MaterialKpis {
  const total = materials.length
  const indexed = materials.filter((material) => material.indexed).length
  return {
    total,
    indexed,
    pending: total - indexed,
    chunks: materials.reduce((sum, material) => sum + material.chunks, 0),
  }
}
