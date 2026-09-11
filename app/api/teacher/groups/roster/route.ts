import { NextResponse } from "next/server"

import { jsonError, parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { saveFormationProfilesRequestSchema } from "@/lib/contracts/groups"
import {
  groupsErrorResponse,
  listOfferingRosterForTeacher,
  saveFormationProfilesForTeacher,
} from "@/lib/groups"

export const dynamic = "force-dynamic"

/**
 * `GET /api/teacher/groups/roster?offeringId=` — active students for the
 * pickers, including their persisted formation attributes/availability.
 *
 * `PUT` — persist per-student formation attributes/availability for one owned
 * offering so the roster is configured once.
 */
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

export async function PUT(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, saveFormationProfilesRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const students = await saveFormationProfilesForTeacher(auth.user, parsed.data)
    return NextResponse.json({ success: true, students })
  } catch (error) {
    return groupsErrorResponse(error)
  }
}
