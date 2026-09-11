import { NextResponse } from "next/server"
import { requireRole } from "@/lib/authz"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response
  const user = auth.user

  const staff = await prisma.staffProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (!staff) {
    return NextResponse.json({ message: "Teacher profile not found" }, { status: 404 })
  }

  const offerings = await prisma.courseOffering.findMany({
    where: { teacherId: staff.id },
    include: {
      course: { select: { code: true, name: true } },
      classRoom: { select: { name: true, section: true } },
      enrollments: { select: { status: true } },
    },
    orderBy: [{ academicYear: "desc" }, { term: "asc" }],
  })

  const rows = offerings.map((offering) => ({
    id: offering.id,
    courseCode: offering.course.code,
    courseName: offering.course.name,
    className: `${offering.classRoom.name}${offering.classRoom.section ? ` ${offering.classRoom.section}` : ""}`,
    term: offering.term,
    academicYear: offering.academicYear,
    studentLimit: offering.studentLimit,
    registrationOpenAt: offering.registrationOpenAt?.toISOString() ?? null,
    registrationCloseAt: offering.registrationCloseAt?.toISOString() ?? null,
    startsOn: offering.startsOn?.toISOString() ?? null,
    endsOn: offering.endsOn?.toISOString() ?? null,
    enrolledCount: offering.enrollments.filter((e) => e.status === "active").length,
    waitlistedCount: offering.enrollments.filter((e) => e.status === "waitlisted").length,
  }))

  return NextResponse.json({ offerings: rows })
}
