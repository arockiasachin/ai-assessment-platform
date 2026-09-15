import { NextResponse } from "next/server"

import { requireRole } from "@/lib/authz"
import { listStudentCourses } from "@/lib/student-courses"

/**
 * `GET /api/student/courses` — the student's course catalog.
 *
 * The query lives in `lib/student-courses.ts` so the ported Server Component can
 * call it directly; this handler is now only the HTTP wrapper around it.
 */
export async function GET() {
  const auth = await requireRole("student")
  if (!auth.authorized) return auth.response

  const payload = await listStudentCourses(auth.user)
  if (payload === null) {
    return NextResponse.json({ message: "Student profile not found" }, { status: 404 })
  }

  return NextResponse.json(payload)
}
