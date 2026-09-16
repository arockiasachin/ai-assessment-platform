import { RoleGuard } from "@/components/role-guard"
import { redirect } from "next/navigation"

import { AppShell, PageHeader } from "@/components/shell"
import { getSessionUser } from "@/lib/auth"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"
import { getAdminUsersList } from "@/lib/admin-db"
import { formatDateTime } from "@/lib/format"

// Authenticated, database-backed dashboard: never statically prerender.
export const dynamic = "force-dynamic"

export default async function AdminUsersPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "admin") redirect("/login")

  const users = await getAdminUsersList()

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
          title="User Directory"
          description="Inspect user accounts, role assignments, and identity profile links."
        />
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-3 py-2 text-left font-medium">Email</th>
                <th className="px-3 py-2 text-left font-medium">Role</th>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-left font-medium">Identity</th>
                <th className="px-3 py-2 text-left font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2">{user.email}</td>
                  <td className="px-3 py-2">{user.role}</td>
                  <td className="px-3 py-2">{user.name}</td>
                  <td className="px-3 py-2">{user.identity}</td>
                  <td className="px-3 py-2">{formatDateTime(user.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AppShell>
    </RoleGuard>
  )
}
