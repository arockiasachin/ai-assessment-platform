import { NextResponse } from "next/server"

import { jsonError } from "@/lib/api"
import { analyticsErrorResponse } from "@/lib/analytics/http"
import { getAdaptiveRetakeForStudent } from "@/lib/analytics/service"
import { requireRole } from "@/lib/authz"
import { adaptiveRetakeQuerySchema } from "@/lib/contracts/analytics"
import { firstIssueMessage } from "@/lib/contracts/common"

export const dynamic = "force-dynamic"

/**
 * `GET /api/student/analytics/retake?assessmentId=&includeUnanswered=` — a
 * targeted retake containing only the questions the signed-in student failed on
 * their latest finalized attempt (unanswered questions are included unless
 * `includeUnanswered=false`).
 *
 * Scoping is enforced from the signed session plus an active-enrollment check.
 * The question payload is the existing student-facing serializer, so no answer
 * key is ever returned.
 */
export async function GET(request: Request) {
  const auth = await requireRole("student")
  if (!auth.authorized) return auth.response

  const parsed = adaptiveRetakeQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  )
  if (!parsed.success) return jsonError(firstIssueMessage(parsed.error), 400)

  try {
    const retake = await getAdaptiveRetakeForStudent(auth.user, {
      assessmentId: parsed.data.assessmentId,
      includeUnanswered: parsed.data.includeUnanswered,
    })
    return NextResponse.json({ success: true, ...retake })
  } catch (error) {
    return analyticsErrorResponse(error)
  }
}
