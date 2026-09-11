import { NextResponse } from "next/server"
import { jsonError, parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { updateOfferingRequestSchema } from "@/lib/contracts"
import { prisma } from "@/lib/prisma"

/**
 * Map a schedule field from a partial update.
 *
 * `undefined` means the caller omitted the field, so it must be left untouched;
 * `null` means the caller explicitly asked to clear it; a string is parsed.
 * The previous helper collapsed "omitted" and "invalid" into `null`, so a body
 * such as `{ "studentLimit": 30 }` silently wiped every schedule date on the
 * offering (bug-fix run 2). The contract already rejects unparseable strings;
 * returning `undefined` here is defence in depth so a bad value can never clear
 * a field either.
 */
function toNullableDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
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
  const registrationOpenAt = toNullableDate(parsed.data.registrationOpenAt)
  const registrationCloseAt = toNullableDate(parsed.data.registrationCloseAt)
  const startsOn = toNullableDate(parsed.data.startsOn)
  const endsOn = toNullableDate(parsed.data.endsOn)

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
      // Only fields the caller actually supplied are written. An explicit `null`
      // still clears the field (the run-1 contract test pins that behaviour).
      ...(registrationOpenAt !== undefined ? { registrationOpenAt } : {}),
      ...(registrationCloseAt !== undefined ? { registrationCloseAt } : {}),
      ...(startsOn !== undefined ? { startsOn } : {}),
      ...(endsOn !== undefined ? { endsOn } : {}),
    },
  })

  return NextResponse.json({ success: true, message: "Offering settings updated." })
}
