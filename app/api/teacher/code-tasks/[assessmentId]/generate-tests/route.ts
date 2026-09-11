import { NextResponse } from "next/server"

import { parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { codeEvalErrorResponse, generateTestCaseDraftsForTeacher } from "@/lib/code-eval"
import { generateTestCasesRequestSchema } from "@/lib/contracts/code-eval"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ assessmentId: string }> }

/**
 * `POST /api/teacher/code-tasks/[assessmentId]/generate-tests` — draft candidate
 * test cases with the model. They stay DRAFTS until published.
 */
export async function POST(request: Request, context: RouteParams) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const { assessmentId } = await context.params
  const parsed = await parseJsonBody(request, generateTestCasesRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const testCases = await generateTestCaseDraftsForTeacher(auth.user, assessmentId, parsed.data)
    return NextResponse.json({
      success: true,
      message: "Draft test cases generated. They stay drafts until you publish them.",
      testCases,
    })
  } catch (error) {
    return codeEvalErrorResponse(error)
  }
}
