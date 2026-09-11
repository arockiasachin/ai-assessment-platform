import { NextResponse } from "next/server"

import { requireRole } from "@/lib/authz"
import { getRubricForAssessment, rubricErrorResponse } from "@/lib/rubric-grading"

type RouteParams = { params: Promise<{ assessmentId: string }> }

/** `GET /api/teacher/rubrics/[assessmentId]` — one owned assessment and its rubric. */
export async function GET(_request: Request, context: RouteParams) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const { assessmentId } = await context.params

  try {
    const assessment = await getRubricForAssessment(auth.user, assessmentId)
    return NextResponse.json({ success: true, assessment })
  } catch (error) {
    return rubricErrorResponse(error)
  }
}
