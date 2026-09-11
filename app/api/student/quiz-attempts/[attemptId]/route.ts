import { NextResponse } from "next/server"

import { requireRole } from "@/lib/authz"
import { getStudentAttempt, quizAttemptErrorResponse } from "@/lib/quiz-attempts"

export const dynamic = "force-dynamic"

/**
 * `GET /api/student/quiz-attempts/[attemptId]` — one of the signed-in student's
 * own attempts. Before submission the payload carries the questions with no
 * answer key and no explanation; after submission it adds the per-question
 * results (correctness, their answer, the correct answer, the explanation).
 *
 * Another student's attempt is reported as 404 so the endpoint never confirms
 * that it exists.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ attemptId: string }> },
) {
  const auth = await requireRole("student")
  if (!auth.authorized) return auth.response

  const { attemptId } = await params
  try {
    const attempt = await getStudentAttempt(auth.user, attemptId)
    return NextResponse.json({ success: true, attempt })
  } catch (error) {
    return quizAttemptErrorResponse(error)
  }
}
