import { NextResponse } from "next/server"

import { parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { updateGroupRequestSchema } from "@/lib/contracts/groups"
import { getGroupDetailForTeacher, groupsErrorResponse, updateGroupForTeacher } from "@/lib/groups"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ groupId: string }> }

/**
 * `GET /api/teacher/groups/[groupId]` — one owned group with its members and
 * milestones.
 *
 * `PATCH /api/teacher/groups/[groupId]` — rename, retitle, change status, or
 * re-roster (add/remove members). Removed members are soft-removed so their
 * historical evaluations survive.
 */
export async function GET(_request: Request, context: RouteParams) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const { groupId } = await context.params
  try {
    const detail = await getGroupDetailForTeacher(auth.user, groupId)
    return NextResponse.json({ success: true, ...detail })
  } catch (error) {
    return groupsErrorResponse(error)
  }
}

export async function PATCH(request: Request, context: RouteParams) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const { groupId } = await context.params
  const parsed = await parseJsonBody(request, updateGroupRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const group = await updateGroupForTeacher(auth.user, groupId, parsed.data)
    return NextResponse.json({ success: true, message: "Group updated.", group })
  } catch (error) {
    return groupsErrorResponse(error)
  }
}
