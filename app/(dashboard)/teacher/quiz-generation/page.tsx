import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { TeacherQuizGenerator } from "@/components/teacher-quiz-generator"
import { listSubtopicBreakdowns } from "@/lib/analytics/subtopics"
import { getSessionUser } from "@/lib/auth"
import {
  listGeneratedQuestionsForTeacher,
  listGenerationAssessmentsForTeacher,
} from "@/lib/quiz-generation"
import type { SubtopicBreakdownValue } from "@/lib/contracts/analytics"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Quiz AI" }

/**
 * Quiz generation.
 *
 * Server-fetched: assessments, their questions, and the topic breakdown per assessment. The
 * generation and publish write paths stay where they are — this is the read side plus the panel.
 *
 * The topic breakdowns come from one batched reader (`listSubtopicBreakdowns`) rather than the
 * single-assessment variant, because this page lists every assessment a teacher owns and a
 * per-assessment call would be an N+1 on load.
 */
export default async function TeacherQuizGenerationPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "teacher") redirect("/login")

  const assessments = await listGenerationAssessmentsForTeacher(user)
  const questionsByAssessment = await Promise.all(
    assessments.map((assessment) => listGeneratedQuestionsForTeacher(user, assessment.id)),
  )
  const questions = questionsByAssessment.flat()

  // The reader takes ids and trusts the caller's authorisation, so ownership is established first
  // by `listGenerationAssessmentsForTeacher` — the ids below are all this teacher's.
  const breakdowns = await listSubtopicBreakdowns(assessments.map((assessment) => assessment.id))
  const subtopicBreakdowns: Record<string, SubtopicBreakdownValue> = Object.fromEntries(
    [...breakdowns.entries()].map(([id, breakdown]) => [id, breakdown]),
  )

  return (
    <RoleGuard role="teacher">
      <AppShell
        scope="app"
        role="teacher"
        user={{
          name: user.email,
          email: user.email,
          initials: initialsFromEmail(user.email),
          roleLabel: roleLabelFromRole(user.role),
        }}
      >
        <PageHeader
          title="Quiz AI"
          description="Describe a topic; the system retrieves your course material and drafts multiple-choice questions with misconception-targeting distractors. Nothing is delivered until you publish it."
        />
        <TeacherQuizGenerator
          initialAssessments={assessments}
          initialQuestions={questions}
          subtopicBreakdowns={subtopicBreakdowns}
        />
      </AppShell>
    </RoleGuard>
  )
}
