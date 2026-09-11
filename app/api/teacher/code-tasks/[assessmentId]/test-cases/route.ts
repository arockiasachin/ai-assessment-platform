import { NextResponse } from "next/server"

import { parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { codeEvalErrorResponse, createTestCaseForTeacher } from "@/lib/code-eval"
import { createTestCaseRequestSchema } from "@/lib/contracts/code-eval"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ assessmentId: string }> }

/**
 * `POST /api/teacher/code-tasks/[assessmentId]/test-cases` — add a hand-authored
 * test case. Hand-authored cases are immediately active (not drafts).
 */
export async function POST(request: Request, context: RouteParams) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const { assessmentId } = await context.params
  const parsed = await parseJsonBody(request, createTestCaseRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const testCase = await createTestCaseForTeacher(auth.user, assessmentId, parsed.data)
    return NextResponse.json({ success: true, message: "Test case added.", testCase })
  } catch (error) {
    return codeEvalErrorResponse(error)
  }
}
