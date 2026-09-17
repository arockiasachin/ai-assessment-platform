import { NextResponse } from "next/server"

import { jsonError, parseJsonBody } from "@/lib/api"
import { setCourseCategoryForAdmin } from "@/lib/analytics/course-category"
import { AnalyticsError } from "@/lib/analytics/errors"
import { requireRole } from "@/lib/authz"
import { updateCourseCategoryRequestSchema } from "@/lib/contracts/courses"

/**
 * Set a course's grading category.
 *
 * `PATCH /api/admin/courses/[courseId]/category`
 *
 * Admin-only, deliberately. The category decides which of VIT's two grading regimes applies,
 * and it is an institutional fact recorded in the Academic Regulations rather than a
 * per-course teaching preference — so it belongs to an admin, who sets it for any course
 * without having to teach it. There is **no object-level ownership check**: an admin is
 * acting on the institution's record, not on an offering of their own.
 *
 * The service writes an audit row naming the previous and the new category, because the
 * change moves every student's letter in the course.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const auth = await requireRole("admin")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, updateCourseCategoryRequestSchema)
  if (!parsed.ok) return parsed.response

  const { courseId } = await params

  try {
    const result = await setCourseCategoryForAdmin(auth.user, courseId, parsed.data.category)
    if (result.kind === "not-found") {
      return jsonError("Course not found.", 404)
    }

    return NextResponse.json({
      success: true,
      courseId: result.courseId,
      category: result.category,
      gradingEffect: result.gradingEffect,
    })
  } catch (error) {
    if (error instanceof AnalyticsError) {
      return jsonError(error.message, error.status)
    }
    console.error("Set course category error:", error)
    return jsonError("Unable to set the course category.", 500)
  }
}
