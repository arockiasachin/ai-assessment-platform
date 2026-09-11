import { NextResponse } from "next/server"

import { jsonError, parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { createAssessmentRequestSchema } from "@/lib/contracts"
import { createAssessmentForSessionUser } from "@/lib/gradebook-db"

export async function POST(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, createAssessmentRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const assessment = await createAssessmentForSessionUser(parsed.data, auth.user)
    return NextResponse.json({ success: true, assessment })
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (message === "Forbidden") return jsonError(message, 403)
    if (message === "Unauthorized") return jsonError(message, 401)
    // A missing offering and a non-owned offering are deliberately the same
    // 403 so the route never confirms another teacher's offering exists.
    if (message === "Offering not found or not owned by you.") {
      return jsonError(message, 403)
    }
    if (message === "Staff profile missing" || message === "Assessment not found") {
      return jsonError(message, 400)
    }
    console.error("Create assessment error:", error)
    return jsonError("Unable to create assessment.", 500)
  }
}
