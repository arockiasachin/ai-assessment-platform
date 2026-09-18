/**
 * Pure shape of the quick-search response.
 *
 * The query layer (`lib/search-query.ts`) decides **what** the caller may see;
 * this module decides how many of those rows become results, in what order, and
 * which groups survive — so the capping rule is unit-testable without a
 * database (the repo convention: testable display logic lives in `lib/`).
 *
 * ## The scope boundary, stated once
 *
 * Search only ever surfaces entities the caller can already list on one of
 * their own pages: a student's released assessments, enrolled courses and
 * course resources; a teacher's own offerings, their assessments and the
 * students enrolled in them. There is no global index and no cross-role search,
 * and `shapeSearchGroups` enforces the role's group list a second time so a
 * query-layer bug cannot leak a group into a role that has no page for it.
 *
 * ## Why it cannot become an enumeration oracle
 *
 * A search box over scoped data is a convenience, not a directory, and three
 * properties keep it that way:
 *
 * 1. **Nothing new is disclosed.** Every hit resolves to an entity the caller
 *    could open from the nav. A two-character query can therefore only find
 *    things already theirs — there is nothing to enumerate that they could not
 *    already enumerate by browsing.
 * 2. **No totals.** The response carries at most `SEARCH_LIMIT_PER_GROUP` items
 *    per group and no match count, so it cannot be used to ask "how many?" and
 *    binary-search a hidden set.
 * 3. **A length floor.** Queries shorter than `SEARCH_MIN_QUERY_LENGTH` are
 *    refused before any database read, so an empty or one-character probe
 *    returns nothing rather than a page of rows.
 *
 * `SEARCH_MAX_QUERY_LENGTH` bounds the input handed to Postgres; the client
 * normalises through `normalizeSearchQuery` too, but the route re-normalises so
 * a hand-crafted request cannot bypass it.
 */

/** Below this, a query is refused rather than answered. */
export const SEARCH_MIN_QUERY_LENGTH = 2

/** Above this, the query is truncated before it reaches the database. */
export const SEARCH_MAX_QUERY_LENGTH = 80

/** At most this many hits per group; the response carries no count of the rest. */
export const SEARCH_LIMIT_PER_GROUP = 5

/** Roles the shell renders search for. `admin` deliberately has no search scope yet. */
export type SearchRole = "student" | "teacher" | "admin"

export type SearchGroupKey = "assessments" | "courses" | "resources" | "offerings" | "students"

export const SEARCH_GROUP_LABEL: Record<SearchGroupKey, string> = {
  assessments: "Assessments",
  courses: "Courses",
  resources: "Resources",
  offerings: "Offerings",
  students: "Students",
}

/**
 * The groups each role searches, in display order.
 *
 * An empty list is a real answer: the admin workspace has no per-role search
 * surface yet, so `admin` searches nothing rather than falling back to a scope
 * nobody designed.
 */
export const SEARCH_GROUPS_BY_ROLE: Record<SearchRole, readonly SearchGroupKey[]> = {
  student: ["assessments", "courses", "resources"],
  teacher: ["assessments", "offerings", "students"],
  admin: [],
}

/** One result row. `href` is always an in-app route the caller can open. */
export type SearchHit = {
  id: string
  label: string
  /** Secondary context (course code, type, register number), or `null`. */
  description: string | null
  href: string
}

export type SearchGroup = {
  key: SearchGroupKey
  label: string
  items: SearchHit[]
}

export type SearchResponse = {
  query: string
  groups: SearchGroup[]
}

/** Trim, collapse internal whitespace, and cap the length. */
export function normalizeSearchQuery(raw: string | null | undefined): string {
  if (typeof raw !== "string") return ""
  return raw.trim().replace(/\s+/g, " ").slice(0, SEARCH_MAX_QUERY_LENGTH)
}

/** Whether a normalised query is long enough to answer. */
export function isSearchableQuery(query: string): boolean {
  return query.length >= SEARCH_MIN_QUERY_LENGTH
}

/**
 * Shape the query layer's raw hits into the response.
 *
 * Caps each group, drops empty groups, and orders/limits groups by the role's
 * declared list — so the role boundary is asserted at the shaping step, not
 * only where the queries were written.
 */
export function shapeSearchGroups(
  role: SearchRole,
  query: string,
  raw: Partial<Record<SearchGroupKey, SearchHit[]>>,
): SearchResponse {
  const groups = SEARCH_GROUPS_BY_ROLE[role]
    .map((key) => ({
      key,
      label: SEARCH_GROUP_LABEL[key],
      items: (raw[key] ?? []).slice(0, SEARCH_LIMIT_PER_GROUP),
    }))
    .filter((group) => group.items.length > 0)

  return { query, groups }
}
