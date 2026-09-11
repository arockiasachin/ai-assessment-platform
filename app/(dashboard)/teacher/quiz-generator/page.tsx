import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { RolePageShell } from "@/components/role-page-shell"
import { TeacherQuizGenerator } from "@/components/teacher-quiz-generator"
import { getSessionUser } from "@/lib/auth"
import {
  listGeneratedQuestionsForTeacher,
  listOwnedQuizAssessmentsForTeacher,
} from "@/lib/quiz-generation"

export default async function TeacherQuizGeneratorPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "teacher") redirect("/login")

  const assessments = await listOwnedQuizAssessmentsForTeacher(user)
  const first = assessments[0]
  const initial = first
    ? await listGeneratedQuestionsForTeacher(user, first.id)
    : { questions: [], counts: { draft: 0, published: 0 } }

  return (
    <RoleGuard role="teacher">
      <RolePageShell
        role="teacher"
        title="Quiz Generator"
        description="Generate multiple-choice drafts from your course material. Drafts are hidden from students until you publish them."
      >
        <TeacherQuizGenerator
          initialAssessments={assessments}
          initialQuestions={initial.questions}
          initialCounts={initial.counts}
        />
      </RolePageShell>
    </RoleGuard>
  )
}
