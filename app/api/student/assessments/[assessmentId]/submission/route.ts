import { NextResponse } from "next/server"
import { getSessionUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

type SubmitAction = "saveDraft" | "submit" | "resubmit"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ assessmentId: string }> },
) {
  const user = await getSessionUser()
  if (!user || user.role !== "student") {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 })
  }

  const student = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })

  if (!student) {
    return NextResponse.json(
      { success: false, message: "Student profile not found" },
      { status: 404 },
    )
  }

  const { assessmentId } = await params

  const body = (await request.json()) as { contentText?: string; action?: SubmitAction }
  const contentText = String(body.contentText ?? "").trim()
  const action = body.action ?? "submit"

  if (!assessmentId) {
    return NextResponse.json(
      { success: false, message: "Assessment is required." },
      { status: 400 },
    )
  }

  if (contentText.length > 4000) {
    return NextResponse.json(
      { success: false, message: "Submission content must be 4000 characters or fewer." },
      { status: 400 },
    )
  }

  if (action !== "saveDraft" && !contentText.length) {
    return NextResponse.json(
      { success: false, message: "Add submission content before submitting." },
      { status: 400 },
    )
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
    return NextResponse.json({ success: false, message: "Assessment not found." }, { status: 404 })
  }

  if (assessment.type !== "ASSIGNMENT") {
    return NextResponse.json(
      { success: false, message: "Only assignments support submissions." },
      { status: 409 },
    )
  }

  if (assessment.offering.enrollments.length === 0) {
    return NextResponse.json(
      { success: false, message: "You are not enrolled in this assessment offering." },
      { status: 403 },
    )
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
