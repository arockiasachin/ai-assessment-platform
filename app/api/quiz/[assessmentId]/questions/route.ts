import { NextResponse } from "next/server"

import { requireRole } from "@/lib/authz"
import { listPublishedQuizForLearner, quizGenerationErrorResponse } from "@/lib/quiz-generation"

type RouteParams = { params: Promise<{ assessmentId: string }> }

export const dynamic = "force-dynamic"

/**
 * `GET /api/quiz/[assessmentId]/questions` — published questions for a learner.
 * The payload deliberately omits every answer-key field; correctness is only
 * ever learned by submitting answers to the grade route.
 */
export async function GET(_request: Request, context: RouteParams) {
  const auth = await requireRole("student", "teacher", "admin")
  if (!auth.authorized) return auth.response

  const { assessmentId } = await context.params

  try {
    const quiz = await listPublishedQuizForLearner(auth.user, assessmentId)
    return NextResponse.json({ success: true, ...quiz })
  } catch (error) {
    return quizGenerationErrorResponse(error)
  }
}
