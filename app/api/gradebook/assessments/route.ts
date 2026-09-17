import { NextResponse } from "next/server"

import { jsonError, parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { createAssessmentRequestSchema } from "@/lib/contracts"
import { createAssessmentForSessionUser, listAssessmentsForSessionUser } from "@/lib/gradebook-db"

export const dynamic = "force-dynamic"

/**
 * `GET /api/gradebook/assessments` — the caller's assessments, with authoring completeness.
 *
 * `POST` — create one. Idempotent on the request's natural key (offering, title, kind, date,
 * ceiling): two concurrent identical submissions create one row and both return it, rather
 * than the indistinguishable duplicate TN-55 found.
 */
export async function GET() {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  try {
    const assessments = await listAssessmentsForSessionUser(auth.user)
    return NextResponse.json({ success: true, assessments })
  } catch (error) {
    console.error("List assessments error:", error)
    return jsonError("Unable to list assessments.", 500)
  }
}

export async function POST(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, createAssessmentRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const assessment = await createAssessmentForSessionUser(parsed.data, auth.user)
    return NextResponse.json({ success: true, assessment, created: assessment.created })
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
