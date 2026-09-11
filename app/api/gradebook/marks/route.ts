import { NextResponse } from "next/server"

import { jsonError, parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { marksRequestSchema } from "@/lib/contracts"
import { upsertAssessmentGrade } from "@/lib/gradebook-db"

/**
 * Write a mark. Only teachers and admins may reach this handler: the student
 * self-grading path is closed. A teacher is additionally limited to assessments
 * in their own offerings by `upsertAssessmentGrade`.
 */
export async function POST(request: Request) {
  const auth = await requireRole("teacher", "admin")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, marksRequestSchema)
  if (!parsed.ok) return parsed.response

  const { studentId, assessmentId, score: scoreRaw } = parsed.data
  const score = scoreRaw === null ? null : Number(scoreRaw)
  if (score !== null && !Number.isFinite(score)) {
    return jsonError("Invalid score.", 400)
  }

  try {
    await upsertAssessmentGrade({ studentId, assessmentId, score }, auth.user)
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save mark."
    const status = message === "Forbidden" ? 403 : message === "Assessment not found" ? 404 : 400
    return jsonError(message, status)
  }
}
