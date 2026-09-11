import { NextResponse } from "next/server"

import { parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { quizGenerationRequestSchema } from "@/lib/contracts"
import { generateQuizDraftsForTeacher, quizGenerationErrorResponse } from "@/lib/quiz-generation"

export const dynamic = "force-dynamic"

/**
 * `POST /api/teacher/quiz/generate` — retrieve course material for a topic and
 * draft questions. The drafts are unpublished; publishing is a separate,
 * explicit teacher action.
 */
export async function POST(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, quizGenerationRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const summary = await generateQuizDraftsForTeacher(auth.user, parsed.data)
    return NextResponse.json({
      success: true,
      message: `Drafted ${summary.created.length} question(s). Publish them when you are ready.`,
      ...summary,
    })
  } catch (error) {
    return quizGenerationErrorResponse(error)
  }
}
