import { NextResponse } from "next/server"

import { jsonError } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { firstIssueMessage } from "@/lib/contracts/common"
import { agsDryRunRequestSchema } from "@/lib/contracts/lms-export"
import { lmsExportErrorResponse } from "@/lib/lms-export/http"
import { dryRunAgsPublishForTeacher } from "@/lib/lms-export/service"

export const dynamic = "force-dynamic"

/**
 * `POST /api/teacher/export/lti` — build the LTI 1.3 AGS line items and score
 * payloads for one owned offering and hand them to the in-memory dry-run client.
 *
 * This route makes **no network calls**: the default client is the dry run, and
 * only grades with `publishedAt` set produce a score. If the registration env is
 * incomplete the request fails with a 422 naming the missing variables.
 */
export async function POST(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return jsonError("Invalid JSON body.", 400)
  }

  const parsed = agsDryRunRequestSchema.safeParse(raw)
  if (!parsed.success) return jsonError(firstIssueMessage(parsed.error), 400)

  try {
    const result = await dryRunAgsPublishForTeacher(auth.user, {
      offeringId: parsed.data.offeringId,
      config: parsed.data.config,
      ltiUserIds: parsed.data.ltiUserIds,
    })
    return NextResponse.json(result)
  } catch (error) {
    return lmsExportErrorResponse(error)
  }
}
