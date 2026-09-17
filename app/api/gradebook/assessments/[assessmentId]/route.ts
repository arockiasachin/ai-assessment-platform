import { NextResponse } from "next/server"

import { jsonError, parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { updateAssessmentRequestSchema } from "@/lib/contracts"
import {
  AssessmentWriteError,
  deleteAssessmentForSessionUser,
  updateAssessmentForSessionUser,
} from "@/lib/gradebook-db"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ assessmentId: string }> }

function writeError(error: unknown, fallback: string) {
  if (error instanceof AssessmentWriteError) return jsonError(error.message, error.status)
  console.error("Assessment write error:", error)
  return jsonError(fallback, 500)
}

/**
 * `PATCH /api/gradebook/assessments/[assessmentId]` — rename or re-date an owned assessment.
 * `maxMarks` is refused once marks or submissions exist (see the service).
 *
 * `DELETE` — remove an owned assessment, its calendar event and its children. Refused once
 * student work or a released mark exists, so the academic record cannot be erased by a
 * mis-click. A bare row is exactly what this is for.
 */
export async function PATCH(request: Request, context: RouteParams) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, updateAssessmentRequestSchema)
  if (!parsed.ok) return parsed.response

  const { assessmentId } = await context.params
  try {
    const assessment = await updateAssessmentForSessionUser(auth.user, assessmentId, parsed.data)
    return NextResponse.json({ success: true, assessment })
  } catch (error) {
    return writeError(error, "Unable to update the assessment.")
  }
}

export async function DELETE(_request: Request, context: RouteParams) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const { assessmentId } = await context.params
  try {
    const removed = await deleteAssessmentForSessionUser(auth.user, assessmentId)
    return NextResponse.json({ success: true, assessment: removed })
  } catch (error) {
    return writeError(error, "Unable to delete the assessment.")
  }
}
