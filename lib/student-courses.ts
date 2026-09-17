import "server-only"

import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

export type CourseRegistrationStatus =
  "open" | "upcoming" | "closed" | "full" | "enrolled" | "waitlisted"

/** Star values a rating can take, highest first — the display order of the distribution. */
const RATING_VALUES = [5, 4, 3, 2, 1] as const

/**
 * One bar of a course's rating distribution.
 *
 * Aggregate only by construction: `buildRatingDistribution` counts rows and
 * carries no rater identity. `docs/plans/wave-1.md` D7 — a student sees the
 * distribution and their own rating; a classmate's name and comment are never
 * in this payload.
 */
export type CourseRatingBucket = {
  /** Star value, 1–5. */
  stars: number
  /** How many ratings carry this star value. */
  count: number
}

export type CourseCatalogItem = {
  offeringId: string
  courseId: string
  courseCode: string
  courseName: string
  description: string | null
  credits: number
  teacherName: string
  className: string
  term: string
  academicYear: number
  startsOn: string | null
  endsOn: string | null
  registrationOpenAt: string | null
  registrationCloseAt: string | null
  studentLimit: number
  enrolledCount: number
  waitlistedCount: number
  registrationStatus: CourseRegistrationStatus
  canRegister: boolean
  isEnrolled: boolean
  isWaitlisted: boolean
  isCompleted: boolean
  studentRating: number | null
  studentRatingComment: string | null
  /** Null means "no ratings yet" and must render as `—`, never `0`. */
  averageRating: number | null
  ratingsCount: number
  /**
   * Counts per star value, 5 → 1, always five buckets.
   *
   * Added by the port: the payload previously carried only `averageRating` and
   * the caller's own row, so the design's distribution donut had nothing to
   * draw (D7). This stays aggregate-only — no rater identity of any kind.
   */
  ratingDistribution: CourseRatingBucket[]
}

export type StudentCoursesPayload = {
  now: string
  enrolledCourses: CourseCatalogItem[]
  offeredCourses: CourseCatalogItem[]
}

export type CourseRegistrationMeta = {
  status: CourseRegistrationStatus
  canRegister: boolean
}

/**
 * Where an offering sits in the registration window for one student.
 *
 * Pure, so the ordering of the rules is testable without a database: an
 * existing enrollment wins over capacity, and capacity wins over the window.
 *
 * `endsOn` closes an offering that has finished (`SN-8`): without it a course
 * whose `endsOn` was eight months in the past still reported "Registration
 * open" and accepted an enrolment. A completed course is closed regardless of
 * its registration window or its spare seats — "class full" would be a
 * misleading label for a course that no longer runs.
 */
export function registrationStatusFor(input: {
  isEnrolled: boolean
  isWaitlisted: boolean
  now: Date
  endsOn: Date | null
  registrationOpenAt: Date | null
  registrationCloseAt: Date | null
  enrolledCount: number
  studentLimit: number
}): CourseRegistrationMeta {
  if (input.isEnrolled) return { status: "enrolled", canRegister: false }
  if (input.isWaitlisted) return { status: "waitlisted", canRegister: false }
  if (input.endsOn && input.now > input.endsOn) return { status: "closed", canRegister: false }
  if (input.enrolledCount >= input.studentLimit) return { status: "full", canRegister: false }
  if (input.registrationOpenAt && input.now < input.registrationOpenAt)
    return { status: "upcoming", canRegister: false }
  if (input.registrationCloseAt && input.now > input.registrationCloseAt)
    return { status: "closed", canRegister: false }
  return { status: "open", canRegister: true }
}

/**
 * Count ratings per star value, highest first.
 *
 * Always five buckets, so a zero count is present and explicit rather than a
 * missing key. Pure and database-free: this is the aggregate D7 allows, and
 * the invariant that a course with no ratings yields an all-zero distribution
 * (while its `averageRating` stays `null`, rendered as `—`) is asserted here
 * without a server.
 */
export function buildRatingDistribution(
  ratings: readonly { rating: number }[],
): CourseRatingBucket[] {
  return RATING_VALUES.map((stars) => ({
    stars,
    count: ratings.reduce((total, row) => (row.rating === stars ? total + 1 : total), 0),
  }))
}

