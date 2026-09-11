import { NextResponse } from "next/server"

import { requireRole } from "@/lib/authz"
import { listEvaluationCandidatesForTeacher, rubricErrorResponse } from "@/lib/rubric-grading"

/**
 * `GET /api/teacher/reviews/candidates` — submissions on rubric-bearing
 * assessments the teacher owns, so the UI can offer "evaluate with rubric".
 */
export async function GET() {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  try {
    const candidates = await listEvaluationCandidatesForTeacher(auth.user)
    return NextResponse.json({ success: true, candidates })
  } catch (error) {
    return rubricErrorResponse(error)
  }
}
