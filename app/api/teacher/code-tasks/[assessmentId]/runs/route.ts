import { NextResponse } from "next/server"

import { requireRole } from "@/lib/authz"
import { codeEvalErrorResponse, listRunsForTeacher } from "@/lib/code-eval"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ assessmentId: string }> }

/**
 * `GET /api/teacher/code-tasks/[assessmentId]/runs` — sandbox evidence for the
 * teacher's own offering, newest first. Optional `?studentId=`.
 */
export async function GET(request: Request, context: RouteParams) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const { assessmentId } = await context.params
  const studentId = new URL(request.url).searchParams.get("studentId") ?? undefined

  try {
    const runs = await listRunsForTeacher(auth.user, assessmentId, { studentId })
    return NextResponse.json({ success: true, runs })
  } catch (error) {
    return codeEvalErrorResponse(error)
  }
}
