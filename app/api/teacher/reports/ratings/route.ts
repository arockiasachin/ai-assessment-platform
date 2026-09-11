import { NextResponse } from "next/server"
import { getSessionUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const user = await getSessionUser()
  if (!user || user.role !== "teacher") {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
  }

  const staff = await prisma.staffProfile.findUnique({ where: { userId: user.id }, select: { id: true } })
  if (!staff) {
    return NextResponse.json({ message: "Teacher profile not found" }, { status: 404 })
  }

  const offerings = await prisma.courseOffering.findMany({
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

  const rows = offerings.map((offering) => {
    const count = offering.ratings.length
    const average = count ? offering.ratings.reduce((sum, row) => sum + row.rating, 0) / count : null

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

  return NextResponse.json({ offerings: rows })
}
