import { RoleGuard } from "@/components/role-guard"
import { RolePageShell } from "@/components/role-page-shell"
import { StudentView } from "@/components/student-view"

export default async function StudentPage() {
  return (
    <RoleGuard role="student">
      <RolePageShell
        role="student"
        title="Student dashboard"
        description="Track assessments, upcoming events, and progress from one place."
      >
        <StudentView />
      </RolePageShell>
    </RoleGuard>
  )
}
