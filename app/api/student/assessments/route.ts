import { NextResponse } from "next/server"
import { getSessionUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import type { StudentAssessmentsPayload, SubmissionState } from "@/lib/student-assessments"

function submissionStateFromDbStatus(status: string | null): SubmissionState {
  if (status === "DRAFT") return "draft"
  if (status === "SUBMITTED") return "submitted"
  if (status === "RESUBMITTED") return "resubmitted"
  if (status === "GRADED") return "graded"
  if (status === "LATE") return "late"
  return "not_submitted"
}

export async function GET() {
  const user = await getSessionUser()
  if (!user || user.role !== "student") {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
  }

  const student = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })

  if (!student) {
    return NextResponse.json({ message: "Student profile not found" }, { status: 404 })
  }

  const now = new Date()

  const assessments = await prisma.assessment.findMany({
    where: {
      offering: {
        enrollments: {
          some: {
            studentId: student.id,
            status: { in: ["active", "waitlisted"] },
          },
        },
      },
    },
    select: {
      id: true,
      title: true,
      type: true,
      dueDate: true,
      maxMarks: true,
      courseId: true,
      course: { select: { code: true, name: true } },
      offering: {
        select: {
          term: true,
          academicYear: true,
          classRoom: { select: { name: true, section: true } },
          teacher: { select: { fullName: true } },
        },
      },
      grades: { select: { studentId: true, marksObtained: true } },
      submissions: {
        where: { studentId: student.id },
        select: { status: true, submittedAt: true, gradedAt: true, feedback: true, contentText: true },
        take: 1,
      },
      quiz: {
        select: {
          questions: { select: { id: true } },
        },
      },
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
  })

  const payload: StudentAssessmentsPayload = {
    generatedAt: now.toISOString(),
    assessments: assessments.map((assessment) => {
      const ownGrade = assessment.grades.find((grade) => grade.studentId === student.id)
      const score = ownGrade ? Number(ownGrade.marksObtained) : null
      const percentage = score === null ? null : (score / assessment.maxMarks) * 100

      const classPercentages = assessment.grades
        .map((grade) => (Number(grade.marksObtained) / assessment.maxMarks) * 100)
        .filter((value) => Number.isFinite(value))

      const classAveragePercentage =
        classPercentages.length > 0
          ? classPercentages.reduce((sum, value) => sum + value, 0) / classPercentages.length
          : null

      const submission = assessment.submissions[0] ?? null
      const state = submissionStateFromDbStatus(submission?.status ?? null)

      const dueTime = assessment.dueDate.getTime()
      const dayMs = 1000 * 60 * 60 * 24
      const daysUntilDue = Math.ceil((dueTime - now.getTime()) / dayMs)

      return {
        id: assessment.id,
        title: assessment.title,
        type: assessment.type === "QUIZ" ? "Quiz" : "Assignment",
        dueDate: assessment.dueDate.toISOString(),
        maxMarks: assessment.maxMarks,
        courseId: assessment.courseId,
        courseCode: assessment.course.code,
        courseName: assessment.course.name,
        className: `${assessment.offering.classRoom.name}${assessment.offering.classRoom.section ? ` ${assessment.offering.classRoom.section}` : ""}`,
        term: assessment.offering.term,
        academicYear: assessment.offering.academicYear,
        teacherName: assessment.offering.teacher.fullName,
        score,
        percentage,
        classAveragePercentage,
        quizQuestionCount: assessment.quiz?.questions.length ?? 0,
        submissionState: state,
        submittedAt: submission?.submittedAt?.toISOString() ?? null,
        gradedAt: submission?.gradedAt?.toISOString() ?? null,
        feedback: submission?.feedback ?? null,
        submissionContent: submission?.contentText ?? null,
        daysUntilDue,
        isPastDue: dueTime < now.getTime(),
      }
    }),
  }

  return NextResponse.json(payload)
}
