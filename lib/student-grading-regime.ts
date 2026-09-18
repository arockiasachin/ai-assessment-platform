import "server-only"

import { resolveRegimeForCourse } from "@/lib/analytics/grading-bands"
import { gatherRegimeInputs } from "@/lib/analytics/grading-regime"
import { liveEnrollmentStatuses } from "@/lib/enrollment-scope"
import { studentRegimeNote, type StudentCourseRegime } from "@/lib/grading/regime-view"
import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

export type { StudentCourseRegime } from "@/lib/grading/regime-view"

/**
 * The grading regime of each course a student is enrolled in, resolved from real data.
 *
 * ## Why this exists
 *
 * The regime was computed and shown only to teachers (`components/teacher-analytics-dashboard.tsx`),
 * so a student graded on relative σ bands and a student graded on VIT's absolute table saw
 * structurally identical pages (SN-16). This is the student-facing read of the same decision.
 *
 * ## It reuses the resolver rather than re-deriving it
 *
 * The rule is `resolveRegimeForCourse`, and the inputs it needs come from
 * `gatherRegimeInputs` — the *same* pair the teacher's analytics overview calls. Importing
 * them here is deliberate: a second query that re-decided "what counts as a published total"
 * could disagree with the teacher's page about which regime a course is graded under, which
 * is the exact divergence this area has already produced twice.
 *
 * The cost is `gatherRegimeInputs`' three queries per offering. They are issued in parallel
 * and a student has a handful of courses, so the page pays one extra round trip of fan-out,
 * not one per course.
 *
 * ## Scope
 *
 * The offering ids come only from the caller's own live enrollments, read from the signed
 * session. There is no id parameter, so there is nothing a caller can point at another
 * student's cohort. A user with no student profile gets an empty list rather than an error —
 * the page that calls this has already redirected a non-student.
 */
export async function listStudentCourseRegimes(user: AuthUser): Promise<StudentCourseRegime[]> {
  const student = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (!student) return []

  const enrollments = await prisma.enrollment.findMany({
    where: { studentId: student.id, status: { in: liveEnrollmentStatuses() } },
    select: {
      offering: {
        select: {
          id: true,
          courseId: true,
          course: { select: { code: true, name: true } },
        },
      },
    },
  })

  return Promise.all(
    enrollments.map(async ({ offering }) => {
      const inputs = await gatherRegimeInputs(offering.id)
      const decision = resolveRegimeForCourse(inputs)
      return {
        offeringId: offering.id,
        courseId: offering.courseId,
        courseCode: offering.course.code,
        courseName: offering.course.name,
        note: studentRegimeNote(decision),
      }
    }),
  )
}
