import { NextResponse } from "next/server"

import { jsonError, parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { submissionRequestSchema } from "@/lib/contracts"
import { prisma } from "@/lib/prisma"
import { evaluateFatGateForStudent } from "@/lib/grading/offering-config-service"

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

  /*
   * Text submissions, for the two kinds that are text.
   *
   * This was `!== "ASSIGNMENT"`, which made a **descriptive** assessment impossible to submit at all —
   * even though this route implements exactly what one needs: a `contentText` body with
   * draft/submit/resubmit semantics, which is what `lib/rubric-grading` grades. The guard was
   * untested, so nothing recorded the narrower reading as intentional.
   *
   * Widening it also matters for the FAT gate: a course whose final assessment is a descriptive piece
   * could not be gated, because there was no submission to refuse.
   *
   * `QUIZ` and `CODE` are still refused, deliberately: a quiz is sat through the attempt pipeline and
   * a code task through the sandbox pipeline, and neither has any business creating a `Submission`
   * from a text body here.
   */
  if (assessment.type !== "ASSIGNMENT" && assessment.type !== "DESCRIPTIVE") {
    return jsonError("Only written assessments support text submissions.", 409)
  }

  if (assessment.offering.enrollments.length === 0) {
    return jsonError("You are not enrolled in this assessment offering.", 403)
  }

  /*
   * The FAT gate, for a written assessment that is a course's final piece.
   *
   * After the enrollment check and before the submission-state guard, so a refused student is told
   * why rather than being met with the immutability rule. Only a genuine below-minimum CAT score
   * refuses — see `evaluateFatGateForStudent` — and a student with too little marked work is allowed
   * through rather than failed on unfinished marking.
   */
  const fatGate = await evaluateFatGateForStudent({
    offeringId: assessment.offeringId,
    assessmentId: assessment.id,
    studentId: student.id,
  })
  if (!fatGate.allowed) return jsonError(fatGate.message, 403)

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
