import { NextResponse } from "next/server"

import { parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { quizGenerationRequestSchema } from "@/lib/contracts/quiz-generation"
import {
  generateQuizDraftsForTeacher,
  listGeneratedQuestionsForTeacher,
  listGenerationAssessmentsForTeacher,
  quizGenerationErrorResponse,
} from "@/lib/quiz-generation"

export const dynamic = "force-dynamic"

/**
 * `GET /api/teacher/quiz-generation` — the teacher's own assessments with draft
 * and published counts. With `?assessmentId=` it returns the generated questions
 * (drafts and published) for that owned assessment.
 *
 * `POST /api/teacher/quiz-generation` — retrieve material for a topic and
 * generate UNPUBLISHED draft questions against one owned assessment.
 */
export async function GET(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const assessmentId = new URL(request.url).searchParams.get("assessmentId")

  try {
    if (assessmentId) {
      const questions = await listGeneratedQuestionsForTeacher(auth.user, assessmentId)
      return NextResponse.json({ success: true, questions })
    }
    const assessments = await listGenerationAssessmentsForTeacher(auth.user)
    return NextResponse.json({ success: true, assessments })
  } catch (error) {
    return quizGenerationErrorResponse(error)
  }
}

export async function POST(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, quizGenerationRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const outcome = await generateQuizDraftsForTeacher(auth.user, parsed.data)
    return NextResponse.json({
      success: true,
      message: "Draft questions generated. They stay unpublished until you publish them.",
      ...outcome,
    })
  } catch (error) {
    return quizGenerationErrorResponse(error)
  }
}
