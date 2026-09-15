import {
  Activity,
  BarChart3,
  BookOpen,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  Database,
  FilePlus2,
  FileText,
  GraduationCap,
  Home,
  Layers,
  Library,
  ListChecks,
  RefreshCw,
  Settings2,
  Share2,
  Sparkles,
  Terminal,
  UserRound,
  Users,
  UsersRound,
  Wrench,
  type LucideIcon,
} from "lucide-react"

import type { MockupRole } from "@/lib/mock/types"

/**
 * Navigation model for the mockup shell.
 *
 * This file is the single source of truth for:
 *  - the left rail (`SideNav`) and the mobile drawer (`MobileNav`);
 *  - role detection from the URL (`roleFromPathname`);
 *  - the mockup index page, which lists every page by role and section.
 *
 * It is intentionally pure data + tiny helpers, so it can be imported from
 * Server Components (the mockup index) and Client Components (the shell)
 * without a `"use client"` boundary.
 */

export type { MockupRole }

export type NavItem = {
  /** Visible label. Also the tooltip text when the rail is collapsed. */
  label: string
  /**
   * Mockup route, e.g. `/mockup/teacher/reviews`. For an `appOnly` item this is
   * the **real** path instead (e.g. `/teacher/offerings`).
   */
  href: string
  icon: LucideIcon
  /** One line shown on the mockup index card and in the page header. */
  description: string
  /**
   * A page that exists only in the real app, with no mockup counterpart.
   *
   * The nav is one definition shared by both trees, so this flag is what keeps
   * the mockup side honest: such an item is filtered out of `mockup` scope and
   * out of `allNavItems`, so the mockup index can never link to a page that does
   * not exist there and `tests/nav-scope.test.ts`'s "every mockup nav href has a
   * mockup page" assertion stays true. `href` must be the real path; `navHref`
   * passes it through unchanged.
   */
  appOnly?: boolean
}

export type NavSection = {
  /** Stable id for React keys and `aria-labelledby`. */
  id: string
  /** Section heading rendered above the group (and used as `aria-labelledby`). */
  heading: string
  items: NavItem[]
}

/**
 * Proposed product brand. The mockups deliberately retire the old
 * "Gradebook / Assessment & marks tracker" copy: this is an AI assessment
 * platform, and the wordmark should say so. Change it here and the whole
 * shell follows.
 */
export const BRAND = {
  name: "Rubrix",
  tagline: "AI-assisted assessment & feedback",
  icon: GraduationCap,
  /** The mockup index, linked from the brand block. */
  indexHref: "/mockup",
} as const

export const ROLE_META: Record<MockupRole, { label: string; blurb: string; home: string }> = {
  teacher: {
    label: "Teacher",
    blurb: "Author, generate, grade with AI review, and monitor the cohort.",
    home: "/mockup/teacher",
  },
  student: {
    label: "Student",
    blurb: "Take quizzes, submit work, review feedback, and collaborate.",
    home: "/mockup/student",
  },
  admin: {
    label: "Admin",
    blurb: "Manage offerings, enrolments, datasets, and integrations.",
    home: "/mockup/admin",
  },
}

export const MOCKUP_ROLES: readonly MockupRole[] = ["teacher", "student", "admin"]

/**
 * Roles the shell **advertises** — the top bar's preview-role switcher and the
 * mockup index's role sections. `admin` is deliberately excluded.
 *
 * Administrators are provisioned by invitation: the register screen says so, and
 * the real app already behaves that way — `proxy.ts` redirects non-admins away
 * from `/admin`, and `navSectionsFor` returns only the signed-in role's
 * sections, so a teacher never sees an admin link. The design must not advertise
 * an entry point the product deliberately does not offer.
 *
 * The admin workspace stays **reachable** rather than removed: by URL, and from
 * a low-emphasis link in the mockup index footer. That is the "hidden link" —
 * discoverable by someone who knows it is there, invisible to a casual reader.
 *
 * `MOCKUP_ROLES` remains the complete set, because nav iteration and the
 * active-href home set must still know admin exists.
 */
export const PREVIEW_ROLES: readonly MockupRole[] = ["teacher", "student"]

