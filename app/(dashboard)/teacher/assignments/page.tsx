import { RoleGuard } from "@/components/role-guard"
import { RolePageShell } from "@/components/role-page-shell"
import { TeacherAssignmentsManager } from "@/components/teacher-assignments-manager"

export default async function TeacherAssignmentsPage() {
  return (
    <RoleGuard role="teacher">
      <RolePageShell
        role="teacher"
        title="Assignments"
        description="Create assignments manually or import quiz assessments from JSON."
      >
        <TeacherAssignmentsManager />
      </RolePageShell>
    </RoleGuard>
  )
}
