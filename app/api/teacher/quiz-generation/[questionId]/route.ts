import { NextResponse } from "next/server"

import { parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { generatedQuestionEditRequestSchema } from "@/lib/contracts/quiz-generation"
import {
  deleteGeneratedQuestionForTeacher,
  editGeneratedQuestionForTeacher,
  getGeneratedQuestionForTeacher,
  quizGenerationErrorResponse,
} from "@/lib/quiz-generation"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ questionId: string }> }

/**
 * `GET /api/teacher/quiz-generation/[questionId]` — inspect one owned generated
 * question (the teacher-authoring view, including which option is correct).
 *
 * `PATCH /api/teacher/quiz-generation/[questionId]` — edit an unpublished draft,
 * including its per-question `points` weight. Published questions are immutable.
 *
 * `DELETE /api/teacher/quiz-generation/[questionId]` — discard an unpublished draft.
 * A published question is refused with a 409 and the reason.
 */
export async function GET(_request: Request, context: RouteParams) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const { questionId } = await context.params

  try {
    const question = await getGeneratedQuestionForTeacher(auth.user, questionId)
    return NextResponse.json({ success: true, question })
  } catch (error) {
    return quizGenerationErrorResponse(error)
  }
}

export async function PATCH(request: Request, context: RouteParams) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const { questionId } = await context.params
  const parsed = await parseJsonBody(request, generatedQuestionEditRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const question = await editGeneratedQuestionForTeacher(auth.user, questionId, parsed.data)
    return NextResponse.json({ success: true, message: "Draft updated.", question })
  } catch (error) {
    return quizGenerationErrorResponse(error)
  }
}

export async function DELETE(_request: Request, context: RouteParams) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const { questionId } = await context.params

  try {
    await deleteGeneratedQuestionForTeacher(auth.user, questionId)
    return NextResponse.json({ success: true, message: "Draft question deleted." })
  } catch (error) {
    return quizGenerationErrorResponse(error)
  }
}
