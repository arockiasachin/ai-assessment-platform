import { NextResponse } from "next/server"

import { jsonError } from "@/lib/api"
import { analyticsErrorResponse } from "@/lib/analytics/http"
import { getTeacherAnalyticsOverview } from "@/lib/analytics/service"
import { requireRole } from "@/lib/authz"
import { interventionThresholdOverridesSchema } from "@/lib/contracts/analytics"
import { firstIssueMessage } from "@/lib/contracts/common"

export const dynamic = "force-dynamic"

/**
 * `GET /api/teacher/analytics?offeringId=` — the intervention dashboard for one
 * owned offering: per-assessment cohort average and pass rate plus the
 * intervention alerts (class average below threshold, contribution imbalance,
 * pending review queue).
 *
 * Thresholds are overridable per request via query params; the frozen schema
 * has no offering-level settings column, so the defaults documented in
 * `lib/analytics/alerts.ts` apply when no override is supplied.
 */
export async function GET(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const params = new URL(request.url).searchParams
  const offeringId = params.get("offeringId")
  if (!offeringId) return jsonError("offeringId is required.", 400)

  const parsed = interventionThresholdOverridesSchema.safeParse(Object.fromEntries(params))
  if (!parsed.success) return jsonError(firstIssueMessage(parsed.error), 400)

  try {
    const overview = await getTeacherAnalyticsOverview(auth.user, {
      offeringId,
      thresholds: parsed.data,
    })
    return NextResponse.json({ success: true, ...overview })
  } catch (error) {
    return analyticsErrorResponse(error)
  }
}
