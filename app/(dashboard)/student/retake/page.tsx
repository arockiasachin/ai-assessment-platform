import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { RolePageShell } from "@/components/role-page-shell"
import { StudentAdaptiveRetake } from "@/components/student-adaptive-retake"
import { getSessionUser } from "@/lib/auth"
import { listStudentRetakableAssessmentsForStudent } from "@/lib/analytics/service"

export const dynamic = "force-dynamic"

export default async function StudentRetakePage() {
  const user = await getSessionUser()
  if (!user || user.role !== "student") redirect("/login")

  const assessments = await listStudentRetakableAssessmentsForStudent(user)

  return (
    <RoleGuard role="student">
      <RolePageShell
        role="student"
        title="Adaptive retake"
        description="A targeted retake built only from the questions you got wrong (or left blank) on your latest attempt, rather than the whole quiz."
      >
        <StudentAdaptiveRetake initialAssessments={assessments} />
      </RolePageShell>
    </RoleGuard>
  )
}
