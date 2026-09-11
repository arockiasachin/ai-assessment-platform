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
    return NextResponse.json(
      { success: false, message: "Student profile not found" },
      { status: 404 },
    )
  }

  const body = (await request.json()) as { offeringId?: string; rating?: number; comment?: string }
  const offeringId = body.offeringId?.trim()
  const rating = Number(body.rating)
  const comment = (body.comment ?? "").trim()

  if (!offeringId) {
    return NextResponse.json({ success: false, message: "Offering is required." }, { status: 400 })
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json(
      { success: false, message: "Rating must be an integer between 1 and 5." },
      { status: 400 },
    )
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: {
      studentId_offeringId: {
        studentId: student.id,
        offeringId,
      },
    },
    include: {
      offering: {
        include: { course: { select: { name: true } } },
      },
    },
  })

  if (!enrollment) {
    return NextResponse.json(
      { success: false, message: "You must be enrolled to rate this course." },
      { status: 403 },
    )
  }

  const isCompleted = Boolean(enrollment.offering.endsOn && enrollment.offering.endsOn < new Date())
  if (!isCompleted) {
    return NextResponse.json(
      { success: false, message: "You can rate this course only after completion." },
      { status: 409 },
    )
  }

  await prisma.courseRating.upsert({
    where: {
      offeringId_studentId: {
        offeringId,
        studentId: student.id,
      },
    },
    update: {
      rating,
      comment: comment.length ? comment.slice(0, 500) : null,
    },
    create: {
      offeringId,
      studentId: student.id,
      rating,
      comment: comment.length ? comment.slice(0, 500) : null,
    },
  })

  return NextResponse.json({
    success: true,
    message: `Saved rating for ${enrollment.offering.course.name}.`,
  })
}
