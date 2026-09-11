import { NextResponse } from "next/server"
import { requireRole } from "@/lib/authz"
import { prisma } from "@/lib/prisma"

async function getTeacherStaffId(userId: string) {
  const staff = await prisma.staffProfile.findUnique({ where: { userId }, select: { id: true } })
  return staff?.id ?? null
}

export async function GET() {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response
  const user = auth.user

  const staffId = await getTeacherStaffId(user.id)
  if (!staffId) {
    return NextResponse.json({ message: "Teacher profile not found" }, { status: 404 })
  }

  const submissions = await prisma.submission.findMany({
    where: {
      assessment: {
        offering: { teacherId: staffId },
      },
    },
    select: {
      id: true,
      status: true,
      contentText: true,
      submittedAt: true,
      gradedAt: true,
      feedback: true,
      student: {
        select: {
          id: true,
          fullName: true,
          registerNumber: true,
          user: { select: { email: true } },
        },
      },
      assessment: {
        select: {
          id: true,
          title: true,
          type: true,
          dueDate: true,
          maxMarks: true,
          offering: {
            select: {
              term: true,
              academicYear: true,
              classRoom: { select: { name: true, section: true } },
              course: { select: { code: true, name: true } },
            },
          },
          grades: { select: { studentId: true, marksObtained: true } },
        },
      },
    },
    orderBy: [{ submittedAt: "desc" }, { updatedAt: "desc" }],
    take: 300,
  })

  return NextResponse.json({
    submissions: submissions.map((item) => {
      const score = item.assessment.grades.find((grade) => grade.studentId === item.student.id)
      return {
        id: item.id,
        status: item.status,
        contentText: item.contentText,
        submittedAt: item.submittedAt?.toISOString() ?? null,
        gradedAt: item.gradedAt?.toISOString() ?? null,
        feedback: item.feedback,
        student: {
          id: item.student.id,
          fullName: item.student.fullName,
          registerNumber: item.student.registerNumber,
          email: item.student.user.email,
        },
        assessment: {
          id: item.assessment.id,
          title: item.assessment.title,
          type: item.assessment.type === "QUIZ" ? "Quiz" : "Assignment",
          dueDate: item.assessment.dueDate.toISOString(),
          maxMarks: item.assessment.maxMarks,
          courseCode: item.assessment.offering.course.code,
          courseName: item.assessment.offering.course.name,
          className: `${item.assessment.offering.classRoom.name}${item.assessment.offering.classRoom.section ? ` ${item.assessment.offering.classRoom.section}` : ""}`,
          term: item.assessment.offering.term,
          academicYear: item.assessment.offering.academicYear,
        },
        score: score ? Number(score.marksObtained) : null,
      }
    }),
  })
}

export async function PUT(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response
  const user = auth.user

  const staffId = await getTeacherStaffId(user.id)
  if (!staffId) {
    return NextResponse.json(
      { success: false, message: "Teacher profile not found" },
      { status: 404 },
    )
  }

  let body: {
    submissionId?: string
    score?: number | string | null
    feedback?: string
  }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 })
  }

  // Partial-update semantics (bug-fix run 3, S-1): only a field the request
  // actually carries is written. An omitted `score` must never be read as an
  // explicit `null` (which deliberately un-grades).
  const hasScore = Object.prototype.hasOwnProperty.call(body, "score")
  const hasFeedback = Object.prototype.hasOwnProperty.call(body, "feedback")

  const submissionId = String(body.submissionId ?? "").trim()
  const rawScore = body.score

  if (!submissionId) {
    return NextResponse.json(
      { success: false, message: "Submission is required." },
      { status: 400 },
    )
  }

  if (!hasScore && !hasFeedback) {
    return NextResponse.json(
      { success: false, message: "Provide a score or feedback to update." },
      { status: 400 },
    )
  }

  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      studentId: true,
      assessmentId: true,
      assessment: {
        select: {
          title: true,
          maxMarks: true,
          offering: { select: { teacherId: true } },
        },
      },
    },
  })

  if (!submission || submission.assessment.offering.teacherId !== staffId) {
    return NextResponse.json({ success: false, message: "Submission not found." }, { status: 404 })
  }

  const score =
    rawScore === null || rawScore === undefined || rawScore === "" ? null : Number(rawScore)

  if (
    hasScore &&
    score !== null &&
    (!Number.isFinite(score) || score < 0 || score > submission.assessment.maxMarks)
  ) {
    return NextResponse.json(
      { success: false, message: `Score must be between 0 and ${submission.assessment.maxMarks}.` },
      { status: 400 },
    )
  }

  await prisma.$transaction(async (tx) => {
    if (hasScore && score !== null) {
      await tx.assessmentGrade.upsert({
        where: {
          assessmentId_studentId: {
            assessmentId: submission.assessmentId,
            studentId: submission.studentId,
          },
        },
        create: {
          assessmentId: submission.assessmentId,
          studentId: submission.studentId,
          marksObtained: score,
          gradedAt: new Date(),
        },
        update: {
          marksObtained: score,
          gradedAt: new Date(),
        },
      })
    }

    const data: {
      status?: "SUBMITTED" | "GRADED"
      gradedAt?: Date | null
      gradedById?: string | null
      feedback?: string | null
    } = {}

    if (hasScore) {
      data.status = score === null ? "SUBMITTED" : "GRADED"
      data.gradedAt = score === null ? null : new Date()
      data.gradedById = score === null ? null : staffId
    }
    if (hasFeedback) {
      const feedback = String(body.feedback ?? "").trim()
      data.feedback = feedback.length ? feedback.slice(0, 1000) : null
    }

    await tx.submission.update({ where: { id: submission.id }, data })
  })

  return NextResponse.json({
    success: true,
    message: `Updated grading for ${submission.assessment.title}.`,
  })
}
