import { NextResponse } from "next/server"

import { jsonError, parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { courseEnrollRequestSchema } from "@/lib/contracts"
import { acknowledgeArrearForStudent } from "@/lib/enrollment-arrear-gate"
import { prisma } from "@/lib/prisma"

/**
 * `POST /api/student/courses/enroll/acknowledge` — record that the student has seen an arrear.
 *
 * The enrolment route refuses a new course while an arrear stands; this is the one click that
 * removes the refusal without stranding the student. The body is the same shape as the enrol
 * request (`{ offeringId }`), but the id is the **arrear-bearing offering**, not the course the
 * student was trying to register for — it is the arrear being acknowledged, and the enrolment
 * route's 409 names it.
 *
 * The reason is derived server-side from the student's own outcomes
 * (`acknowledgeArrearForStudent`), never accepted from the client, so a request cannot
 * acknowledge an arrear that does not exist or silence one the student does not have.
 */
export async function POST(request: Request) {
  const auth = await requireRole("student")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, courseEnrollRequestSchema)
  if (!parsed.ok) return parsed.response

  const student = await prisma.studentProfile.findUnique({
    where: { userId: auth.user.id },
    select: { id: true },
  })
  if (!student) return jsonError("Student profile not found", 404)

  const result = await acknowledgeArrearForStudent({
    user: auth.user,
    studentId: student.id,
    offeringId: parsed.data.offeringId,
  })
  if (result.kind === "no-arrear") {
    return jsonError("No outstanding arrear was found for that course.", 409)
  }

  return NextResponse.json({
    success: true,
    message: `Acknowledgement recorded for ${result.hold.courseCode}.`,
    arrear: result.hold,
  })
}
