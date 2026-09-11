import { NextResponse } from "next/server"

import { parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { createGroupRequestSchema } from "@/lib/contracts/groups"
import { createGroupForTeacher, groupsErrorResponse, listGroupsForTeacher } from "@/lib/groups"

export const dynamic = "force-dynamic"

/**
 * `GET /api/teacher/groups` — every group on every offering the teacher owns.
 * `?offeringId=` narrows to one owned offering.
 *
 * `POST /api/teacher/groups` — create a group manually and place its members.
 */
export async function GET(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const offeringId = new URL(request.url).searchParams.get("offeringId") ?? undefined

  try {
    const groups = await listGroupsForTeacher(auth.user, offeringId)
    return NextResponse.json({ success: true, groups })
  } catch (error) {
    return groupsErrorResponse(error)
  }
}

export async function POST(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, createGroupRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const group = await createGroupForTeacher(auth.user, parsed.data)
    return NextResponse.json({ success: true, message: "Group created.", group })
  } catch (error) {
    return groupsErrorResponse(error)
  }
}
