import { NextResponse } from "next/server"

import { jsonError } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { listRetakeQueueForTeacher, TeacherRetakeQueueError } from "@/lib/teacher-retake-requests"

export const dynamic = "force-dynamic"

/**
 * `GET /api/teacher/retake-requests` — every retake request across the caller's assessments,
 * pending first. The per-assessment `GET`/`POST` under
 * `/api/teacher/assessments/[assessmentId]/retake-requests` remain the read/write pair for one
 * assessment; this is the cross-assessment queue the page opens with.
 */
export async function GET() {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  try {
    const requests = await listRetakeQueueForTeacher(auth.user)
    return NextResponse.json({ success: true, requests })
  } catch (error) {
    if (error instanceof TeacherRetakeQueueError) return jsonError(error.message, error.status)
    console.error("List retake requests error:", error)
    return jsonError("Unable to load retake requests.", 500)
  }
}
