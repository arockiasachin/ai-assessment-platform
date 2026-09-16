import { NextResponse } from "next/server"

import { jsonError, parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { updateOfferingGradingRequestSchema } from "@/lib/contracts"
import {
  getOfferingGradingForTeacher,
  setOfferingGradingForTeacher,
} from "@/lib/grading/offering-config-service"

/**
 * The offering's grading policy: the CAT/FAT weights, which assessment is the final one,
 * and the minimum-CAT gate for sitting the FAT.
 *
 * `GET  /api/teacher/offerings/[offeringId]/grading` — the policy in force, plus what it
 *                                            resolves to against this offering's
 *                                            assessments, so the editor renders the
 *                                            server's answer rather than deriving its own.
 * `PUT  /api/teacher/offerings/[offeringId]/grading` — store a new policy.
 *
 * Guarded by `requireRole("teacher")` plus object-level ownership, enforced in the service by
 * scoping the query to the caller's own offerings. A non-owner sees `404`, indistinguishable
 * from an offering that does not exist.
 *
 * A `PUT` here changes how every student's final grade is computed, so the service writes an
 * `AuditLog` row with the before and after policies.
 */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ offeringId: string }> },
) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const { offeringId } = await params
  const result = await getOfferingGradingForTeacher(auth.user, offeringId)

  if (result.kind === "not-found") return jsonError("Offering not found.", 404)
  return NextResponse.json(result.payload)
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ offeringId: string }> },
) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, updateOfferingGradingRequestSchema)
  if (!parsed.ok) return parsed.response

  const { offeringId } = await params
  const result = await setOfferingGradingForTeacher(auth.user, offeringId, parsed.data)

  if (result.kind === "not-found") return jsonError("Offering not found.", 404)
  if (result.kind === "invalid-final-assessment") {
    return jsonError("The final assessment must be one of this offering's own assessments.", 400)
  }

  return NextResponse.json(result.payload)
}