/**
 * The student's course catalog: every offering, split into the ones they are
 * registered for and everything else.
 *
 * Extracted from `app/api/student/courses/route.ts`, where the query lived
 * inline with a client `useEffect` as its only consumer. A Server Component
 * cannot call a route handler, so the port needed the query somewhere both can
 * reach — and pulling it out is what lets the page render from props instead of
 * fetching on mount (the deferred P1 finding in `docs/quality/a11y-perf-audit.md`).
 *
 * Returns `null` when the user has no student profile, which the route surfaces
 * as a 404 and the page treats as "not signed in as a student".
 */
export async function listStudentCourses(user: AuthUser): Promise<StudentCoursesPayload | null> {
  const student = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (!student) return null

  const now = new Date()

  const offerings = await prisma.courseOffering.findMany({
    select: {
      id: true,
      courseId: true,
      term: true,
      academicYear: true,
      startsOn: true,
      endsOn: true,
      registrationOpenAt: true,
      registrationCloseAt: true,
      studentLimit: true,
      course: {
        select: {
          code: true,
          name: true,
          description: true,
          credits: true,
        },
      },
      classRoom: {
        select: {
          name: true,
          section: true,
        },
      },
      teacher: {
        select: {
          fullName: true,
        },
      },
      enrollments: { select: { studentId: true, status: true } },
      // Identity is read only to locate the caller's own row and its comment.
      // The serializer below emits counts, never a rater.
      ratings: {
        select: { studentId: true, rating: true, comment: true },
      },
    },
    orderBy: [{ academicYear: "desc" }, { term: "asc" }],
  })

  const items: CourseCatalogItem[] = offerings.map((offering) => {
    const myEnrollment = offering.enrollments.find((e) => e.studentId === student.id)
    const isEnrolled = myEnrollment?.status === "active"
    const isWaitlisted = myEnrollment?.status === "waitlisted"

    let enrolledCount = 0
    let waitlistedCount = 0
    for (const enrollment of offering.enrollments) {
      if (enrollment.status === "active") enrolledCount++
      if (enrollment.status === "waitlisted") waitlistedCount++
    }

    const statusMeta = registrationStatusFor({
      isEnrolled,
      isWaitlisted,
      now,
      endsOn: offering.endsOn,
      registrationOpenAt: offering.registrationOpenAt,
      registrationCloseAt: offering.registrationCloseAt,
      enrolledCount,
      studentLimit: offering.studentLimit,
    })

    const isCompleted = Boolean(offering.endsOn && offering.endsOn < now)

    // Null, never zero: "not rated yet" and "rated zero" are different facts,
    // and a rating is 1–5 so zero is not even expressible.
    const averageRating = offering.ratings.length
      ? offering.ratings.reduce((sum, row) => sum + row.rating, 0) / offering.ratings.length
      : null
    const ownRating = offering.ratings.find((row) => row.studentId === student.id) ?? null

    return {
      offeringId: offering.id,
      courseId: offering.courseId,
      courseCode: offering.course.code,
      courseName: offering.course.name,
      description: offering.course.description,
      credits: offering.course.credits,
      teacherName: offering.teacher.fullName,
      className: `${offering.classRoom.name}${offering.classRoom.section ? ` ${offering.classRoom.section}` : ""}`,
      term: offering.term,
      academicYear: offering.academicYear,
      startsOn: offering.startsOn?.toISOString() ?? null,
      endsOn: offering.endsOn?.toISOString() ?? null,
      registrationOpenAt: offering.registrationOpenAt?.toISOString() ?? null,
      registrationCloseAt: offering.registrationCloseAt?.toISOString() ?? null,
      studentLimit: offering.studentLimit,
      enrolledCount,
      waitlistedCount,
      registrationStatus: statusMeta.status,
      canRegister: statusMeta.canRegister,
      isEnrolled,
      isWaitlisted,
      isCompleted,
      studentRating: ownRating?.rating ?? null,
      studentRatingComment: ownRating?.comment ?? null,
      averageRating,
      ratingsCount: offering.ratings.length,
      ratingDistribution: buildRatingDistribution(offering.ratings),
    }
  })

  return {
    now: now.toISOString(),
    enrolledCourses: items.filter((item) => item.isEnrolled || item.isWaitlisted),
    offeredCourses: items,
  }
}