export const NAV_SECTIONS: Record<MockupRole, NavSection[]> = {
  teacher: [
    {
      id: "teaching",
      heading: "Teaching",
      items: [
        {
          label: "Dashboard",
          href: "/mockup/teacher",
          icon: Home,
          description: "Cohort pulse, grading backlog, and what needs a decision today.",
        },
        {
          label: "Classes",
          href: "/mockup/teacher/classes",
          icon: Layers,
          description: "Offerings, sections, and enrolled rosters for the active term.",
        },
        {
          // No mockup counterpart: the design put this on the Classes page, but
          // the real Classes page administers offerings while the mockup shows a
          // roster. Split so each page names what it is (docs/plans/wave-1.md §D1).
          label: "Offerings",
          href: "/teacher/offerings",
          icon: Settings2,
          description: "Enrollment limits, registration windows, and results publication.",
          appOnly: true,
        },
        {
          label: "Assignments",
          href: "/mockup/teacher/assignments",
          icon: FilePlus2,
          description: "Author assessments across quiz, descriptive, code, and group types.",
        },
        {
          label: "Quiz AI",
          href: "/mockup/teacher/quiz-ai",
          icon: Sparkles,
          description: "Generate draft questions from course material and publish them.",
        },
        {
          label: "Rubrics",
          href: "/mockup/teacher/rubrics",
          icon: ListChecks,
          description: "Weighted criteria and point ceilings that bind every AI suggestion.",
        },
      ],
    },
    {
      id: "grading",
      heading: "Grading",
      items: [
        {
          label: "Reviews",
          href: "/mockup/teacher/reviews",
          icon: ClipboardCheck,
          description: "The AI suggestion review queue — accept, override, or reject.",
        },
        {
          label: "Submissions",
          href: "/mockup/teacher/submissions",
          icon: ClipboardList,
          description: "All student submissions with status, marks, and feedback.",
        },
        {
          label: "Code tasks",
          href: "/mockup/teacher/code-tasks",
          icon: Terminal,
          description: "Sandboxed runs, test cases, coverage, and similarity flags.",
        },
      ],
    },
    {
      id: "collaboration",
      heading: "Collaboration",
      items: [
        {
          label: "Groups",
          href: "/mockup/teacher/groups",
          icon: Users,
          description: "Teams, peer evaluation, contribution evidence, and milestones.",
        },
        {
          label: "Planner",
          href: "/mockup/teacher/planner",
          icon: CalendarDays,
          description: "Calendar of classes, due dates, and scheduled reminders.",
        },
      ],
    },
    {
      id: "insight",
      heading: "Insight",
      items: [
        {
          label: "Analytics",
          href: "/mockup/teacher/analytics",
          icon: BarChart3,
          description: "Grade distribution, question quality, trends, and at-risk students.",
        },
        {
          label: "Activity log",
          href: "/mockup/teacher/activity",
          icon: Activity,
          description: "Audit trail of grading decisions and other high-trust mutations.",
        },
        {
          label: "Export",
          href: "/mockup/teacher/export",
          icon: Share2,
          description: "OneRoster and LTI grade passback with mapping health.",
        },
        {
          label: "Reports",
          href: "/mockup/teacher/reports",
          icon: FileText,
          description: "Student and cohort reports, ratings, and printable summaries.",
        },
      ],
    },
    {
      id: "account",
      heading: "Account",
      items: [
        {
          label: "Settings",
          href: "/mockup/teacher/settings",
          icon: Settings2,
          description: "Grading defaults, thresholds, notifications, and retention.",
        },
        {
          label: "Profile",
          href: "/mockup/teacher/profile",
          icon: UserRound,
          description: "Your staff profile, contact details, and session information.",
        },
      ],
    },
  ],
  student: [
    {
      id: "learning",
      heading: "Learning",
      items: [
        {
          label: "Dashboard",
          href: "/mockup/student",
          icon: Home,
          description: "What is due, what is graded, and what needs your attention.",
        },
        {
          label: "Courses",
          href: "/mockup/student/courses",
          icon: BookOpen,
          description: "Enrolled courses, materials, and course ratings.",
        },
        {
          label: "Assessments",
          href: "/mockup/student/assessments",
          icon: ClipboardList,
          description: "Every assessment with due date, submission state, and marks.",
        },
        {
          label: "Quizzes",
          href: "/mockup/student/quizzes",
          icon: ClipboardCheck,
          description: "Attempts, per-question feedback, and explanations.",
        },
        {
          label: "Resources",
          href: "/mockup/student/resources",
          icon: Library,
          description: "Course material, transcripts, and revision collections.",
        },
      ],
    },
    {
      id: "collaboration",
      heading: "Collaboration",
      items: [
        {
          label: "Peer evaluation",
          href: "/mockup/student/peer-evaluation",
          icon: Users,
          description: "Rate teammates on the five CATME dimensions.",
        },
        {
          label: "Code submissions",
          href: "/mockup/student/code-submissions",
          icon: Terminal,
          description: "Submit code, see test results, and read the reviewer feedback.",
        },
      ],
    },
    {
      id: "planning",
      heading: "Planning",
      items: [
        {
          label: "Events",
          href: "/mockup/student/events",
          icon: CalendarDays,
          description: "Classes, deadlines, and reminders in one calendar.",
        },
        {
          label: "Retake",
          href: "/mockup/student/retake",
          icon: RefreshCw,
          description: "Adaptive retake practice built from your weakest subtopics.",
        },
      ],
    },
    {
      id: "account",
      heading: "Account",
      items: [
        {
          label: "Settings",
          href: "/mockup/student/settings",
          icon: Settings2,
          description: "Accessibility, notifications, and assessment preferences.",
        },
        {
          label: "Profile",
          href: "/mockup/student/profile",
          icon: UserRound,
          description: "Your student profile, register number, and enrolments.",
        },
      ],
    },
  ],
  admin: [
    {
      id: "operations",
      heading: "Operations",
      items: [
        {
          label: "Overview",
          href: "/mockup/admin",
          icon: Home,
          description: "Platform health, term activity, and integration status.",
        },
        {
          label: "Users",
          href: "/mockup/admin/users",
          icon: UsersRound,
          description: "Accounts, roles, and last sign-in across the institution.",
        },
        {
          label: "Course offerings",
          href: "/mockup/admin/offerings",
          icon: Layers,
          description: "Courses, sections, teachers, and enrolment capacity.",
        },
      ],
    },
    {
      id: "platform",
      heading: "Platform",
      items: [
        {
          label: "Data",
          href: "/mockup/admin/data",
          icon: Database,
          description: "Imported datasets, retention windows, and purge status.",
        },
        {
          label: "Tools",
          href: "/mockup/admin/tools",
          icon: Wrench,
          description: "Maintenance actions, feature flags, and diagnostics.",
        },
      ],
    },
    {
      id: "account",
      heading: "Account",
      items: [
        {
          label: "Settings",
          href: "/mockup/admin/settings",
          icon: Settings2,
          description: "Institution defaults, integrations, and access policy.",
        },
        {
          label: "Profile",
          href: "/mockup/admin/profile",
          icon: UserRound,
          description: "Your admin profile and session information.",
        },
      ],
    },
  ],
}

