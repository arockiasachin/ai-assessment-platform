import { RoleGuard } from "@/components/role-guard"
import { RolePageShell } from "@/components/role-page-shell"
import { StudentCoursesView } from "@/components/student-courses-view"

export default async function StudentCoursesPage() {
  return (
    <RoleGuard role="student">
      <RolePageShell
        role="student"
        title="Courses"
        description="View your enrolled courses, search offered courses, and register during active windows."
      >
        <StudentCoursesView />
      </RolePageShell>
    </RoleGuard>
  )
}
