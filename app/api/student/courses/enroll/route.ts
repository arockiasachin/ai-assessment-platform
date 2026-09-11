import { NextResponse } from "next/server"

import { jsonError, parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { courseEnrollRequestSchema } from "@/lib/contracts"
import { prisma } from "@/lib/prisma"

type EnrollOutcome =
  | { kind: "not-found" }
  | { kind: "enrolled"; courseName: string }
  | { kind: "already-enrolled"; courseName: string }
  | { kind: "waitlisted"; courseName: string }
  | { kind: "already-waitlisted"; courseName: string }
  | { kind: "not-open" }
  | { kind: "closed" }

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

  // The capacity decision is check-then-act, so it must hold a lock. A plain
  // read followed by a write lets two students racing for the last seat both
  // observe it as free and both be activated (`studentLimit` exceeded). Taking a
  // row lock on the offering serializes concurrent enrollments for that
  // offering: the second transaction blocks until the first commits, then sees
  // its enrollment.
  const outcome = await prisma.$transaction(async (tx): Promise<EnrollOutcome> => {
    const offering = await tx.courseOffering.findUnique({
      where: { id: offeringId },
      include: { course: { select: { name: true } } },
    })
    if (!offering) return { kind: "not-found" }

    await tx.$queryRaw`SELECT "id" FROM "CourseOffering" WHERE "id" = ${offeringId} FOR UPDATE`

    const existing = await tx.enrollment.findUnique({
      where: { studentId_offeringId: { studentId: student.id, offeringId } },
      select: { status: true },
    })
    if (existing?.status === "active") {
      return { kind: "already-enrolled", courseName: offering.course.name }
    }

    const now = new Date()
    if (offering.registrationOpenAt && now < offering.registrationOpenAt) {
      return { kind: "not-open" }
    }
    if (offering.registrationCloseAt && now > offering.registrationCloseAt) {
      return { kind: "closed" }
    }

    const activeCount = await tx.enrollment.count({
      where: { offeringId, status: "active" },
    })
    if (activeCount >= offering.studentLimit) {
      if (existing?.status === "waitlisted") {
        return { kind: "already-waitlisted", courseName: offering.course.name }
      }
      await tx.enrollment.upsert({
        where: { studentId_offeringId: { studentId: student.id, offeringId } },
        create: { studentId: student.id, offeringId, status: "waitlisted" },
        update: { status: "waitlisted" },
      })
      return { kind: "waitlisted", courseName: offering.course.name }
    }

    await tx.enrollment.upsert({
      where: { studentId_offeringId: { studentId: student.id, offeringId } },
      create: { studentId: student.id, offeringId, status: "active" },
      update: { status: "active" },
    })
    return { kind: "enrolled", courseName: offering.course.name }
  })

  switch (outcome.kind) {
    case "not-found":
      return jsonError("Course offering not found.", 404)
    case "not-open":
      return jsonError("Registration has not opened yet.", 409)
    case "closed":
      return jsonError("Registration window is closed.", 409)
    case "already-enrolled":
      return NextResponse.json({
        success: true,
        message: `Already enrolled in ${outcome.courseName}.`,
      })
    case "already-waitlisted":
      return NextResponse.json({
        success: true,
        message: `You are already waitlisted for ${outcome.courseName}.`,
      })
    case "waitlisted":
      return NextResponse.json({
        success: true,
        message: `Course is full. You have been added to waitlist for ${outcome.courseName}.`,
      })
    case "enrolled":
      return NextResponse.json({ success: true, message: `Enrolled in ${outcome.courseName}.` })
  }
}
