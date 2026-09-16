import { NextResponse } from "next/server"

import { jsonError, parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { getMyRetakeRequest, quizAttemptErrorResponse, requestRetake } from "@/lib/quiz-attempts"
import { z } from "zod"

export const dynamic = "force-dynamic"

const bodySchema = z.object({
  assessmentId: z.string().trim().min(1),
  note: z.string().trim().max(500).nullable().optional(),
})

/**
 * `POST /api/student/retake-request` — ask a teacher for another graded sitting.
 *
 * Only meaningful on an assessment whose policy is `APPROVAL`; the service refuses otherwise
 * rather than creating a queue of requests nobody may grant.
 *
 * `GET ?assessmentId=` returns the student's own request, so a page can show "awaiting your
 * teacher's approval" instead of offering a button that would only ask again.
 */
export async function GET(request: Request) {
  const auth = await requireRole("student")
  if (!auth.authorized) return auth.response

  const assessmentId = new URL(request.url).searchParams.get("assessmentId")
  if (!assessmentId) return jsonError("assessmentId is required.", 400)

  try {
    const request_ = await getMyRetakeRequest(auth.user, assessmentId)
    return NextResponse.json({ success: true, request: request_ })
  } catch (error) {
    return quizAttemptErrorResponse(error)
  }
}

export async function POST(request: Request) {
  const auth = await requireRole("student")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, bodySchema)
  if (!parsed.ok) return parsed.response

  try {
    const created = await requestRetake(auth.user, parsed.data.assessmentId, {
      note: parsed.data.note ?? null,
    })
    return NextResponse.json({ success: true, request: created })
  } catch (error) {
    return quizAttemptErrorResponse(error)
  }
}
