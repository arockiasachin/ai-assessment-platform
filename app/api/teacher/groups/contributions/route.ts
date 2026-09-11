import { NextResponse } from "next/server"

import { jsonError, parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { recordContributionsRequestSchema } from "@/lib/contracts/groups"
import {
  getContributionEvidenceForTeacher,
  groupsErrorResponse,
  recordContributionEventsForTeacher,
} from "@/lib/groups"

export const dynamic = "force-dynamic"

/**
 * `GET /api/teacher/groups/contributions?groupId=` — contribution events as
 * evidence (never as a grade; the payload states `gradeBasis: false`).
 *
 * `POST /api/teacher/groups/contributions` — record contribution signals such as
 * commits or pull requests for one owned group.
 */
export async function GET(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const groupId = new URL(request.url).searchParams.get("groupId")
  if (!groupId) return jsonError("groupId is required.", 400)

  try {
    const evidence = await getContributionEvidenceForTeacher(auth.user, groupId)
    return NextResponse.json({ success: true, evidence })
  } catch (error) {
    return groupsErrorResponse(error)
  }
}

export async function POST(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, recordContributionsRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const outcome = await recordContributionEventsForTeacher(auth.user, parsed.data)
    return NextResponse.json({
      success: true,
      message: "Contribution events recorded as secondary evidence.",
      recorded: outcome.recorded,
      evidence: outcome.evidence,
    })
  } catch (error) {
    return groupsErrorResponse(error)
  }
}
