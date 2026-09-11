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
    const message = error instanceof Error ? error.message : "Unable to create assessment."
    const status = message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400
    return jsonError(message, status)
  }
}