/**
 * Which tree a shell instance is rendering: the static `/mockup` tree, or the
 * real authenticated `app/(dashboard)` tree.
 */
export type NavScope = "mockup" | "app"

/**
 * Real route for a mockup nav href, where the two do not simply differ by the
 * `/mockup` prefix.
 *
 * - A string is an explicit override (the segment was renamed in the real tree).
 * - `null` means **there is no real page yet**. Those items are mockup-only: the
 *   mockups designed a destination the backend does not have. They are dropped
 *   from the app-scope nav rather than rendered as broken links, and
 *   `tests/nav-scope.test.ts` fails if an item is added here without a page.
 *
 * Everything not listed here is derived by stripping the `/mockup` prefix, and
 * the same test asserts that derivation resolves to a real page file.
 */
const APP_PATH_OVERRIDES: Record<string, string | null> = {
  // Renamed in the real tree. Both names are the *same* destination; the real
  // nav calls them "Quiz AI" and "Activity log" but links to these paths.
  "/mockup/teacher/quiz-ai": "/teacher/quiz-generation",
  "/mockup/teacher/activity": "/teacher/observability",
  // No real page exists yet for the settings/profile surface of any role.
  "/mockup/teacher/profile": null,
  "/mockup/teacher/settings": null,
  "/mockup/student/profile": null,
  "/mockup/student/settings": null,
  "/mockup/admin/profile": null,
  "/mockup/admin/settings": null,
}

