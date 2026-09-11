import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { RolePageShell } from "@/components/role-page-shell"
import { TeacherRubricEditor } from "@/components/teacher-rubric-editor"
import { getSessionUser } from "@/lib/auth"
import { listRubricsForTeacher } from "@/lib/rubric-grading"

export default async function TeacherRubricsPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "teacher") redirect("/login")

  const assessments = await listRubricsForTeacher(user)

  return (
    <RoleGuard role="teacher">
      <RolePageShell
        role="teacher"
        title="Rubrics"
        description="Author weighted rubrics for your assessments. Criteria carry the point ceiling the model must score within."
      >
        <TeacherRubricEditor initialAssessments={assessments} />
      </RolePageShell>
    </RoleGuard>
  )
}
