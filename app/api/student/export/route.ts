import { NextResponse } from "next/server"

import { jsonError } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { firstIssueMessage } from "@/lib/contracts/common"
import { finalGradeExportQuerySchema } from "@/lib/contracts/lms-export"
import { lmsExportErrorResponse } from "@/lib/lms-export/http"
import { getStudentGradeExport } from "@/lib/lms-export/service"

export const dynamic = "force-dynamic"

/**
 * `GET /api/student/export?offeringId=` — the signed-in student's own weighted
 * final grade for one offering they are actively enrolled in.
 *
 * Scoping is enforced from the signed session: the student id is never read
 * from the request, and a non-enrolled student gets 403.
 */
export async function GET(request: Request) {
  const auth = await requireRole("student")
  if (!auth.authorized) return auth.response

  const parsed = finalGradeExportQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  )
  if (!parsed.success) return jsonError(firstIssueMessage(parsed.error), 400)

  try {
    const result = await getStudentGradeExport(auth.user, { offeringId: parsed.data.offeringId })
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    return lmsExportErrorResponse(error)
  }
}