/**
 * Resolve a nav item's href for a scope.
 *
 * Returns `null` in `app` scope for an item that has no real page, so callers
 * must handle it rather than emitting a link to a 404. `mockup` scope always
 * returns the href unchanged.
 */
export function navHref(href: string, scope: NavScope): string | null {
  // An app-only item already carries its real path, in both scopes. Reaching
  // this in mockup scope is not possible through `navSectionsFor` (which filters
  // such items out), but the passthrough keeps the function total.
  if (!href.startsWith("/mockup")) return href
  if (scope === "mockup") return href
  const override = APP_PATH_OVERRIDES[href]
  if (override !== undefined) return override
  // `/mockup` itself is the mockup index; it has no app counterpart.
  if (href === "/mockup") return null
  return href.replace(/^\/mockup/, "")
}

/**
 * The landing page for a role in the given scope.
 *
 * Derived through `navHref` rather than hardcoded, so this cannot drift from the
 * href the nav actually renders: if an override ever changes a role's home, both
 * the nav item and the `isActiveHref` home set move together. Hardcoding
 * `/${role}` here would let them disagree, and the symptom would be a role home
 * wrongly matching its own children.
 */
export function roleHome(role: MockupRole, scope: NavScope): string {
  return navHref(ROLE_META[role].home, scope) ?? `/${role}`
}

/** The brand block's target: the mockup index, or the signed-in role's home. */
export function brandHref(scope: NavScope, role: MockupRole = "teacher"): string {
  return scope === "mockup" ? BRAND.indexHref : roleHome(role, scope)
}

/** Nav sections for `role`, without the items that cannot be linked in `scope`. */
export function navSectionsFor(role: MockupRole, scope: NavScope): NavSection[] {
  return NAV_SECTIONS[role]
    .map((section) => ({
      ...section,
      items: section.items.filter((item) =>
        scope === "mockup"
          ? // No mockup counterpart exists to link to.
            !item.appOnly
          : navHref(item.href, scope) !== null,
      ),
    }))
    .filter((section) => section.items.length > 0)
}

/**
 * Role implied by a pathname, or `null` for a role-less path.
 *
 * `mockup` reads the segment after `/mockup`; `app` reads the first segment
 * (`/teacher/reviews` → `teacher`).
 */
export function roleFromPathname(pathname: string, scope: NavScope = "mockup"): MockupRole | null {
  const segments = pathname.split("/").filter(Boolean)
  const segment = scope === "mockup" ? segments[1] : segments[0]
  if (segment === "teacher" || segment === "student" || segment === "admin") return segment
  return null
}

/**
 * Every page in the **mockup** tree, flattened, with its role and section.
 *
 * App-only items are excluded: they have no mockup page, so including them would
 * break the mockup index's page count and the "every nav href has a mockup page"
 * assertion in `tests/nav-scope.test.ts`.
 */
export function allNavItems(): { role: MockupRole; section: NavSection; item: NavItem }[] {
  return MOCKUP_ROLES.flatMap((role) =>
    NAV_SECTIONS[role].flatMap((section) =>
      section.items.filter((item) => !item.appOnly).map((item) => ({ role, section, item })),
    ),
  )
}

/** Look up a page by `href`. Used by the stub pages and the shell breadcrumb. */
export function findNavItem(
  href: string,
): { role: MockupRole; section: NavSection; item: NavItem } | null {
  return allNavItems().find((entry) => entry.item.href === href) ?? null
}

/**
 * Is `href` the active page for `pathname`?
 *
 * `/mockup/teacher` must be active on `/mockup/teacher` but NOT on
 * `/mockup/teacher/classes`, so a prefix match is only allowed for non-home
 * routes.
 */
export function isActiveHref(pathname: string, href: string, scope: NavScope = "mockup"): boolean {
  if (pathname === href) return true
  const isRoleHome = MOCKUP_ROLES.some((role) => roleHome(role, scope) === href)
  if (isRoleHome) return false
  return pathname.startsWith(`${href}/`)
}
