import { NextResponse } from "next/server"

import { jsonError } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { firstIssueMessage } from "@/lib/contracts/common"
import {
  finalGradeExportQuerySchema,
  finalGradeExportRequestSchema,
} from "@/lib/contracts/lms-export"
import { lmsExportErrorResponse } from "@/lib/lms-export/http"
import { getTeacherGradeExport } from "@/lib/lms-export/service"

export const dynamic = "force-dynamic"

/**
 * `GET /api/teacher/export?offeringId=` — weighted final grades for one owned
 * offering, computed from **published** grades only, plus the LTI configuration
 * status. `POST` accepts an explicit category-weight configuration.
 *
 * A teacher may only export an offering they teach; a second teacher gets 403
 * from `getTeacherGradeExport` (object-level ownership).
 */
export async function GET(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const parsed = finalGradeExportQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  )
  if (!parsed.success) return jsonError(firstIssueMessage(parsed.error), 400)

  try {
    const result = await getTeacherGradeExport(auth.user, { offeringId: parsed.data.offeringId })
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    return lmsExportErrorResponse(error)
  }
}

export async function POST(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return jsonError("Invalid JSON body.", 400)
  }

  const parsed = finalGradeExportRequestSchema.safeParse(raw)
  if (!parsed.success) return jsonError(firstIssueMessage(parsed.error), 400)

  try {
    const result = await getTeacherGradeExport(auth.user, {
      offeringId: parsed.data.offeringId,
      config: parsed.data.config,
    })
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    return lmsExportErrorResponse(error)
  }
}
