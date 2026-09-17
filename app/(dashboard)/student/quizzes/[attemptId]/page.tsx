import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { StudentQuizAttempts } from "@/components/student-quiz-attempts"
import { getSessionUser } from "@/lib/auth"
import { getStudentAttempt, listStudentQuizzes } from "@/lib/quiz-attempts"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Quiz attempt" }

/**
 * One quiz sitting, addressed directly.
 *
 * This route is why a **practice** sitting is reachable at all. Practice is deliberately absent
 * from the graded history (`listStudentAttempts` is kind-scoped), so the retake surface's
 * "Practise these questions" used to start an attempt and push `/student/quizzes/<id>` — a path
 * with no route, which 404'd and stranded the attempt (SN-1/SN-28).
 *
 * Opening the attempt here works at any status: in progress (answer and autosave, then submit),
 * or submitted (the scored disclosure is rendered). It is not a redirect into the quizzes page:
 * the attempt has a stable URL of its own, so it stays reachable after the fact rather than
 * merely ceasing to 404.
 */
export default async function StudentQuizAttemptPage({
  params,
}: {
  params: Promise<{ attemptId: string }>
}) {
  const user = await getSessionUser()
  if (!user || user.role !== "student") redirect("/login")

  const { attemptId } = await params

  // Ownership is enforced by `getStudentAttempt`: another student's attempt is a 404, so this
  // route never confirms that someone else's sitting exists.
  const attempt = await getStudentAttempt(user, attemptId).catch(() => null)
  if (!attempt) notFound()

  const quizzes = await listStudentQuizzes(user)

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
          title={attempt.assessmentTitle}
          description="Answer the questions, then submit. Answers are autosaved while the sitting is in progress; a teacher approves every score before it is published."
        />
        <StudentQuizAttempts initialQuizzes={quizzes} initialAttempt={attempt} />
      </AppShell>
    </RoleGuard>
  )
}
