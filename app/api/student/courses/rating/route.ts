import { NextResponse } from "next/server"

import { isDatabaseError, jsonError, parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { courseRatingRequestSchema } from "@/lib/contracts"
import { submitCourseRating } from "@/lib/course-ratings"

/**
 * `POST /api/student/courses/rating` — rate (or re-rate) a completed course the
 * signed-in student is enrolled in. Authorization and the enrollment/completion
 * rules live in `submitCourseRating`; this handler only maps the outcome.
 */
export async function POST(request: Request) {
  const auth = await requireRole("student")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, courseRatingRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const result = await submitCourseRating(auth.user, parsed.data)

    switch (result.kind) {
      case "student-profile-missing":
        return jsonError("Student profile not found", 404)
      case "not-enrolled":
        return jsonError("You must be enrolled to rate this course.", 403)
      case "not-completed":
        return jsonError("You can rate this course only after completion.", 409)
      case "rated":
        return NextResponse.json({
          success: true,
          message: `Saved rating for ${result.courseName}.`,
        })
    }
  } catch (error) {
    if (isDatabaseError(error)) console.error("Course rating database error:", error)
    else console.error("Course rating error:", error)
    return jsonError("Unable to save rating.", 500)
  }
}
