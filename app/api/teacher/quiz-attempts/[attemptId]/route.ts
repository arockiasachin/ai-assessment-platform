import { NextResponse } from "next/server"

import { requireRole } from "@/lib/authz"
import { getTeacherAttempt, quizAttemptErrorResponse } from "@/lib/quiz-attempts"

export const dynamic = "force-dynamic"

/**
 * `GET /api/teacher/quiz-attempts/[attemptId]` — an attempt on an assessment the
 * signed-in teacher owns, with the answer key, the student's per-question
 * outcome, and the current `GradeReview` / `Grade` state so they can grade.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ attemptId: string }> },
) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const { attemptId } = await params
  try {
    const detail = await getTeacherAttempt(auth.user, attemptId)
    return NextResponse.json({ success: true, detail })
  } catch (error) {
    return quizAttemptErrorResponse(error)
  }
}
