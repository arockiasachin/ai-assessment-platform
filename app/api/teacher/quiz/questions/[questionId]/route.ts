import { NextResponse } from "next/server"

import { parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { quizDraftUpdateRequestSchema } from "@/lib/contracts"
import { quizGenerationErrorResponse, updateDraftQuestionForTeacher } from "@/lib/quiz-generation"

type RouteParams = { params: Promise<{ questionId: string }> }

export const dynamic = "force-dynamic"

/** `PATCH /api/teacher/quiz/questions/[questionId]` — edit an unpublished draft. */
export async function PATCH(request: Request, context: RouteParams) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const { questionId } = await context.params
  const parsed = await parseJsonBody(request, quizDraftUpdateRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const question = await updateDraftQuestionForTeacher(auth.user, questionId, parsed.data)
    return NextResponse.json({ success: true, message: "Draft updated.", question })
  } catch (error) {
    return quizGenerationErrorResponse(error)
  }
}
