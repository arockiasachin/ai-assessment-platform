import { NextResponse } from "next/server"

import { parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import {
  codeEvalErrorResponse,
  deleteTestCaseForTeacher,
  updateTestCaseForTeacher,
} from "@/lib/code-eval"
import { updateTestCaseRequestSchema } from "@/lib/contracts/code-eval"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ assessmentId: string; testCaseId: string }> }

/**
 * `PATCH /api/teacher/code-tasks/[assessmentId]/test-cases/[testCaseId]` — edit
 * one owned test case.
 *
 * `DELETE` — remove it. Both are ownership-checked against the owned code task.
 */
export async function PATCH(request: Request, context: RouteParams) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const { assessmentId, testCaseId } = await context.params
  const parsed = await parseJsonBody(request, updateTestCaseRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const testCase = await updateTestCaseForTeacher(
      auth.user,
      assessmentId,
      testCaseId,
      parsed.data,
    )
    return NextResponse.json({ success: true, message: "Test case updated.", testCase })
  } catch (error) {
    return codeEvalErrorResponse(error)
  }
}

export async function DELETE(_request: Request, context: RouteParams) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const { assessmentId, testCaseId } = await context.params
  try {
    await deleteTestCaseForTeacher(auth.user, assessmentId, testCaseId)
    return NextResponse.json({ success: true, message: "Test case removed." })
  } catch (error) {
    return codeEvalErrorResponse(error)
  }
}
