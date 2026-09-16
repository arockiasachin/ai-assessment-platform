import type { MaterialView } from "@/lib/materials"
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

export type MaterialKindFilter = "all" | MaterialView["kind"]

export type MaterialFilters = {
  search: string
  kind: MaterialKindFilter
}

/**
 * Search matches title and course code. It deliberately does **not** match the
 * material's `mimeType` or `kind`: those have their own control, and folding them
 * into the free-text box makes a search for "pdf" silently mean something the
 * user did not ask for.
 */
export function filterMaterials(
  materials: readonly MaterialView[],
  filters: MaterialFilters,
): MaterialView[] {
  const needle = filters.search.trim().toLowerCase()

  return materials.filter((material) => {
    if (filters.kind !== "all" && material.kind !== filters.kind) return false
    if (needle === "") return true
    return (
      material.title.toLowerCase().includes(needle) ||
      material.courseCode.toLowerCase().includes(needle)
    )
  })
}

/** Whether the user has narrowed the list at all, so the empty state can differ. */
export function isFiltered(filters: MaterialFilters): boolean {
  return filters.search.trim() !== "" || filters.kind !== "all"
}

export type MaterialKindOption = { value: string; label: string }

/**
 * Only offers kinds that are actually present. A menu entry that can only ever
 * produce an empty table is worse than a shorter menu.
 */
export function materialKindOptions(materials: readonly MaterialView[]): MaterialKindOption[] {
  const present = [...new Set(materials.map((material) => material.kind))].sort()
  return [
    { value: "all", label: "All kinds" },
    ...present.map((value) => ({ value, label: MATERIAL_KIND_LABEL[value] })),
  ]
}

export type MaterialKpis = {
  total: number
  indexed: number
  pending: number
  chunks: number
}

/**
 * Derived from the **whole** list, never the filtered slice: the cards are a
 * summary of what the student has, and having them drop to 1 whenever a search is
 * typed would read as data loss.
 *
 * `pending` is `total - indexed` rather than a second count of empty-chunk rows,
 * so the two cards cannot disagree if a material somehow had neither state.
 */
export function deriveMaterialKpis(materials: readonly MaterialView[]): MaterialKpis {
  const total = materials.length
  const indexed = materials.filter((material) => material.indexed).length
  return {
    total,
    indexed,
    pending: total - indexed,
    chunks: materials.reduce((sum, material) => sum + material.chunks, 0),
  }
}
