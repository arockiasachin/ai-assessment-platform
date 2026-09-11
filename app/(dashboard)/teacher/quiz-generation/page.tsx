import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { RolePageShell } from "@/components/role-page-shell"
import { TeacherQuizGenerator } from "@/components/teacher-quiz-generator"
import { getSessionUser } from "@/lib/auth"
import {
  listGeneratedQuestionsForTeacher,
  listGenerationAssessmentsForTeacher,
} from "@/lib/quiz-generation"

export const dynamic = "force-dynamic"

export default async function TeacherQuizGenerationPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "teacher") redirect("/login")

  const assessments = await listGenerationAssessmentsForTeacher(user)
  const questionsByAssessment = await Promise.all(
    assessments.map((assessment) => listGeneratedQuestionsForTeacher(user, assessment.id)),
  )
  const questions = questionsByAssessment.flat()

  return (
    <RoleGuard role="teacher">
      <RolePageShell
        role="teacher"
        title="Quiz generation"
        description="Describe a topic; the system retrieves your course material and drafts multiple-choice questions with misconception-targeting distractors. Nothing is delivered until you publish it."
      >
        <TeacherQuizGenerator initialAssessments={assessments} initialQuestions={questions} />
      </RolePageShell>
    </RoleGuard>
  )
}
