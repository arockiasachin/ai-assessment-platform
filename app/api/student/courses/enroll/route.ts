import { NextResponse } from "next/server"

import { jsonError, parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { courseEnrollRequestSchema } from "@/lib/contracts"
import { prisma } from "@/lib/prisma"

export async function POST(request: Request) {
  const auth = await requireRole("student")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, courseEnrollRequestSchema)
  if (!parsed.ok) return parsed.response

  const student = await prisma.studentProfile.findUnique({
    where: { userId: auth.user.id },
    select: { id: true },
  })

  if (!student) {
    return jsonError("Student profile not found", 404)
  }

  const { offeringId } = parsed.data

  const offering = await prisma.courseOffering.findUnique({
    where: { id: offeringId },
    include: {
      enrollments: { select: { studentId: true, status: true } },
      course: { select: { name: true } },
    },
  })

  if (!offering) {
    return jsonError("Course offering not found.", 404)
  }

  const existing = offering.enrollments.find((row) => row.studentId === student.id)
  if (existing?.status === "active") {
    return NextResponse.json({
      success: true,
      message: `Already enrolled in ${offering.course.name}.`,
    })
  }

  const now = new Date()
  if (offering.registrationOpenAt && now < offering.registrationOpenAt) {
    return jsonError("Registration has not opened yet.", 409)
  }
  if (offering.registrationCloseAt && now > offering.registrationCloseAt) {
    return jsonError("Registration window is closed.", 409)
  }
  const activeCount = offering.enrollments.filter((row) => row.status === "active").length
  if (activeCount >= offering.studentLimit) {
    if (existing?.status === "waitlisted") {
      return NextResponse.json({
        success: true,
        message: `You are already waitlisted for ${offering.course.name}.`,
      })
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

    return NextResponse.json({
      success: true,
      message: `Course is full. You have been added to waitlist for ${offering.course.name}.`,
    })
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
