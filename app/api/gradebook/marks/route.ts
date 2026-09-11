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
    const message = error instanceof Error ? error.message : ""
    if (message === "Forbidden") return jsonError(message, 403)
    if (message === "Assessment not found") return jsonError(message, 404)
    if (
      message === "Student not enrolled in assessment offering" ||
      message.startsWith("Score must be between")
    ) {
      return jsonError(message, 400)
    }
    console.error("Save mark error:", error)
    return jsonError("Unable to save mark.", 500)
  }
}
