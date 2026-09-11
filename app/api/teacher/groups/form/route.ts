import { NextResponse } from "next/server"

import { parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { formTeamsRequestSchema } from "@/lib/contracts/groups"
import { formTeamsForTeacher, groupsErrorResponse } from "@/lib/groups"

export const dynamic = "force-dynamic"

/**
 * `POST /api/teacher/groups/form` — form teams that maximise the worst-fitting
 * team under instructor-controlled criteria and weights, respecting schedule
 * availability as a hard constraint. With `persist: true` the result is stored
 * as groups; otherwise it is a preview.
 */
export async function POST(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, formTeamsRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const outcome = await formTeamsForTeacher(auth.user, parsed.data)
    return NextResponse.json({
      success: true,
      message: parsed.data.persist
        ? "Teams formed and saved."
        : "Teams formed (preview only; nothing was saved).",
      formation: outcome.formation,
      persistedGroupIds: outcome.persistedGroupIds,
    })
  } catch (error) {
    return groupsErrorResponse(error)
  }
}
