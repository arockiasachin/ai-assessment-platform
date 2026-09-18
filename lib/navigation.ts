/**
 * Declarative parent map for back navigation.
 *
 * URLs carry selection state but no provenance: a student's quiz attempt URL
 * says *which* attempt, not where they came from. So history-based back
 * (`router.back()`) is unpredictable — it can leave the app, or land on a page
 * the user never saw — and an explicit href is both deterministic and
 * shareable. This module is that href, declared once.
 *
 * It is **pure and dependency-free** (the repo convention: testable display
 * logic lives in `lib/`), so `tests/navigation.test.ts` can pin every edge
 * without a DOM, and both `components/back-link.tsx` and the `PageHeader`
 * breadcrumb trail read the same map rather than each inventing their own.
 *
 * ## Why a map of exact paths, plus a few patterns
 *
 * Most drilldowns are static routes, so exact keys are the honest shape. The
 * one genuinely dynamic route (a quiz attempt, `/student/quizzes/<id>`) is
 * matched by pattern and mapped to its list. A parent that is not declared here
 * yields `null`, which callers render as *no* back affordance — a link to a
 * guessed parent would be worse than none.
 */

export type NavParent = {
  /** Visible crumb/link label, e.g. "Assessments". */
  label: string
  /** The parent's route. */
  href: string
}

/** A breadcrumb as `PageHeader` consumes it: `href` is omitted for the current page. */
export type NavCrumb = {
  label: string
  href?: string
}

/**
 * Exact parent for a route.
 *
 * Deliberately covers **drilldowns only**. A top-level nav destination needs no
 * back link: the rail already shows where it sits, and a "Back to Dashboard"
 * on every page is chrome, not navigation.
 */
const EXACT_PARENTS: Record<string, NavParent> = {
  // Quizzes are reachable through the Assessments menu, so the list's own
  // parent is the hub rather than the removed standalone nav entry.
  "/student/quizzes": { label: "Assessments", href: "/student/assessments" },
  // Per-assessment workspaces: each drills into one assessment from the hub.
  "/student/code-submissions": { label: "Assessments", href: "/student/assessments" },
  "/student/write": { label: "Assessments", href: "/student/assessments" },
  // Retake is a planning tool, not an assessment, so its parent is the dashboard.
  "/student/retake": { label: "Dashboard", href: "/student" },
  // Teacher drilldowns hang off the teacher dashboard.
  "/teacher/analytics": { label: "Dashboard", href: "/teacher" },
  "/teacher/reviews": { label: "Dashboard", href: "/teacher" },
  "/teacher/observability": { label: "Dashboard", href: "/teacher" },
  "/teacher/groups": { label: "Dashboard", href: "/teacher" },
}

/** Route patterns whose parent is one step up (a dynamic segment). */
const PATTERN_PARENTS: Array<{ pattern: RegExp; parent: NavParent }> = [
  {
    // `/student/quizzes/<attemptId>` — the attempt is reached from the list.
    pattern: /^\/student\/quizzes\/[^/]+$/,
    parent: { label: "Quizzes", href: "/student/quizzes" },
  },
]

/** Strip a trailing slash (except for `/`) and any query/hash, so keys are canonical. */
function normalizePath(pathname: string): string {
  const withoutQuery = pathname.split("?")[0]?.split("#")[0] ?? ""
  if (withoutQuery.length > 1 && withoutQuery.endsWith("/")) {
    return withoutQuery.slice(0, -1)
  }
  return withoutQuery
}

/** The declared parent of `pathname`, or `null` when it has none. */
export function parentFor(pathname: string): NavParent | null {
  const path = normalizePath(pathname)
  const exact = EXACT_PARENTS[path]
  if (exact) return exact
  return PATTERN_PARENTS.find((entry) => entry.pattern.test(path))?.parent ?? null
}

/**
 * The full ancestor trail for `pathname`, oldest first, without the current page.
 *
 * Walks `parentFor` upward, guarding against a cycle (which would be a bug in
 * the map rather than in a caller) so this can never loop forever.
 */
export function ancestorsFor(pathname: string): NavParent[] {
  const trail: NavParent[] = []
  const seen = new Set<string>()
  let current = normalizePath(pathname)
  while (true) {
    const parent = parentFor(current)
    if (!parent) break
    if (seen.has(parent.href)) break
    seen.add(parent.href)
    trail.push(parent)
    current = parent.href
  }
  return trail.reverse()
}

/**
 * A `PageHeader` breadcrumb trail ending in the current page.
 *
 * The final crumb carries no `href`: `Breadcrumbs` renders it as the current
 * page, and a link to where you already are is noise.
 */
export function breadcrumbTrail(pathname: string, currentLabel: string): NavCrumb[] {
  return [...ancestorsFor(pathname), { label: currentLabel }]
}
