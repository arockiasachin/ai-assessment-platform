import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { AdminCourseGradingView } from "@/components/admin-course-grading-view"
import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { describeGradingEffect, listCourseGradingForAdmin } from "@/lib/analytics/course-category"
import { getSessionUser } from "@/lib/auth"
import type { CourseCategory } from "@/lib/generated/prisma/enums"
import { COURSE_CATEGORY_VALUES } from "@/lib/labels"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

// Authenticated, database-backed dashboard: never statically prerender.
export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Course Grading" }

export default async function AdminCoursesPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "admin") redirect("/login")

  const rows = await listCourseGradingForAdmin()
  // Resolved on the server because `describeGradingEffect` lives in a `server-only` module;
  // the client view receives the sentences rather than re-deriving the rule and drifting.
  const gradingEffect = Object.fromEntries(
    COURSE_CATEGORY_VALUES.map((category) => [category, describeGradingEffect(category)]),
  ) as Record<CourseCategory, string>

  return (
    <RoleGuard role="admin">
      <AppShell
        scope="app"
        role="admin"
        user={{
          name: user.email,
          email: user.email,
          initials: initialsFromEmail(user.email),
          roleLabel: roleLabelFromRole(user.role),
        }}
      >
        <PageHeader
          title="Course Grading"
          description="Set each course's category and see which grading regime its offerings resolve to. The category is an institutional fact from VIT's Academic Regulations, so it is set here rather than by the teacher who happens to teach the course."
        />
        <AdminCourseGradingView rows={rows} gradingEffect={gradingEffect} />
      </AppShell>
    </RoleGuard>
  )
}
