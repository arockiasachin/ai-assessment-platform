import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { RolePageShell } from "@/components/role-page-shell"
import { StudentQuizAttempts } from "@/components/student-quiz-attempts"
import { getSessionUser } from "@/lib/auth"
import { listStudentQuizzes } from "@/lib/quiz-attempts"

export const dynamic = "force-dynamic"

export default async function StudentQuizzesPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "student") redirect("/login")

  const quizzes = await listStudentQuizzes(user)

  return (
    <RoleGuard role="student">
      <RolePageShell
        role="student"
        title="Quizzes"
        description="Take your quizzes and review your attempt history. Answers are scored on the server; a teacher approves every score before it is published."
      >
        <StudentQuizAttempts initialQuizzes={quizzes} />
      </RolePageShell>
    </RoleGuard>
  )
}
