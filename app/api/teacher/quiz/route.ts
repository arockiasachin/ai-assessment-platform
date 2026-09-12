import { NextResponse } from "next/server"

import { isDatabaseError, jsonError, parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { quizImportRequestSchema } from "@/lib/contracts"
import { createQuizFromImportForSessionUser } from "@/lib/gradebook-db"

export async function POST(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, quizImportRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const assessment = await createQuizFromImportForSessionUser(parsed.data, auth.user)
    return NextResponse.json({
      success: true,
      message: "Quiz created successfully.",
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
    // The importer throws descriptive validation errors; surface those, but
    // never a raw database error (which can embed internal paths and schema).
    if (message && !isDatabaseError(error)) return jsonError(message, 400)
    console.error("Create quiz error:", error)
    return jsonError("Unable to create quiz.", 500)
  }
}
