import { RoleGuard } from "@/components/role-guard"
import { AdminPageShell } from "@/components/admin-page-shell"
import { AdminToolsPanel } from "@/components/admin-tools-panel"

export default async function AdminToolsPage() {
  return (
    <RoleGuard role="admin">
      <AdminPageShell
        title="Admin Tools"
        description="Execute controlled maintenance actions for development data integrity."
      >
        <AdminToolsPanel />
      </AdminPageShell>
    </RoleGuard>
  )
}
