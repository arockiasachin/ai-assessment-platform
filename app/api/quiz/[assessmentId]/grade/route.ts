import { NextResponse } from "next/server"

import { jsonError, parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { quizGradeRequestSchema } from "@/lib/contracts"
import { gradeGeneratedQuiz, quizGenerationErrorResponse } from "@/lib/quiz-generation"

type RouteParams = { params: Promise<{ assessmentId: string }> }

export const dynamic = "force-dynamic"

/**
 * `POST /api/quiz/[assessmentId]/grade` — server-authoritative grading of a
 * generated quiz. The request carries only the selected answers; the server
 * derives correctness from the published options and discloses the key only in
 * this response.
 */
export async function POST(request: Request, context: RouteParams) {
  const auth = await requireRole("student", "teacher", "admin")
  if (!auth.authorized) return auth.response

  const { assessmentId } = await context.params
  const parsed = await parseJsonBody(request, quizGradeRequestSchema)
  if (!parsed.ok) return parsed.response
  if (parsed.data.assessmentId !== assessmentId) {
    return jsonError("The assessment id in the body does not match the URL.", 400)
  }

  try {
    const result = await gradeGeneratedQuiz(auth.user, parsed.data)
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    return quizGenerationErrorResponse(error)
  }
}
