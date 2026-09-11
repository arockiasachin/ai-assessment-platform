import { NextResponse } from "next/server"

import { parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { quizPublishRequestSchema } from "@/lib/contracts"
import {
  publishGeneratedQuestionsForTeacher,
  quizGenerationErrorResponse,
} from "@/lib/quiz-generation"

export const dynamic = "force-dynamic"

/**
 * `POST /api/teacher/quiz/publish` — the explicit action that makes drafts
 * visible to students. Editing is blocked afterwards.
 */
export async function POST(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, quizPublishRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const result = await publishGeneratedQuestionsForTeacher(auth.user, parsed.data)
    return NextResponse.json({
      success: true,
      message: `Published ${result.published.length} question(s).`,
      ...result,
    })
  } catch (error) {
    return quizGenerationErrorResponse(error)
  }
}
