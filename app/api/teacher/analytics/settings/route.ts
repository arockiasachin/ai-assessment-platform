import { NextResponse } from "next/server"

import { jsonError, parseJsonBody } from "@/lib/api"
import { analyticsErrorResponse } from "@/lib/analytics/http"
import {
  getAnalyticsSettingsForTeacher,
  updateAnalyticsSettingsForTeacher,
} from "@/lib/analytics/service"
import { requireRole } from "@/lib/authz"
import { updateAnalyticsSettingsRequestSchema } from "@/lib/contracts/analytics"

export const dynamic = "force-dynamic"

/**
 * `GET /api/teacher/analytics/settings?offeringId=` — the persisted analytics
 * thresholds for one owned offering plus the effective thresholds after code
 * defaults are applied.
 *
 * `PUT` — upsert those thresholds; omitted keys keep the code default, and an
 * omitted section preserves the stored one.
 */
export async function GET(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const offeringId = new URL(request.url).searchParams.get("offeringId")
  if (!offeringId) return jsonError("offeringId is required.", 400)

  try {
    const settings = await getAnalyticsSettingsForTeacher(auth.user, offeringId)
    return NextResponse.json(settings)
  } catch (error) {
    return analyticsErrorResponse(error)
  }
}

export async function PUT(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, updateAnalyticsSettingsRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const settings = await updateAnalyticsSettingsForTeacher(auth.user, parsed.data)
    return NextResponse.json(settings)
  } catch (error) {
    return analyticsErrorResponse(error)
  }
}
