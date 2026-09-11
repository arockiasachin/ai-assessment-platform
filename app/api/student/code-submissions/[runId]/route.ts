import { NextResponse } from "next/server"

import { requireRole } from "@/lib/authz"
import { codeEvalErrorResponse, getStudentRun } from "@/lib/code-eval"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ runId: string }> }

/**
 * `GET /api/student/code-submissions/[runId]` — one of the signed-in student's
 * own runs. A run belonging to another student responds 404.
 */
export async function GET(_request: Request, context: RouteParams) {
  const auth = await requireRole("student")
  if (!auth.authorized) return auth.response

  const { runId } = await context.params
  try {
    const run = await getStudentRun(auth.user, runId)
    return NextResponse.json({ success: true, run })
  } catch (error) {
    return codeEvalErrorResponse(error)
  }
}
