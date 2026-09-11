import { NextResponse } from "next/server"
import { jsonError, parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { updateOfferingRequestSchema, type UpdateOfferingRequest } from "@/lib/contracts"
import { PartialUpdateError, partialUpdate } from "@/lib/partial-update"
import { prisma } from "@/lib/prisma"

/**
 * Parse a nullable schedule field. `null` is an explicit clear; a string is
 * parsed into a `Date`. Omitted fields never reach this function.
 */
function toNullableDate(value: string | null): Date | null {
  return value === null ? null : new Date(value)
}

/**
 * Build the write payload from the fields the caller actually sent.
 *
 * The run-2 data-loss bug lived here: a helper collapsed "field omitted" and
 * "field invalid" into `null`, then every date column was written
 * unconditionally, so `{ "studentLimit": 30 }` wiped the offering's schedule.
 * `partialUpdate` only includes the supplied fields; an explicit `null` still
 * clears one date. The contract rejects unparseable strings, and a transform
 * failure is mapped to a `400` below rather than reaching Prisma.
 */
function buildOfferingSettings(request: UpdateOfferingRequest) {
  return partialUpdate(request, {
    studentLimit: true,
    registrationOpenAt: toNullableDate,
    registrationCloseAt: toNullableDate,
    startsOn: toNullableDate,
    endsOn: toNullableDate,
  })
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

  let settings: ReturnType<typeof buildOfferingSettings>
  try {
    settings = buildOfferingSettings(parsed.data)
  } catch (error) {
    if (error instanceof PartialUpdateError) return jsonError(error.message, 400)
    throw error
  }

  const { registrationOpenAt, registrationCloseAt, startsOn, endsOn } = settings

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
    // Only fields the caller actually supplied are written. An explicit `null`
    // still clears the field (the run-1 contract test pins that behaviour).
    data: settings,
  })

  return NextResponse.json({ success: true, message: "Offering settings updated." })
}
