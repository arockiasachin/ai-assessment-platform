import { NextResponse } from "next/server"

import { parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { quizAttemptSubmitRequestSchema } from "@/lib/contracts"
import { quizAttemptErrorResponse, submitQuizAttempt } from "@/lib/quiz-attempts"

export const dynamic = "force-dynamic"

/**
 * `POST /api/student/quiz-attempts/[attemptId]/submit` — persist the answers and
 * score them server-side. The request carries only `{ questionId, selectedIndex }`;
 * the server derives correctness from `QuestionOption.isCorrect`.
 *
 * The score is written to the grade pipeline as a deterministic
 * `AIGradeSuggestion` attached to a `GradeReview`. Nothing here publishes a
 * `Grade`; only a human `accept`/`override` does.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ attemptId: string }> },
) {
  const auth = await requireRole("student")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, quizAttemptSubmitRequestSchema)
  if (!parsed.ok) return parsed.response

  const { attemptId } = await params
  try {
    const attempt = await submitQuizAttempt(auth.user, attemptId, parsed.data)
    return NextResponse.json({
      success: true,
      message: "Quiz submitted. Your score is a suggestion pending teacher approval.",
      attempt,
    })
  } catch (error) {
    return quizAttemptErrorResponse(error)
  }
}
