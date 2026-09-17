import { NextResponse } from "next/server"

import { jsonError } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { firstIssueMessage } from "@/lib/contracts/common"
import {
  oneRosterExportQuerySchema,
  oneRosterExportRequestSchema,
} from "@/lib/contracts/lms-export"
import { lmsExportErrorResponse } from "@/lib/lms-export/http"
import { dropEmptyFinalGradeConfig } from "@/lib/lms-export/request"
import { getTeacherOneRosterCsv } from "@/lib/lms-export/service"

export const dynamic = "force-dynamic"

function csvResponse(download: {
  filename: string
  contentType: string
  csv: string
  rowCount: number
  generatedAt: string
}): NextResponse {
  return new NextResponse(download.csv, {
    status: 200,
    headers: {
      "Content-Type": download.contentType,
      "Content-Disposition": `attachment; filename="${download.filename}"`,
      "Cache-Control": "no-store",
      "X-OneRoster-Rows": String(download.rowCount),
      "X-Generated-At": download.generatedAt,
    },
  })
}

/**
 * `GET /api/teacher/export/oneroster?offeringId=&file=` — a downloadable
 * OneRoster 1.2-shaped CSV (`lineItems`, `results`, or `scoreScales`). `POST`
 * accepts an explicit weight configuration so the emitted final-grade line item
 * matches the teacher's weighting.
 */
export async function GET(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const parsed = oneRosterExportQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  )
  if (!parsed.success) return jsonError(firstIssueMessage(parsed.error), 400)

  try {
    const download = await getTeacherOneRosterCsv(auth.user, {
      offeringId: parsed.data.offeringId,
      file: parsed.data.file,
    })
    return csvResponse(download)
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

  // TN-54: an offering with no assessments round-trips `{ categories: [] }`,
  // which means "no configuration", not an invalid one.
  const parsed = oneRosterExportRequestSchema.safeParse(dropEmptyFinalGradeConfig(raw))
  if (!parsed.success) return jsonError(firstIssueMessage(parsed.error), 400)

  try {
    const download = await getTeacherOneRosterCsv(auth.user, {
      offeringId: parsed.data.offeringId,
      file: parsed.data.file,
      config: parsed.data.config,
    })
    return csvResponse(download)
  } catch (error) {
    return lmsExportErrorResponse(error)
  }
}
