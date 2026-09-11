import { NextResponse } from "next/server"

import { parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { codeEvalErrorResponse, setSimilarityVerdictForTeacher } from "@/lib/code-eval"
import { setSimilarityVerdictRequestSchema } from "@/lib/contracts/code-eval"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ assessmentId: string; checkId: string }> }

/**
 * `PATCH /api/teacher/code-tasks/[assessmentId]/similarity/[checkId]` — record a
 * human review of one flagged pair (`FLAGGED` / `CLEARED`). Never a grade.
 */
export async function PATCH(request: Request, context: RouteParams) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const { assessmentId, checkId } = await context.params
  const parsed = await parseJsonBody(request, setSimilarityVerdictRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const pair = await setSimilarityVerdictForTeacher(auth.user, assessmentId, checkId, parsed.data)
    return NextResponse.json({ success: true, message: "Similarity verdict recorded.", pair })
  } catch (error) {
    return codeEvalErrorResponse(error)
  }
}
