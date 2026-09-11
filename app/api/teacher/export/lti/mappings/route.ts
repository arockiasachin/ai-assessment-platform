import { NextResponse } from "next/server"

import { jsonError, parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { saveLtiMappingsRequestSchema } from "@/lib/contracts/lms-export"
import { loadOwnedOffering } from "@/lib/lms-export/authz"
import { LmsExportValidationError } from "@/lib/lms-export/errors"
import { lmsExportErrorResponse } from "@/lib/lms-export/http"
import {
  getActiveLtiRegistration,
  listLtiMappings,
  saveLtiMappingsForTeacher,
} from "@/lib/lms-export/registrations"

export const dynamic = "force-dynamic"

/**
 * `GET /api/teacher/export/lti/mappings?offeringId=&registrationId=` — the
 * student↔LTI-user mappings for one owned offering under the active (or named)
 * registration.
 *
 * `PUT` — upsert those mappings; every student must be actively enrolled.
 */
export async function GET(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const params = new URL(request.url).searchParams
  const offeringId = params.get("offeringId")
  if (!offeringId) return jsonError("offeringId is required.", 400)

  try {
    await loadOwnedOffering(auth.user, offeringId)
    const registration = params.get("registrationId")
      ? { id: params.get("registrationId") as string }
      : await getActiveLtiRegistration()
    if (!registration) {
      throw new LmsExportValidationError("No LTI registration is available.")
    }
    const mappings = await listLtiMappings(offeringId, registration.id)
    return NextResponse.json({ success: true, registrationId: registration.id, mappings })
  } catch (error) {
    return lmsExportErrorResponse(error)
  }
}

export async function PUT(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, saveLtiMappingsRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const result = await saveLtiMappingsForTeacher(auth.user, parsed.data)
    return NextResponse.json(result)
  } catch (error) {
    return lmsExportErrorResponse(error)
  }
}
