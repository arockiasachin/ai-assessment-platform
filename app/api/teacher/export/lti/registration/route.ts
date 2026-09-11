import { NextResponse } from "next/server"

import { parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { ltiRegistrationInputSchema } from "@/lib/contracts/lms-export"
import { lmsExportErrorResponse } from "@/lib/lms-export/http"
import {
  getActiveLtiRegistration,
  saveLtiRegistration,
  serializeLtiRegistration,
} from "@/lib/lms-export/registrations"

export const dynamic = "force-dynamic"

/**
 * `GET /api/teacher/export/lti/registration` — the active LTI 1.3 registration,
 * or `null`. Never returns key material: only the opaque `privateKeyRef`.
 *
 * `PUT` — upsert a registration keyed by (issuer, client, deployment). The
 * request carries a secret *reference*, never the private key itself.
 */
export async function GET() {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  try {
    const registration = await getActiveLtiRegistration()
    return NextResponse.json({
      success: true,
      registration: registration ? serializeLtiRegistration(registration) : null,
    })
  } catch (error) {
    return lmsExportErrorResponse(error)
  }
}

export async function PUT(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, ltiRegistrationInputSchema)
  if (!parsed.ok) return parsed.response

  try {
    const registration = await saveLtiRegistration(parsed.data)
    return NextResponse.json({ success: true, registration })
  } catch (error) {
    return lmsExportErrorResponse(error)
  }
}
