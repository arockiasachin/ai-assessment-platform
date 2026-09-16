import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { findNavItemByAppPath } from "@/components/shell/nav-config"
import { TeacherMarksView } from "@/components/teacher-marks-view"
import { getSessionUser } from "@/lib/auth"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Marks" }

const HREF = "/teacher/marks"

/**
 * The editable marks grid, moved off `/teacher` when the dashboard was ported to the
 * mockup composition.
 *
 * The grid was the app's only mark-entry UI, and the mockup dashboard has no marks
 * grid, so it was moved rather than dropped. `TeacherMarksView` reads the gradebook
 * from the `(dashboard)` layout's provider, which is why this page fetches nothing
 * itself — the payload is already seeded by the time it renders.
 *
 * The description is read from the nav rather than duplicated, so the rail label and
 * the heading cannot drift.
 */
export default async function TeacherMarksPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "teacher") redirect("/login")

  return (
    <RoleGuard role="teacher">
      <AppShell
        scope="app"
        role="teacher"
        user={{
          name: user.email,
          email: user.email,
          initials: initialsFromEmail(user.email),
          roleLabel: roleLabelFromRole(user.role),
        }}
      >
        <PageHeader title="Marks" description={findNavItemByAppPath(HREF)?.item.description} />
        <TeacherMarksView />
      </AppShell>
    </RoleGuard>
  )
}
