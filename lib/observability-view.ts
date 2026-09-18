import type { GradeActivityItem } from "@/lib/observability/audit-view"
import type { GradingDecisionItem } from "@/lib/observability/grading-decisions"

/**
 * Pure view logic for the teacher activity log.
 *
 * Here rather than inside a `useMemo` for the reason this repo keeps relearning:
 * no jsdom, no component-testing stack, so logic left in a component has no test —
 * and the action/actor selects render in a portal that snapshot tooling cannot
 * drive. The activity and override types come in as `import type` only, which is
 * erased, so this module stays safe to load in the browser.
 */

export type ActorKindFilter = "all" | "staff" | "automated"

export type ActivityFilters = {
  search: string
  action: string
  actorKind: ActorKindFilter
}

/**
 * An audit row is "automated" when it has no actor id.
 *
 * The graders write system rows with `actorId: null, actorRole: "system"` (the
 * retention purge is the canonical example), and a row with no actor cannot be a
 * staff decision. The **id** is the signal rather than the role string, because the
 * role is free-form text a caller chooses while the id is structurally absent — a
 * row with a role of "system" but a real actor id is a staff action that happened to
 * be labelled oddly, and this classifies it as staff.
 */
export function isAutomated(item: GradeActivityItem): boolean {
  return item.actorId === null
}

/**
 * Search matches the action string, the entity label, and the rendered summary.
 *
 * The summary is included as flat text because "find the override that mentioned
 * 8.5" is a real thing to want, and it is the only place a teacher's own note
 * appears in the activity list. It contributes nothing structured — the value is
 * stringified the same way the row renders it.
 */
export function filterActivity(
  items: readonly GradeActivityItem[],
  filters: ActivityFilters,
): GradeActivityItem[] {
  const needle = filters.search.trim().toLowerCase()

  return items.filter((item) => {
    if (filters.action !== "all" && item.action !== filters.action) return false

    if (filters.actorKind === "staff" && isAutomated(item)) return false
    if (filters.actorKind === "automated" && !isAutomated(item)) return false

    if (needle === "") return true
    return (
      item.action.toLowerCase().includes(needle) ||
      item.entityLabel.toLowerCase().includes(needle) ||
      searchableText(item).includes(needle)
    )
  })
}

/** The summary flattened to lowercase text, or `""` when there is nothing scalar. */
export function searchableText(item: GradeActivityItem): string {
  const summary = item.summary
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return ""

  return Object.entries(summary as Record<string, unknown>)
    .filter(([, value]) => value === null || typeof value !== "object")
    .map(([key, value]) => `${key} ${String(value)}`)
    .join(" ")
    .toLowerCase()
}

/** Whether the user has narrowed the log, so the empty state can differ. */
export function isActivityFiltered(filters: ActivityFilters): boolean {
  return filters.search.trim() !== "" || filters.action !== "all" || filters.actorKind !== "all"
}

export type ActivityOption = { value: string; label: string }

/**
 * Only the actions actually present, so the menu cannot offer an entry that empties
 * the table. Labels come from the page's `ACTION_LABELS` map, passed in rather than
 * duplicated here.
 */
export function activityActionOptions(
  items: readonly GradeActivityItem[],
  labelFor: (action: string) => string,
): ActivityOption[] {
  const present = [...new Set(items.map((item) => item.action))].sort()
  return [
    { value: "all", label: "All actions" },
    ...present.map((value) => ({ value, label: labelFor(value) })),
  ]
}

export function actorKindOptions(items: readonly GradeActivityItem[]): ActivityOption[] {
  const options: ActivityOption[] = [{ value: "all", label: "Staff and automated workers" }]
  const hasStaff = items.some((item) => !isAutomated(item))
  const hasAutomated = items.some(isAutomated)

  // Only offer a filter that can match something. A menu entry that guarantees an
  // empty table is worse than a shorter menu.
  if (hasStaff) options.push({ value: "staff", label: "Staff only" })
  if (hasAutomated) options.push({ value: "automated", label: "Automated workers only" })

  return options
}

/** Whether any override in the list is still withheld from students. */
export function withheldDecisionCount(items: readonly GradingDecisionItem[]): number {
  return items.filter((item) => item.publishedAt === null).length
}

/**
 * The id-valued keys an audit summary can carry, and how to label and look up
 * each. `studentId`/`assessmentId` are the only two the graders write.
 */
const SUMMARY_ID_KEYS: Record<string, { label: string; lookup: keyof SummaryNameLookup }> = {
  studentId: { label: "student", lookup: "student" },
  assessmentId: { label: "assessment", lookup: "assessment" },
}

export type SummaryNameLookup = {
  student?: ReadonlyMap<string, string>
  assessment?: ReadonlyMap<string, string>
}

/**
 * Replace raw ids in an audit summary with the names used everywhere else in
 * the product (TN-29).
 *
 * The audit log deliberately stores ids so it survives a user deletion, which
 * means the display name is a lookup, not a stored fact — an id that no longer
 * resolves stays visible rather than being invented away. The key is relabelled
 * at the same time (`studentId: demo-student-4` becomes `student: Aarav Mehta`),
 * because a raw id rendered under a column name is the defect, not just the
 * value.
 */
export function humanizeSummary(summary: unknown, names: SummaryNameLookup): unknown {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return summary

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(summary as Record<string, unknown>)) {
    const relabel = SUMMARY_ID_KEYS[key]
    if (relabel && typeof value === "string") {
      out[relabel.label] = names[relabel.lookup]?.get(value) ?? value
    } else {
      out[key] = value
    }
  }
  return out
}

/** The student and assessment ids a summary references, for a batched lookup. */
export function summaryReferenceIds(summary: unknown): {
  studentIds: string[]
  assessmentIds: string[]
} {
  const studentIds: string[] = []
  const assessmentIds: string[] = []
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    return { studentIds, assessmentIds }
  }
  const record = summary as Record<string, unknown>
  if (typeof record.studentId === "string") studentIds.push(record.studentId)
  if (typeof record.assessmentId === "string") assessmentIds.push(record.assessmentId)
  return { studentIds, assessmentIds }
}
