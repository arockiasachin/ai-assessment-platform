import { NextResponse } from "next/server"
import { getSessionUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

function parseDateOrNull(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date
}

export async function PUT(request: Request, { params }: { params: Promise<{ offeringId: string }> }) {
  const user = await getSessionUser()
  if (!user || user.role !== "teacher") {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 })
  }

  const staff = await prisma.staffProfile.findUnique({ where: { userId: user.id }, select: { id: true } })
  if (!staff) {
    return NextResponse.json({ success: false, message: "Teacher profile not found" }, { status: 404 })
  }

  const { offeringId } = await params

  const body = (await request.json()) as {
    studentLimit?: number
    registrationOpenAt?: string | null
    registrationCloseAt?: string | null
    startsOn?: string | null
    endsOn?: string | null
  }

  const studentLimit = Number(body.studentLimit)
  if (!Number.isInteger(studentLimit) || studentLimit < 1 || studentLimit > 500) {
    return NextResponse.json({ success: false, message: "Student limit must be between 1 and 500." }, { status: 400 })
  }

  const registrationOpenAt = parseDateOrNull(body.registrationOpenAt)
  const registrationCloseAt = parseDateOrNull(body.registrationCloseAt)
  const startsOn = parseDateOrNull(body.startsOn)
  const endsOn = parseDateOrNull(body.endsOn)

  if (registrationOpenAt && registrationCloseAt && registrationOpenAt > registrationCloseAt) {
    return NextResponse.json({ success: false, message: "Registration open date must be before close date." }, { status: 400 })
  }

  if (startsOn && endsOn && startsOn > endsOn) {
    return NextResponse.json({ success: false, message: "Course start date must be before end date." }, { status: 400 })
  }

  const existing = await prisma.courseOffering.findFirst({
    where: { id: offeringId, teacherId: staff.id },
    select: { id: true },
  })

  if (!existing) {
    return NextResponse.json({ success: false, message: "Offering not found." }, { status: 404 })
  }

  await prisma.courseOffering.update({
    where: { id: offeringId },
    data: {
      studentLimit,
      registrationOpenAt,
      registrationCloseAt,
      startsOn,
      endsOn,
    },
  })

  return NextResponse.json({ success: true, message: "Offering settings updated." })
}
