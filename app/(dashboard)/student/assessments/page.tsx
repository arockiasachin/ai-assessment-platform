import { RoleGuard } from "@/components/role-guard"
import { RolePageShell } from "@/components/role-page-shell"
import { StudentAssessmentsView } from "@/components/student-assessments-view"

export default async function StudentAssessmentsPage() {
  return (
    <RoleGuard role="student">
      <RolePageShell
        role="student"
        title="Assessments"
        description="View full assessment detail, track due windows, and interact with your coursework."
      >
        <StudentAssessmentsView />
      </RolePageShell>
    </RoleGuard>
  )
}
