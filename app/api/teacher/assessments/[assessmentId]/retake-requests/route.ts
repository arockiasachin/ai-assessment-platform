import { NextResponse } from "next/server"

import { jsonError, parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import {
  decideRetakeRequest,
  listRetakeRequestsForTeacher,
  quizAttemptErrorResponse,
} from "@/lib/quiz-attempts"
import { z } from "zod"

export const dynamic = "force-dynamic"

const decisionSchema = z.object({
  studentId: z.string().trim().min(1),
  approve: z.boolean(),
  note: z.string().trim().max(500).nullable().optional(),
})

/**
 * `GET /api/teacher/assessments/[assessmentId]/retake-requests` — the queue for one assessment.
 *
 * `POST` — approve or reject one request. A decision is a teacher action on a student's record,
 * so it is ownership-scoped and writes an `AuditLog` row.
 *
 * There is no bulk decision: granting a student another graded sitting is a judgement about that
 * student, and an endpoint that grants them in a batch invites deciding without reading.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assessmentId: string }> },
) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const { assessmentId } = await params
  try {
    const requests = await listRetakeRequestsForTeacher(auth.user, assessmentId)
    return NextResponse.json({ success: true, requests })
  } catch (error) {
    return quizAttemptErrorResponse(error)
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ assessmentId: string }> },
) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, decisionSchema)
  if (!parsed.ok) return parsed.response

  const { assessmentId } = await params
  try {
    const decided = await decideRetakeRequest(auth.user, assessmentId, parsed.data.studentId, {
      approve: parsed.data.approve,
      note: parsed.data.note ?? null,
    })
    return NextResponse.json({ success: true, request: decided })
  } catch (error) {
    return quizAttemptErrorResponse(error)
  }
}
