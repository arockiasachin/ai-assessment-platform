import { NextResponse } from "next/server"

import { requireRole } from "@/lib/authz"
import { listStudentAssessments } from "@/lib/student-assessments"

/**
 * `GET /api/student/assessments`
 *
 * The query lives in `lib/student-assessments.ts` so the assessments page can
 * render from it on the server. This handler stays because the page's manual
 * refresh still calls it, and because it is the documented shape for clients.
 */
export async function GET() {
  const auth = await requireRole("student")
  if (!auth.authorized) return auth.response

  const payload = await listStudentAssessments(auth.user)
  if (payload === null) {
    return NextResponse.json({ message: "Student profile not found" }, { status: 404 })
  }

  return NextResponse.json(payload)
}
