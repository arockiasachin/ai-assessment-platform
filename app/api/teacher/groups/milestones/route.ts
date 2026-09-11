import { NextResponse } from "next/server"

import { jsonError, parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { createMilestoneRequestSchema } from "@/lib/contracts/groups"
import {
  createMilestoneForTeacher,
  groupsErrorResponse,
  listMilestonesForTeacher,
} from "@/lib/groups"

export const dynamic = "force-dynamic"

/**
 * `GET /api/teacher/groups/milestones?groupId=` or `?offeringId=` — milestones
 * plus the cohort progress flags that identify teams that are behind or lopsided.
 *
 * `POST /api/teacher/groups/milestones` — define a milestone for one owned group.
 */
export async function GET(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const params = new URL(request.url).searchParams
  const groupId = params.get("groupId") ?? undefined
  const offeringId = params.get("offeringId") ?? undefined
  if (!groupId && !offeringId) return jsonError("groupId or offeringId is required.", 400)

  try {
    const result = await listMilestonesForTeacher(auth.user, { groupId, offeringId })
    return NextResponse.json({
      success: true,
      milestones: result.milestones,
      cohortProgress: result.cohortProgress.map((entry) => ({
        groupId: entry.groupId,
        behind: entry.behind,
        lopsided: entry.lopsided,
        weightedCompletion: entry.progress.weightedCompletion,
      })),
    })
  } catch (error) {
    return groupsErrorResponse(error)
  }
}

export async function POST(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, createMilestoneRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const milestone = await createMilestoneForTeacher(auth.user, parsed.data)
    return NextResponse.json({ success: true, message: "Milestone created.", milestone })
  } catch (error) {
    return groupsErrorResponse(error)
  }
}
