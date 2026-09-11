import { TeacherRatingsReport } from "@/components/teacher-ratings-report"
import { RoleGuard } from "@/components/role-guard"
import { RolePageShell } from "@/components/role-page-shell"

export default async function TeacherReportsPage() {
  return (
    <RoleGuard role="teacher">
      <RolePageShell role="teacher" title="Reports" description="Course rating trends and student feedback.">
        <TeacherRatingsReport />
      </RolePageShell>
    </RoleGuard>
  )
}
