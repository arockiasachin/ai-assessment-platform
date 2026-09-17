import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { StudentQuizAttempts } from "@/components/student-quiz-attempts"
import { getSessionUser } from "@/lib/auth"
import { listStudentQuizzes } from "@/lib/quiz-attempts"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Quizzes" }

/**
 * Quizzes.
 *
 * The attempt flow is the write path — it starts a sitting, autosaves answers while it is in
 * progress, and submits — so it is kept as it is and the shell and chrome are ported around it.
 *
 * `QuizAttempt.kind` exists and practice is live: the retake surface starts a practice sitting
 * through `/api/student/quiz-attempts/practice`, and `/student/quizzes/[attemptId]` serves it.
 * The mockup's sitting card also shows a countdown, per-question flags and a practice/graded
 * distinction; `expiresAt` is never written and no flag column exists, so those are omitted
 * rather than faked.
 */
export default async function StudentQuizzesPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "student") redirect("/login")

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
          title="Quizzes"
          description="Take your quizzes and review your attempt history. Answers are scored on the server; a teacher approves every score before it is published."
        />
        <StudentQuizAttempts initialQuizzes={quizzes} />
      </AppShell>
    </RoleGuard>
  )
}
