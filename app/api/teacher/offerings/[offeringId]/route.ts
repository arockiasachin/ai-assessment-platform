import { NextResponse } from "next/server"
import { jsonError, parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { updateOfferingRequestSchema } from "@/lib/contracts"
import { prisma } from "@/lib/prisma"

function parseDateOrNull(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ offeringId: string }> },
) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const staff = await prisma.staffProfile.findUnique({
    where: { userId: auth.user.id },
    select: { id: true },
  })
  if (!staff) {
    return jsonError("Teacher profile not found", 404)
  }

  const parsed = await parseJsonBody(request, updateOfferingRequestSchema)
  if (!parsed.ok) return parsed.response

  const { offeringId } = await params

  const studentLimit = parsed.data.studentLimit
  const registrationOpenAt = parseDateOrNull(parsed.data.registrationOpenAt)
  const registrationCloseAt = parseDateOrNull(parsed.data.registrationCloseAt)
  const startsOn = parseDateOrNull(parsed.data.startsOn)
  const endsOn = parseDateOrNull(parsed.data.endsOn)

  if (registrationOpenAt && registrationCloseAt && registrationOpenAt > registrationCloseAt) {
    return NextResponse.json(
      { success: false, message: "Registration open date must be before close date." },
      { status: 400 },
    )
  }

  if (startsOn && endsOn && startsOn > endsOn) {
    return NextResponse.json(
      { success: false, message: "Course start date must be before end date." },
      { status: 400 },
    )
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
