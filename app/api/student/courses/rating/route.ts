import { NextResponse } from "next/server"

import { jsonError, parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { courseRatingRequestSchema } from "@/lib/contracts"
import { prisma } from "@/lib/prisma"

export async function POST(request: Request) {
  const auth = await requireRole("student")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, courseRatingRequestSchema)
  if (!parsed.ok) return parsed.response

  const student = await prisma.studentProfile.findUnique({
    where: { userId: auth.user.id },
    select: { id: true },
  })

  if (!student) {
    return jsonError("Student profile not found", 404)
  }

  const { offeringId, rating } = parsed.data
  const comment = (parsed.data.comment ?? "").trim()

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
    return jsonError("You must be enrolled to rate this course.", 403)
  }

  const isCompleted = Boolean(enrollment.offering.endsOn && enrollment.offering.endsOn < new Date())
  if (!isCompleted) {
    return jsonError("You can rate this course only after completion.", 409)
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
