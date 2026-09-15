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
  /** Mockup route, e.g. `/mockup/teacher/reviews`. */
  href: string
  icon: LucideIcon
  /** One line shown on the mockup index card and in the page header. */
  description: string
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

/** Role implied by a mockup pathname, or `null` for `/mockup` itself. */
export function roleFromPathname(pathname: string): MockupRole | null {
  const segment = pathname.split("/").filter(Boolean)[1]
  if (segment === "teacher" || segment === "student" || segment === "admin") return segment
  return null
}

/** Every page in the mockup tree, flattened, with its role and section. */
export function allNavItems(): { role: MockupRole; section: NavSection; item: NavItem }[] {
  return MOCKUP_ROLES.flatMap((role) =>
    NAV_SECTIONS[role].flatMap((section) => section.items.map((item) => ({ role, section, item }))),
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
export function isActiveHref(pathname: string, href: string): boolean {
  if (pathname === href) return true
  const isRoleHome = MOCKUP_ROLES.some((role) => ROLE_META[role].home === href)
  if (isRoleHome) return false
  return pathname.startsWith(`${href}/`)
}
