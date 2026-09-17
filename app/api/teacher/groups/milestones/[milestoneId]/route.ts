import { NextResponse } from "next/server"

import { parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { updateMilestoneRequestSchema } from "@/lib/contracts/groups"
import {
  deleteMilestoneForTeacher,
  groupsErrorResponse,
  updateMilestoneForTeacher,
} from "@/lib/groups"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ milestoneId: string }> }

/**
 * `PATCH /api/teacher/groups/milestones/[milestoneId]` — update or complete a
 * milestone. Marking it `COMPLETED` timestamps completion server-side; moving it
 * out of `COMPLETED` clears the timestamp.
 *
 * `DELETE` — remove it. The UI had no delete affordance, so a milestone added by
 * mistake could never be removed (TN-49).
 */
export async function PATCH(request: Request, context: RouteParams) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const { milestoneId } = await context.params
  const parsed = await parseJsonBody(request, updateMilestoneRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const milestone = await updateMilestoneForTeacher(auth.user, milestoneId, parsed.data)
    return NextResponse.json({ success: true, message: "Milestone updated.", milestone })
  } catch (error) {
    return groupsErrorResponse(error)
  }
}

export async function DELETE(_request: Request, context: RouteParams) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const { milestoneId } = await context.params
  try {
    await deleteMilestoneForTeacher(auth.user, milestoneId)
    return NextResponse.json({ success: true, message: "Milestone deleted." })
  } catch (error) {
    return groupsErrorResponse(error)
  }
}
