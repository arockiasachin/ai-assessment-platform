import { NextResponse } from "next/server"

import { rejectQueryParam } from "@/lib/api"
import { gradeReviewStatusSchema } from "@/lib/contracts/grading"
import { requireRole } from "@/lib/authz"
import { listReviewQueueForTeacher, rubricErrorResponse } from "@/lib/rubric-grading"

/**
 * `GET /api/teacher/reviews` — submissions awaiting human review for the
 * teacher's own assessments, with the latest per-criterion AI suggestion.
 *
 * Query: `status=PENDING|NEEDS_REVIEW|...|all` (default: PENDING + NEEDS_REVIEW),
 * `assessmentId=<id>`.
 *
 * `offeringId` is **rejected**, not ignored: this list spans every owned assessment,
 * and a parameter that sometimes scopes and sometimes does not is the inconsistency
 * TN-27 filed.
 */
export async function GET(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const unsupported = rejectQueryParam(
    request,
    "offeringId",
    "This queue covers all of your assessments and does not accept an offeringId.",
  )
  if (unsupported) return unsupported

  const url = new URL(request.url)
  const rawStatus = url.searchParams.get("status")
  const parsedStatus =
    rawStatus && rawStatus !== "all" ? gradeReviewStatusSchema.safeParse(rawStatus) : null
  const status = rawStatus === "all" ? "all" : parsedStatus?.success ? parsedStatus.data : undefined
  const assessmentId = url.searchParams.get("assessmentId")?.trim() || undefined

  try {
    const items = await listReviewQueueForTeacher(auth.user, { status, assessmentId })
    return NextResponse.json({ success: true, items })
  } catch (error) {
    return rubricErrorResponse(error)
  }
}
