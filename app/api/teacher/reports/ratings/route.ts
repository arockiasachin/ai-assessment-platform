import { NextResponse } from "next/server"

import { isDatabaseError, jsonError, rejectQueryParam } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { getTeacherRatingsReport } from "@/lib/course-ratings"

/**
 * `GET /api/teacher/reports/ratings` — the ratings report for every offering
 * the signed-in teacher owns. Ownership is enforced in
 * `getTeacherRatingsReport`; a teacher can never read another teacher's
 * offerings. Offerings without ratings are included with a `null` average.
 */
export async function GET(request?: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  // This report covers every offering the teacher owns; an `offeringId` here would
  // be silently ignored, which is the inconsistency this rejects (TN-27).
  const unsupported = rejectQueryParam(
    request,
    "offeringId",
    "This report covers all of your offerings and does not accept an offeringId.",
  )
  if (unsupported) return unsupported

  try {
    const offerings = await getTeacherRatingsReport(auth.user)
    if (offerings === null) {
      return jsonError("Teacher profile not found", 404)
    }
    return NextResponse.json({ offerings })
  } catch (error) {
    if (isDatabaseError(error)) console.error("Teacher ratings report database error:", error)
    else console.error("Teacher ratings report error:", error)
    return jsonError("Unable to load ratings report.", 500)
  }
}
