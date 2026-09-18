import { NextResponse } from "next/server"

import { isDatabaseError, jsonError } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { quizImportRequestSchema } from "@/lib/contracts"
import { createQuizFromImportForSessionUser } from "@/lib/gradebook-db"
import { mapQuizImportIssues, QuizImportError } from "@/lib/quiz-import-errors"

/**
 * A validation failure carries **every** message, not just the first, so the
 * import card can render a checklist. `message` is kept as the first entry for
 * callers that read a single string; `errors` is the full list.
 */
function importErrorResponse(errors: string[], status: number): NextResponse {
  return NextResponse.json(
    { success: false, message: errors[0] ?? "Unable to import quiz.", errors },
    { status },
  )
}

export async function POST(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return jsonError("Invalid JSON body.", 400)
  }

  // Parsed here rather than through `parseJsonBody` on purpose: the shared
  // helper reports only `firstIssueMessage`, and the import is the one contract
  // a teacher hand-writes, so it needs the full layman list instead.
  const parsed = quizImportRequestSchema.safeParse(raw)
  if (!parsed.success) {
    return importErrorResponse(mapQuizImportIssues(parsed.error), 400)
  }

  try {
    const assessment = await createQuizFromImportForSessionUser(parsed.data, auth.user)
    return NextResponse.json({
      success: true,
      message: assessment.appended ? "Questions added successfully." : "Quiz created successfully.",
      assessment,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (message === "Forbidden") return jsonError(message, 403)
    if (message === "Unauthorized") return jsonError(message, 401)
    // A missing offering and a non-owned offering are deliberately the same 403
    // so the route never confirms that another teacher's offering exists.
    if (message === "Offering not found or not owned by you.") {
      return jsonError(message, 403)
    }
    // The same refusal convention for the append target.
    if (message === "Assessment not found or not owned by you.") {
      return jsonError(message, 403)
    }
    // Recoverable import problems travel as a list of layman messages.
    if (error instanceof QuizImportError) return importErrorResponse(error.errors, 400)
    // The importer throws descriptive validation errors; surface those, but
    // never a raw database error (which can embed internal paths and schema).
    if (message && !isDatabaseError(error)) return jsonError(message, 400)
    console.error("Create quiz error:", error)
    return jsonError("Unable to create quiz.", 500)
  }
}
