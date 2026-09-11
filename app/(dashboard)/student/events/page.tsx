import { FuturePagePlaceholder } from "@/components/future-page-placeholder"
import { RoleGuard } from "@/components/role-guard"
import { RolePageShell } from "@/components/role-page-shell"

export default async function StudentEventsPage() {
  return (
    <RoleGuard role="student">
      <RolePageShell role="student" title="Events" description="Future student events workspace.">
        <FuturePagePlaceholder role="student" pageName="Events" />
      </RolePageShell>
    </RoleGuard>
  )
}
