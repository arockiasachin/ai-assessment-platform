import { FuturePagePlaceholder } from "@/components/future-page-placeholder"
import { RoleGuard } from "@/components/role-guard"
import { RolePageShell } from "@/components/role-page-shell"

export default async function TeacherPlannerPage() {
  return (
    <RoleGuard role="teacher">
      <RolePageShell role="teacher" title="Planner" description="Future lesson and assessment planner workspace.">
        <FuturePagePlaceholder role="teacher" pageName="Planner" />
      </RolePageShell>
    </RoleGuard>
  )
}
