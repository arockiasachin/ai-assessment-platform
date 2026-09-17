import { NextResponse } from "next/server"

import { jsonError } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { firstIssueMessage } from "@/lib/contracts/common"
import { gradeActivityQuerySchema } from "@/lib/contracts/observability"
import { getRecentGradeActivityForTeacher } from "@/lib/observability/audit-view"
import { ObservabilityError } from "@/lib/observability/errors"
import { withApiRoute } from "@/lib/observability/http"

/**
 * `GET /api/teacher/observability/grade-activity?offeringId=&limit=&offset=` — recent
 * grade-pipeline `AuditLog` activity for one offering the teacher owns. `offset`
 * pages the log; the response's `total` is the whole matching set so a page never
 * reads as the total.
 *
 * Read-only and teacher-scoped: `requireRole("teacher")` is the role gate and
 * the service verifies offering ownership before it reads any audit row, so a
 * teacher can never see another teacher's pipeline. The response carries the
 * audit metadata (action, actor role, points) but no student work, rationales,
 * or evidence text.
 */

export const dynamic = "force-dynamic"

async function getGradeActivity(request: Request): Promise<Response> {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const params = Object.fromEntries(new URL(request.url).searchParams)
  const parsed = gradeActivityQuerySchema.safeParse(params)
  if (!parsed.success) return jsonError(firstIssueMessage(parsed.error), 400)

  try {
    const activity = await getRecentGradeActivityForTeacher(auth.user, parsed.data)
    return NextResponse.json({ success: true, ...activity })
  } catch (error) {
    if (error instanceof ObservabilityError) return jsonError(error.message, error.status)
    return jsonError("Unable to load grade activity.", 500)
  }
}

export const GET = withApiRoute(getGradeActivity, {
  route: "/api/teacher/observability/grade-activity",
})
