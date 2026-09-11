import "server-only"

import type { CourseOfferingRatingsReport } from "@/lib/contracts/gradebook"
import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

/**
 * Course-rating data layer.
 *
 * Both operations take the signed-in `AuthUser` and resolve ownership
 * server-side: a student can only rate an offering they are actively enrolled
 * in and that has already ended, and a teacher only ever reads ratings for
 * offerings they teach. Route handlers stay thin and translate the outcome
 * below into a status code.
 */

export type SubmitCourseRatingInput = {
  offeringId: string
  rating: number
  comment?: string
}

export type SubmitCourseRatingResult =
  | { kind: "rated"; courseName: string }
  | { kind: "student-profile-missing" }
  | { kind: "not-enrolled" }
  | { kind: "not-completed" }

/**
 * Create or update a student's rating for one of their courses.
 *
 * The `@@unique([offeringId, studentId])` constraint makes this an upsert: a
 * student who rates twice updates their existing row instead of creating a
 * duplicate. A rating is only accepted once the offering has ended, matching
 * the original feature's rule that a course can be rated after completion.
 */
export async function submitCourseRating(
  actor: AuthUser,
  input: SubmitCourseRatingInput,
): Promise<SubmitCourseRatingResult> {
  const student = await prisma.studentProfile.findUnique({
    where: { userId: actor.id },
    select: { id: true },
  })
  if (!student) return { kind: "student-profile-missing" }

  const enrollment = await prisma.enrollment.findUnique({
    where: {
      studentId_offeringId: {
        studentId: student.id,
        offeringId: input.offeringId,
      },
    },
    select: {
      status: true,
      offering: {
        select: {
          endsOn: true,
          course: { select: { name: true } },
        },
      },
    },
  })

  // A foreign or nonexistent offering is reported the same way as a course the
  // student is not enrolled in, so the endpoint never confirms that another
  // student's offering exists.
  if (!enrollment || enrollment.status !== "active") {
    return { kind: "not-enrolled" }
  }

  const endsOn = enrollment.offering.endsOn
  if (!endsOn || endsOn >= new Date()) {
    return { kind: "not-completed" }
  }

  const comment = (input.comment ?? "").trim()

  await prisma.courseRating.upsert({
    where: {
      offeringId_studentId: {
        offeringId: input.offeringId,
        studentId: student.id,
      },
    },
    update: {
      rating: input.rating,
      comment: comment.length ? comment : null,
    },
    create: {
      offeringId: input.offeringId,
      studentId: student.id,
      rating: input.rating,
      comment: comment.length ? comment : null,
    },
  })

  return { kind: "rated", courseName: enrollment.offering.course.name }
}

/**
 * The ratings report for every offering the signed-in teacher owns.
 *
 * Returns `null` when the session has no staff profile (→ 404). The report is
 * deliberately one row per owned offering, including offerings with no ratings
 * yet, so the dashboard can distinguish "not rated" from "not yours".
 */
export async function getTeacherRatingsReport(
  actor: AuthUser,
): Promise<CourseOfferingRatingsReport[] | null> {
  const staff = await prisma.staffProfile.findUnique({
    where: { userId: actor.id },
    select: { id: true },
  })
  if (!staff) return null

  const offerings = await prisma.courseOffering.findMany({
    // Object-level ownership: only offerings this teacher owns.
    where: { teacherId: staff.id },
    include: {
      course: { select: { code: true, name: true } },
      classRoom: { select: { name: true, section: true } },
      ratings: {
        include: {
          student: { select: { fullName: true, registerNumber: true } },
        },
        orderBy: { updatedAt: "desc" },
      },
    },
    orderBy: [{ academicYear: "desc" }, { term: "asc" }],
  })

  return offerings.map((offering) => {
    const count = offering.ratings.length
    const average = count
      ? offering.ratings.reduce((sum, row) => sum + row.rating, 0) / count
      : null

    return {
      offeringId: offering.id,
      courseCode: offering.course.code,
      courseName: offering.course.name,
      className: `${offering.classRoom.name}${offering.classRoom.section ? ` ${offering.classRoom.section}` : ""}`,
      term: offering.term,
      academicYear: offering.academicYear,
      ratingsCount: count,
      averageRating: average,
      ratings: offering.ratings.map((rating) => ({
        id: rating.id,
        rating: rating.rating,
        comment: rating.comment,
        studentName: rating.student.fullName,
        registerNumber: rating.student.registerNumber,
        updatedAt: rating.updatedAt.toISOString(),
      })),
    }
  })
}
