import { NextResponse } from "next/server"

import { requireRole } from "@/lib/authz"
import {
  listGeneratedQuestionsForTeacher,
  quizGenerationErrorResponse,
} from "@/lib/quiz-generation"

type RouteParams = { params: Promise<{ assessmentId: string }> }

export const dynamic = "force-dynamic"

/**
 * `GET /api/teacher/quiz/[assessmentId]` — the owner view of every generated
 * question (drafts and published). It includes the answer key because the owner
 * must review and edit it before publishing.
 */
export async function GET(_request: Request, context: RouteParams) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const { assessmentId } = await context.params

  try {
    const result = await listGeneratedQuestionsForTeacher(auth.user, assessmentId)
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    return quizGenerationErrorResponse(error)
  }
}
