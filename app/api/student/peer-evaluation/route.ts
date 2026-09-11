import { NextResponse } from "next/server"

import { parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { peerEvaluationSubmitRequestSchema } from "@/lib/contracts/groups"
import {
  getPeerEvaluationWorkspaceForStudent,
  groupsErrorResponse,
  submitPeerEvaluationsForStudent,
} from "@/lib/groups"

export const dynamic = "force-dynamic"

/**
 * `GET /api/student/peer-evaluation` — the signed-in student's own groups: whom
 * they must evaluate, their own draft/submitted evaluations, and (only once
 * enough teammates have submitted) an ANONYMOUS aggregate of how they were
 * rated. There is no evaluator identity and no received free-text comment.
 *
 * `POST /api/student/peer-evaluation` — save drafts or submit evaluations for one
 * of the student's own groups. Every teammate and the student themselves must be
 * rated on all five dimensions.
 */
export async function GET() {
  const auth = await requireRole("student")
  if (!auth.authorized) return auth.response

  try {
    const groups = await getPeerEvaluationWorkspaceForStudent(auth.user)
    return NextResponse.json({ success: true, groups })
  } catch (error) {
    return groupsErrorResponse(error)
  }
}

export async function POST(request: Request) {
  const auth = await requireRole("student")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, peerEvaluationSubmitRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const outcome = await submitPeerEvaluationsForStudent(auth.user, parsed.data)
    return NextResponse.json(outcome)
  } catch (error) {
    return groupsErrorResponse(error)
  }
}
