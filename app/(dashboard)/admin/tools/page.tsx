import { RoleGuard } from "@/components/role-guard"
import { redirect } from "next/navigation"

import { AppShell, PageHeader } from "@/components/shell"
import { getSessionUser } from "@/lib/auth"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"
import { AdminToolsPanel } from "@/components/admin-tools-panel"

export default async function AdminToolsPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "admin") redirect("/login")

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
          title="Admin Tools"
          description="Execute controlled maintenance actions for development data integrity."
        />
        <AdminToolsPanel />
      </AppShell>
    </RoleGuard>
  )
}
