import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { TeacherView } from "@/components/teacher-view"
import { getSessionUser } from "@/lib/auth"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

/**
 * The teacher dashboard.
 *
 * `TeacherView` reads the gradebook payload from context, seeded on the server by
 * `app/(dashboard)/layout.tsx`. The tile that shows student counts deliberately does not use the
 * payload's enrolment rows as a gate: that read has no `status` filter, so a waitlisted student
 * would appear here but not on `/teacher/classes` — recorded in `docs/plans/wave-3.md` §7.4.
 */
export default async function TeacherPage() {
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
        <PageHeader
          title="Dashboard"
          description="Manage assessments, monitor class trends, and act on upcoming events."
        />
        <TeacherView />
      </AppShell>
    </RoleGuard>
  )
}
