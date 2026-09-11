import { NextResponse } from "next/server"

import { parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { submitReviewDecision } from "@/lib/grading"
import {
  getReviewDetailForTeacher,
  reviewDecisionRequestSchema,
  rubricErrorResponse,
} from "@/lib/rubric-grading"

type RouteParams = { params: Promise<{ assessmentId: string; studentId: string }> }

/**
 * `GET /api/teacher/reviews/[assessmentId]/[studentId]` — the per-criterion
 * suggestion detail (score, rationale, evidence, confidence) for one submission.
 * Rubric internals are only ever returned to the owning teacher.
 */
export async function GET(_request: Request, context: RouteParams) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const { assessmentId, studentId } = await context.params

  try {
    const detail = await getReviewDetailForTeacher(auth.user, assessmentId, studentId)
    return NextResponse.json({ success: true, ...detail })
  } catch (error) {
    return rubricErrorResponse(error)
  }
}

/**
 * `POST /api/teacher/reviews/[assessmentId]/[studentId]` — apply a human
 * decision. Only `accept` and `override` publish; every transition is audited.
 */
export async function POST(request: Request, context: RouteParams) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const { assessmentId, studentId } = await context.params
  const parsed = await parseJsonBody(request, reviewDecisionRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const result = await submitReviewDecision({
      assessmentId,
      studentId,
      reviewer: { id: auth.user.id, role: "teacher" },
      decision: parsed.data,
    })
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    return rubricErrorResponse(error)
  }
}
