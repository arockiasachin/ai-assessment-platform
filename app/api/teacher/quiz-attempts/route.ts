import { NextResponse } from "next/server"

import { jsonError } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { listTeacherAttempts, quizAttemptErrorResponse } from "@/lib/quiz-attempts"

export const dynamic = "force-dynamic"

/**
 * `GET /api/teacher/quiz-attempts?assessmentId=` — the attempts for an
 * assessment the signed-in teacher owns (created it or teaches its offering).
 * The ownership check is enforced in the service, so a teacher can never read
 * another teacher's cohort.
 */
export async function GET(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const assessmentId = new URL(request.url).searchParams.get("assessmentId")
  if (!assessmentId) return jsonError("assessmentId is required.", 400)

  try {
    const attempts = await listTeacherAttempts(auth.user, assessmentId)
    return NextResponse.json({ success: true, attempts })
  } catch (error) {
    return quizAttemptErrorResponse(error)
  }
}
