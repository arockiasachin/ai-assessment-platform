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
      submissions: {
        where: { studentId: student.id },
        select: { status: true },
        take: 1,
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

  // Submission state guard. A graded submission is immutable to the student:
  // without this, `submit`/`saveDraft` silently overwrote a GRADED status (and
  // cleared `submittedAt`), corrupting the record the teacher had already
  // graded while the attached grade/feedback remained.
  const existingSubmission = assessment.submissions[0] ?? null

  if (existingSubmission?.status === "GRADED") {
    return jsonError("This submission has already been graded and can no longer be changed.", 409)
  }

  if (action === "saveDraft" && existingSubmission && existingSubmission.status !== "DRAFT") {
    return jsonError("A submitted assignment can no longer be saved as a draft.", 409)
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
