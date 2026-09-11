import { NextResponse } from "next/server"

import { jsonError } from "@/lib/api"
import { analyticsErrorResponse } from "@/lib/analytics/http"
import { getAssessmentItemAnalysisForTeacher } from "@/lib/analytics/service"
import { requireRole } from "@/lib/authz"

export const dynamic = "force-dynamic"

/**
 * `GET /api/teacher/analytics/items?assessmentId=` — per-question difficulty and
 * discrimination indices plus the score distribution and pass rate for one
 * owned assessment.
 *
 * Both indices are computed from real `QuizAttempt` / `QuizResponse` rows and
 * are reported as `null` with a reason when the sample is below the documented
 * minimum (see `lib/analytics/item-analysis.ts`). The answer key is never part
 * of this payload.
 */
export async function GET(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const assessmentId = new URL(request.url).searchParams.get("assessmentId")
  if (!assessmentId) return jsonError("assessmentId is required.", 400)

  try {
    const analysis = await getAssessmentItemAnalysisForTeacher(auth.user, { assessmentId })
    return NextResponse.json({ success: true, ...analysis })
  } catch (error) {
    return analyticsErrorResponse(error)
  }
}
