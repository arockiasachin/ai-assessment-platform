import { NextResponse } from "next/server"
import { getSessionUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function POST(request: Request) {
  const user = await getSessionUser()
  if (!user || user.role !== "student") {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 })
  }

  const student = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })

  if (!student) {
    return NextResponse.json({ success: false, message: "Student profile not found" }, { status: 404 })
  }

  const body = (await request.json()) as { offeringId?: string }
  const offeringId = body.offeringId?.trim()

  if (!offeringId) {
    return NextResponse.json({ success: false, message: "Offering is required." }, { status: 400 })
  }

  const offering = await prisma.courseOffering.findUnique({
    where: { id: offeringId },
    include: { enrollments: { select: { studentId: true, status: true } }, course: { select: { name: true } } },
  })

  if (!offering) {
    return NextResponse.json({ success: false, message: "Course offering not found." }, { status: 404 })
  }

  const existing = offering.enrollments.find((row) => row.studentId === student.id)
  if (existing?.status === "active") {
    return NextResponse.json({ success: true, message: `Already enrolled in ${offering.course.name}.` })
  }

  const now = new Date()
  if (offering.registrationOpenAt && now < offering.registrationOpenAt) {
    return NextResponse.json({ success: false, message: "Registration has not opened yet." }, { status: 409 })
  }
  if (offering.registrationCloseAt && now > offering.registrationCloseAt) {
    return NextResponse.json({ success: false, message: "Registration window is closed." }, { status: 409 })
  }
  const activeCount = offering.enrollments.filter((row) => row.status === "active").length
  if (activeCount >= offering.studentLimit) {
    if (existing?.status === "waitlisted") {
      return NextResponse.json({ success: true, message: `You are already waitlisted for ${offering.course.name}.` })
    }

    if (existing) {
      await prisma.enrollment.update({
        where: {
          studentId_offeringId: {
            studentId: student.id,
            offeringId,
          },
        },
        data: { status: "waitlisted" },
      })
    } else {
      await prisma.enrollment.create({
        data: {
          studentId: student.id,
          offeringId,
          status: "waitlisted",
        },
      })
    }

    return NextResponse.json({ success: true, message: `Course is full. You have been added to waitlist for ${offering.course.name}.` })
  }

  if (existing?.status === "waitlisted") {
    await prisma.enrollment.update({
      where: {
        studentId_offeringId: {
          studentId: student.id,
          offeringId,
        },
      },
      data: { status: "active" },
    })
  } else {
    await prisma.enrollment.create({
      data: {
        studentId: student.id,
        offeringId,
        status: "active",
      },
    })
  }

  return NextResponse.json({ success: true, message: `Enrolled in ${offering.course.name}.` })
}
