import { NextResponse } from "next/server"

import { parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { quizAttemptStartRequestSchema } from "@/lib/contracts"
import {
  listStudentAttempts,
  listStudentQuizzes,
  quizAttemptErrorResponse,
  startQuizAttempt,
} from "@/lib/quiz-attempts"

export const dynamic = "force-dynamic"

/**
 * `GET /api/student/quiz-attempts` — the signed-in student's enrolled quizzes
 * with the attempt budget and deadline state. With `?assessmentId=` it returns
 * their own attempt history for that quiz.
 *
 * `POST` — start (or resume) an attempt. Enrollment, deliverability, the
 * deadline, and the attempt cap are all enforced server-side from the database.
 */
export async function GET(request: Request) {
  const auth = await requireRole("student")
  if (!auth.authorized) return auth.response

  const assessmentId = new URL(request.url).searchParams.get("assessmentId")
  try {
    if (assessmentId) {
      const attempts = await listStudentAttempts(auth.user, assessmentId)
      return NextResponse.json({ success: true, attempts })
    }
    const quizzes = await listStudentQuizzes(auth.user)
    return NextResponse.json({ success: true, quizzes })
  } catch (error) {
    return quizAttemptErrorResponse(error)
  }
}

export async function POST(request: Request) {
  const auth = await requireRole("student")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, quizAttemptStartRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const attempt = await startQuizAttempt(auth.user, parsed.data)
    return NextResponse.json({ success: true, attempt })
  } catch (error) {
    return quizAttemptErrorResponse(error)
  }
}
