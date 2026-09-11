import { NextResponse } from "next/server"

import { requireRole } from "@/lib/authz"
import { codeEvalErrorResponse, getCodeTaskForTeacher } from "@/lib/code-eval"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ assessmentId: string }> }

/** `GET /api/teacher/code-tasks/[assessmentId]` — one owned code task + test cases. */
export async function GET(_request: Request, context: RouteParams) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const { assessmentId } = await context.params
  try {
    const detail = await getCodeTaskForTeacher(auth.user, assessmentId)
    return NextResponse.json({ success: true, ...detail })
  } catch (error) {
    return codeEvalErrorResponse(error)
  }
}
