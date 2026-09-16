import { NextResponse } from "next/server"

import { jsonError, parseJsonBody } from "@/lib/api"
import { setCourseCategoryForTeacher } from "@/lib/analytics/course-category"
import { requireRole } from "@/lib/authz"
import { updateCourseCategoryRequestSchema } from "@/lib/contracts/courses"

/**
 * Set a course's grading category.
 *
 * `PATCH /api/teacher/courses/[courseId]/category`
 *
 * The category decides which of VIT's two grading regimes applies, so this is the action
 * that lets a course stop falling back to absolute bands. Guarded by `requireRole("teacher")`
 * plus object-level ownership in the service: the caller must teach an offering of the
 * course. A course they do not teach reports 404, so the endpoint never confirms another
 * teacher's course exists.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, updateCourseCategoryRequestSchema)
  if (!parsed.ok) return parsed.response

  const { courseId } = await params

  try {
    const result = await setCourseCategoryForTeacher(auth.user, courseId, parsed.data.category)
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
    if (error instanceof Error && error.message === "Teacher profile not found.") {
      return jsonError(error.message, 403)
    }
    console.error("Set course category error:", error)
    return jsonError("Unable to set the course category.", 500)
  }
}
