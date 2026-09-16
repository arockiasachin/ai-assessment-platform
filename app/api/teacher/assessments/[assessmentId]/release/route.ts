import { NextResponse } from "next/server"

import { jsonError } from "@/lib/api"
import { releaseAssessment } from "@/lib/assessment-release"
import { requireRole } from "@/lib/authz"

/**
 * Release an assessment to its students.
 *
 * `POST /api/teacher/assessments/[assessmentId]/release`
 *
 * No request body: the only input is the id in the path, and everything else —
 * the offering, the course, the release instant — is read from the row the caller
 * is proven to own. That is why there is no Zod contract here, unlike the
 * body-bearing write endpoints.
 *
 * `requireRole` answers 401/403 before the service runs, so an unauthorized caller
 * cannot reach the database. The service then applies object-level ownership, and
 * reports a foreign assessment and a nonexistent one identically as 404.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ assessmentId: string }> },
) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const { assessmentId } = await params
  const result = await releaseAssessment(auth.user, assessmentId)

  if (result.kind === "staff-profile-missing") {
    return jsonError("Teacher profile not found", 404)
  }
  if (result.kind === "not-found") {
    return jsonError("Assessment not found.", 404)
  }

  return NextResponse.json({
    success: true,
    assessmentId: result.assessmentId,
    releasedAt: result.releasedAt.toISOString(),
    alreadyReleased: result.kind === "already-released",
    message:
      result.kind === "already-released"
        ? "This assessment was already released; the original release time is unchanged."
        : "Assessment released. Students can now see it on their calendar.",
  })
}
