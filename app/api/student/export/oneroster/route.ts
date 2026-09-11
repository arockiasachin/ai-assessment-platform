import { NextResponse } from "next/server"

import { jsonError } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { firstIssueMessage } from "@/lib/contracts/common"
import { studentOneRosterExportQuerySchema } from "@/lib/contracts/lms-export"
import { lmsExportErrorResponse } from "@/lib/lms-export/http"
import { getStudentOneRosterCsv } from "@/lib/lms-export/service"

export const dynamic = "force-dynamic"

/**
 * `GET /api/student/export/oneroster?offeringId=&file=` — the signed-in
 * student's own OneRoster rows as a downloadable CSV. Only their own results are
 * emitted; line items and score scales are offering metadata.
 */
export async function GET(request: Request) {
  const auth = await requireRole("student")
  if (!auth.authorized) return auth.response

  const parsed = studentOneRosterExportQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  )
  if (!parsed.success) return jsonError(firstIssueMessage(parsed.error), 400)

  try {
    const download = await getStudentOneRosterCsv(auth.user, {
      offeringId: parsed.data.offeringId,
      file: parsed.data.file,
    })
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
  } catch (error) {
    return lmsExportErrorResponse(error)
  }
}
