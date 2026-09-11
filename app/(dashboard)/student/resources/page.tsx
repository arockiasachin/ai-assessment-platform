import { FuturePagePlaceholder } from "@/components/future-page-placeholder"
import { RoleGuard } from "@/components/role-guard"
import { RolePageShell } from "@/components/role-page-shell"

export default async function StudentResourcesPage() {
  return (
    <RoleGuard role="student">
      <RolePageShell
        role="student"
        title="Resources"
        description="Future student resources workspace."
      >
        <FuturePagePlaceholder role="student" pageName="Resources" />
      </RolePageShell>
    </RoleGuard>
  )
}
