import { NextResponse } from "next/server"

import { parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import {
  evaluateSubmissionForTeacher,
  evaluationRequestSchema,
  rubricErrorResponse,
} from "@/lib/rubric-grading"

/**
 * `POST /api/teacher/reviews/evaluate` — score every rubric criterion for one
 * submission. This only refreshes the draft grade and may flag the review; it
 * never publishes.
 */
export async function POST(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, evaluationRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const outcome = await evaluateSubmissionForTeacher(auth.user, parsed.data.submissionId)
    return NextResponse.json({ success: true, ...outcome })
  } catch (error) {
    return rubricErrorResponse(error)
  }
}
