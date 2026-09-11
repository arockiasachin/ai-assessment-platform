import { RoleGuard } from "@/components/role-guard"
import { RolePageShell } from "@/components/role-page-shell"
import { TeacherView } from "@/components/teacher-view"

export default async function TeacherPage() {
  return (
    <RoleGuard role="teacher">
      <RolePageShell
        role="teacher"
        title="Teacher dashboard"
        description="Manage assessments, monitor class trends, and act on upcoming events."
      >
        <TeacherView />
      </RolePageShell>
    </RoleGuard>
  )
}
