import { NextResponse } from "next/server"

import { parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { codeEvalErrorResponse, runSamplesForStudent } from "@/lib/code-eval"
import { codeRunRequestSchema } from "@/lib/contracts/code-eval"

export const dynamic = "force-dynamic"

/**
 * `POST /api/student/code-submissions/run` — the free sample Run.
 *
 * Executes the source against the task's **visible** sample cases only, in the
 * same sandbox the graded Submit uses, and persists nothing: no `TestRun`, no
 * `Submission` write, no cap consumption. It is throttled, because "free" means
 * "uncounted", not "unlimited" — each call still starts a container. Hidden test
 * cases are never executed here and their detail is never returned; the result
 * shape is not a `TestRunResponse` precisely so it cannot be mistaken for
 * evidence. See `lib/code-eval/free-run.ts`.
 */
export async function POST(request: Request) {
  const auth = await requireRole("student")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, codeRunRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const result = await runSamplesForStudent(auth.user, parsed.data)
    return NextResponse.json({
      success: true,
      message: "Sample run complete. This run is a preview and does not count against your limit.",
      result,
    })
  } catch (error) {
    return codeEvalErrorResponse(error)
  }
}
