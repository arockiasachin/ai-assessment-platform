import { NextResponse } from "next/server"

import { jsonError } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { publishOfferingResults } from "@/lib/retention/results-publication"

/**
 * Publish an offering's results.
 *
 * `POST /api/teacher/offerings/[offeringId]/results`
 *
 * The explicit teacher action that starts the 15-day retention clock. Guarded by
 * `requireRole("teacher")` and object-level ownership (checked in the service),
 * so a teacher can only publish results for an offering they own. Idempotent:
 * publishing twice leaves the original timestamp untouched.
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
        ? "Results were already published; the original publication date is unchanged."
        : "Results published. Student work is retained for 15 days from now.",
  })
}
