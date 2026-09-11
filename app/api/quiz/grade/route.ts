import { NextResponse } from "next/server"

import { jsonError, parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { quizGradeRequestSchema } from "@/lib/contracts"
import { QuizGradingError, gradeQuizSubmission } from "@/lib/quiz-grading"

export const dynamic = "force-dynamic"

/**
 * Grade a quiz submission server-side. The request contains only the selected
 * answers; the correct option is derived from the database and returned only
 * after grading. A student is always graded as their own profile.
 */
export async function POST(request: Request) {
  const auth = await requireRole("student", "teacher", "admin")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, quizGradeRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const result = await gradeQuizSubmission(parsed.data, auth.user)
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    if (error instanceof QuizGradingError) return jsonError(error.message, error.status)
    console.error("Quiz grading error:", error)
    return jsonError("Unable to grade quiz.", 500)
  }
}
