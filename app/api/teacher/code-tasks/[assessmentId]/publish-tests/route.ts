import { NextResponse } from "next/server"

import { parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { codeEvalErrorResponse, publishGeneratedTestCasesForTeacher } from "@/lib/code-eval"
import { publishTestCasesRequestSchema } from "@/lib/contracts/code-eval"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ assessmentId: string }> }

/**
 * `POST /api/teacher/code-tasks/[assessmentId]/publish-tests` — publish generated
 * draft test cases. Publication only flips the draft marker; it never grades.
 */
export async function POST(request: Request, context: RouteParams) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const { assessmentId } = await context.params
  const parsed = await parseJsonBody(request, publishTestCasesRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const outcome = await publishGeneratedTestCasesForTeacher(auth.user, assessmentId, parsed.data)
    return NextResponse.json(outcome)
  } catch (error) {
    return codeEvalErrorResponse(error)
  }
}
