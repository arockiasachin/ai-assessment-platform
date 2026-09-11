import { NextResponse } from "next/server"

import { jsonError } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { groupsErrorResponse, listOfferingRosterForTeacher } from "@/lib/groups"

export const dynamic = "force-dynamic"

/** `GET /api/teacher/groups/roster?offeringId=` — active students for the pickers. */
export async function GET(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const offeringId = new URL(request.url).searchParams.get("offeringId")
  if (!offeringId) return jsonError("offeringId is required.", 400)

  try {
    const students = await listOfferingRosterForTeacher(auth.user, offeringId)
    return NextResponse.json({ success: true, students })
  } catch (error) {
    return groupsErrorResponse(error)
  }
}
