import { NextResponse } from "next/server"

import { jsonError } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { publishOfferingResults } from "@/lib/retention/results-publication"

/**
 * Start an offering's retention clock.
 *
 * `POST /api/teacher/offerings/[offeringId]/results`
 *
 * The explicit teacher action that records the results-publication date and starts
 * the 15-day retention clock. It does **not** release marks to students: a mark
 * becomes visible when its own `Grade.publishedAt` is set from the review queue or
 * the marks grid. Guarded by `requireRole("teacher")` and object-level ownership
 * (checked in the service), so a teacher can only start the clock for an offering
 * they own. Idempotent: a repeat call leaves the original timestamp untouched.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ offeringId: string }> },
) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const { offeringId } = await params
  const result = await publishOfferingResults(auth.user, offeringId)

  if (result.kind === "staff-profile-missing") {
    return jsonError("Teacher profile not found", 404)
  }
  if (result.kind === "not-found") {
    return jsonError("Offering not found.", 404)
  }

  return NextResponse.json({
    success: true,
    offeringId: result.offeringId,
    resultsPublishedAt: result.resultsPublishedAt.toISOString(),
    retentionCutoff: result.retentionCutoff.toISOString(),
    alreadyPublished: result.kind === "already-published",
    message:
      result.kind === "already-published"
        ? "The retention clock was already started; the original results-publication date is unchanged."
        : "Results publication recorded and the 15-day retention clock started. Marks are released to students separately, from the review queue or the marks grid.",
  })
}
