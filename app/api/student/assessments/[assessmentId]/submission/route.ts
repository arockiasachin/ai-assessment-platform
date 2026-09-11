import { NextResponse } from "next/server"

import { jsonError, parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { submissionRequestSchema } from "@/lib/contracts"
import { prisma } from "@/lib/prisma"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ assessmentId: string }> },
) {
  const auth = await requireRole("student")
  if (!auth.authorized) return auth.response

  const student = await prisma.studentProfile.findUnique({
    where: { userId: auth.user.id },
    select: { id: true },
  })

  if (!student) {
    return jsonError("Student profile not found", 404)
  }

  const parsed = await parseJsonBody(request, submissionRequestSchema)
  if (!parsed.ok) return parsed.response

  const contentText = String(parsed.data.contentText ?? "").trim()
  const action = parsed.data.action

  const { assessmentId } = await params

  if (!assessmentId) {
    return jsonError("Assessment is required.", 400)
  }

  if (action !== "saveDraft" && !contentText.length) {
    return jsonError("Add submission content before submitting.", 400)
  }

  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      id: true,
      title: true,
      type: true,
      dueDate: true,
      offeringId: true,
      offering: {
        select: {
          enrollments: {
            where: { studentId: student.id, status: "active" },
            select: { id: true },
          },
        },
      },
    },
  })

  if (!assessment) {
    return jsonError("Assessment not found.", 404)
  }

  if (assessment.type !== "ASSIGNMENT") {
    return jsonError("Only assignments support submissions.", 409)
  }

  if (assessment.offering.enrollments.length === 0) {
    return jsonError("You are not enrolled in this assessment offering.", 403)
  }

  const now = new Date()
  const status =
    action === "saveDraft"
      ? "DRAFT"
      : action === "resubmit"
        ? "RESUBMITTED"
        : now > assessment.dueDate
          ? "LATE"
          : "SUBMITTED"

  await prisma.submission.upsert({
    where: {
      assessmentId_studentId: {
        assessmentId,
        studentId: student.id,
      },
    },
    create: {
      assessmentId,
      studentId: student.id,
      status,
      contentText: contentText.length ? contentText : null,
      submittedAt: action === "saveDraft" ? null : now,
    },
    update: {
      status,
      contentText: contentText.length ? contentText : null,
      submittedAt: action === "saveDraft" ? null : now,
    },
  })

  return NextResponse.json({
    success: true,
    message:
      action === "saveDraft" ? "Draft saved." : `Submission recorded for ${assessment.title}.`,
  })
}
