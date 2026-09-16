import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { StudentView } from "@/components/student-view"
import { getSessionUser } from "@/lib/auth"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

/**
 * The student dashboard.
 *
 * `StudentView` reads the gradebook payload from context, which `app/(dashboard)/layout.tsx` now
 * seeds on the server — so the first render is populated rather than an empty shell, and the role
 * label is right before hydration.
 */
export default async function StudentPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "student") redirect("/login")

  return (
    <RoleGuard role="student">
      <AppShell
        scope="app"
        role="student"
        user={{
          name: user.email,
          email: user.email,
          initials: initialsFromEmail(user.email),
          roleLabel: roleLabelFromRole(user.role),
        }}
      >
        <PageHeader
          title="Dashboard"
          description="Track assessments, upcoming events, and progress from one place."
        />
        <StudentView />
      </AppShell>
    </RoleGuard>
  )
}
