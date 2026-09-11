import { NextResponse } from "next/server"

import { parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { publishQuestionsRequestSchema } from "@/lib/contracts/quiz-generation"
import {
  publishGeneratedQuestionsForTeacher,
  quizGenerationErrorResponse,
} from "@/lib/quiz-generation"

export const dynamic = "force-dynamic"

/**
 * `POST /api/teacher/quiz-generation/publish` — the explicit teacher action
 * that moves drafts to published. Omit `questionIds` to publish every draft on
 * the owned assessment; supply them to publish a subset. Each question is
 * re-checked server-side for exactly one correct option first.
 */
export async function POST(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, publishQuestionsRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const outcome = await publishGeneratedQuestionsForTeacher(auth.user, parsed.data)
    return NextResponse.json({
      success: true,
      message: "Questions published.",
      ...outcome,
    })
  } catch (error) {
    return quizGenerationErrorResponse(error)
  }
}
