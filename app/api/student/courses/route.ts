import { NextResponse } from "next/server"
import { requireRole } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import type {
  CourseCatalogItem,
  CourseRegistrationStatus,
  StudentCoursesPayload,
} from "@/lib/student-courses"

function toStatus(input: {
  isEnrolled: boolean
  isWaitlisted: boolean
  now: Date
  registrationOpenAt: Date | null
  registrationCloseAt: Date | null
  enrolledCount: number
  studentLimit: number
}): { status: CourseRegistrationStatus; canRegister: boolean } {
  if (input.isEnrolled) return { status: "enrolled", canRegister: false }
  if (input.isWaitlisted) return { status: "waitlisted", canRegister: false }
  if (input.enrolledCount >= input.studentLimit) return { status: "full", canRegister: false }
  if (input.registrationOpenAt && input.now < input.registrationOpenAt)
    return { status: "upcoming", canRegister: false }
  if (input.registrationCloseAt && input.now > input.registrationCloseAt)
    return { status: "closed", canRegister: false }
  return { status: "open", canRegister: true }
}

export async function GET() {
  const auth = await requireRole("student")
  if (!auth.authorized) return auth.response
  const user = auth.user

  const student = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })

  if (!student) {
    return NextResponse.json({ message: "Student profile not found" }, { status: 404 })
  }

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

    const statusMeta = toStatus({
      isEnrolled,
      isWaitlisted,
      now,
      registrationOpenAt: offering.registrationOpenAt,
      registrationCloseAt: offering.registrationCloseAt,
      enrolledCount,
      studentLimit: offering.studentLimit,
    })

    const isCompleted = Boolean(offering.endsOn && offering.endsOn < now)

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
    }
  })

  const payload: StudentCoursesPayload = {
    now: now.toISOString(),
    enrolledCourses: items.filter((item) => item.isEnrolled || item.isWaitlisted),
    offeredCourses: items,
  }

  return NextResponse.json(payload)
}
