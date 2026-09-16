import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { StudentAdaptiveRetake } from "@/components/student-adaptive-retake"
import { getSessionUser } from "@/lib/auth"
import { listStudentRetakableAssessmentsForStudent } from "@/lib/analytics/service"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export default async function StudentRetakePage() {
  const user = await getSessionUser()
  if (!user || user.role !== "student") redirect("/login")

  const assessments = await listStudentRetakableAssessmentsForStudent(user)

  return (
    <RoleGuard role="student">
      <AppShell
        scope="app"
        role="student"
        user={{
          name: user.email,
          email: user.email,
          initials: initialsFromEmail(user.email),
          roleLabel: roleLabelFromRole(user.role),
        }}
      >
        <PageHeader
          title="Retake"
          description="A targeted retake built from the questions you got wrong or left blank on your latest attempt. Practise as often as you like; a graded retake is subject to your teacher's policy."
        />
        <StudentAdaptiveRetake initialAssessments={assessments} />
      </AppShell>
    </RoleGuard>
  )
}
