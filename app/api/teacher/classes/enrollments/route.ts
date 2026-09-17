import { NextResponse } from "next/server"
import { z } from "zod"

import { jsonError, parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import {
  addStudentToOffering,
  moveStudentBetweenOfferings,
  removeStudentFromOffering,
  RosterError,
} from "@/lib/teacher-roster"

export const dynamic = "force-dynamic"

const pairSchema = z.object({
  offeringId: z.string().trim().min(1),
  studentId: z.string().trim().min(1),
})

const moveSchema = z.object({
  studentId: z.string().trim().min(1),
  fromOfferingId: z.string().trim().min(1),
  toOfferingId: z.string().trim().min(1),
})

function mutationError(error: unknown) {
  if (error instanceof RosterError) return jsonError(error.message, error.status)
  console.error("Roster enrollment error:", error)
  return jsonError("Unable to update the enrolment.", 500)
}

/**
 * Teacher enrolment write path (TN-9).
 *
 * `POST` adds or re-activates a student in one owned offering, `DELETE` removes them from
 * one, and `PATCH` moves them between two. Every mutation is ownership-scoped and writes an
 * `AuditLog` row: adding or removing a student from a cohort is consequential and must be
 * attributable. There is no bulk operation, for the same reason the retake queue has none —
 * a batch invites deciding without reading.
 */
export async function POST(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, pairSchema)
  if (!parsed.ok) return parsed.response

  try {
    const enrollment = await addStudentToOffering(auth.user, parsed.data)
    return NextResponse.json({ success: true, enrollment })
  } catch (error) {
    return mutationError(error)
  }
}

export async function DELETE(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, pairSchema)
  if (!parsed.ok) return parsed.response

  try {
    const enrollment = await removeStudentFromOffering(auth.user, parsed.data)
    return NextResponse.json({ success: true, enrollment })
  } catch (error) {
    return mutationError(error)
  }
}

export async function PATCH(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, moveSchema)
  if (!parsed.ok) return parsed.response

  try {
    const enrollment = await moveStudentBetweenOfferings(auth.user, parsed.data)
    return NextResponse.json({ success: true, enrollment })
  } catch (error) {
    return mutationError(error)
  }
}
