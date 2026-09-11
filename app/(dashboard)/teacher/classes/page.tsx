import { TeacherClassesManager } from "@/components/teacher-classes-manager"
import { RoleGuard } from "@/components/role-guard"
import { RolePageShell } from "@/components/role-page-shell"

export default async function TeacherClassesPage() {
  return (
    <RoleGuard role="teacher">
      <RolePageShell
        role="teacher"
        title="Classes"
        description="Manage enrollment limits and registration windows."
      >
        <TeacherClassesManager />
      </RolePageShell>
    </RoleGuard>
  )
}
