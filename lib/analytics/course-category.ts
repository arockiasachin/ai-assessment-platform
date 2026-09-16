import "server-only"

import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

import { AnalyticsError } from "./errors"
import { isCategoricallyAbsolute, RELATIVE_GRADING_MIN_STRENGTH } from "./grading-bands"
import type { CourseCategoryValue } from "@/lib/contracts/courses"

/**
 * Set a course's grading category.
 *
 * ## Authorization
 *
 * The category lives on `Course`, but a teacher owns *offerings*, not courses — so the rule
 * is **teaches at least one offering of this course**. That is the weakest rule that is still
 * a real check: a teacher cannot set a category for a course they have no relationship with,
 * and `CourseOffering.teacherId` is non-null so there is no null case to reason about.
 *
 * A course can be taught by several teachers, so this is a shared setting one of them may
 * change. That is a deliberate trade: the alternative is an admin-only surface, and the
 * category is a fact about the course that the teacher teaching it is best placed to know.
 *
 * ## Why this is a write path and not a column only the seed fills
 *
 * Without it the category could never be set in a running system, so every course would
 * permanently fall back to absolute bands with a warning. A field that nothing can write is
 * not a feature.
 */

export type SetCourseCategoryResult =
  | { kind: "updated"; courseId: string; category: CourseCategoryValue; gradingEffect: string }
  | { kind: "not-found" }

/** A sentence describing the consequence, so a caller does not have to re-derive the rule. */
export function describeGradingEffect(category: CourseCategoryValue): string {
  if (isCategoricallyAbsolute(category)) {
    return "Absolute bands apply at any class size, as VIT grades this category absolutely."
  }
  return `Relative bands apply once more than ${RELATIVE_GRADING_MIN_STRENGTH - 1} students have published totals; until then absolute bands are shown.`
}

/**
 * Set the category, if the caller teaches an offering of the course.
 *
 * A course the caller does not teach reports `not-found` rather than `403`, so the endpoint
 * never confirms that another teacher's course exists — the same convention the assessment
 * release action uses.
 */
export async function setCourseCategoryForTeacher(
  user: AuthUser,
  courseId: string,
  category: CourseCategoryValue,
): Promise<SetCourseCategoryResult> {
  const staff = await prisma.staffProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (!staff) throw new AnalyticsError(403, "Teacher profile not found.")

  const teaches = await prisma.courseOffering.findFirst({
    where: { courseId, teacherId: staff.id },
    select: { id: true },
  })
  if (!teaches) return { kind: "not-found" }

  const updated = await prisma.course.update({
    where: { id: courseId },
    data: { category },
    select: { id: true },
  })

  return {
    kind: "updated",
    courseId: updated.id,
    category,
    gradingEffect: describeGradingEffect(category),
  }
}
