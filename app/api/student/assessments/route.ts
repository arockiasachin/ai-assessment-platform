import { NextResponse } from "next/server"
import { requireRole } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import { toAssessmentScale } from "@/lib/gradebook"
import { quizDeliveryStatus } from "@/lib/quiz-attempts/metadata"
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
  const auth = await requireRole("student")
  if (!auth.authorized) return auth.response
  const user = auth.user

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
      finalGrades: {
        where: { publishedAt: { not: null } },
        select: { studentId: true, points: true, maxPoints: true },
      },
      submissions: {
        where: { studentId: student.id },
        select: {
          status: true,
          submittedAt: true,
          gradedAt: true,
          feedback: true,
          contentText: true,
        },
        take: 1,
      },
      questions: {
        select: {
          status: true,
          metadata: true,
          options: { select: { isCorrect: true } },
        },
      },
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
  })

  const payload: StudentAssessmentsPayload = {
    generatedAt: now.toISOString(),
    assessments: assessments.map((assessment) => {
      const ownGrade = assessment.finalGrades.find((grade) => grade.studentId === student.id)
      const score = ownGrade
        ? toAssessmentScale(
            Number(ownGrade.points),
            Number(ownGrade.maxPoints),
            assessment.maxMarks,
          )
        : null
      const percentage =
        ownGrade && Number(ownGrade.maxPoints) > 0
          ? (Number(ownGrade.points) / Number(ownGrade.maxPoints)) * 100
          : null

      const classPercentages = assessment.finalGrades
        .map((grade) =>
          Number(grade.maxPoints) > 0
            ? (Number(grade.points) / Number(grade.maxPoints)) * 100
            : Number.NaN,
        )
        .filter((value) => Number.isFinite(value))

      const classAveragePercentage =
        classPercentages.length > 0
          ? classPercentages.reduce((sum, value) => sum + value, 0) / classPercentages.length
          : null

      const submission = assessment.submissions[0] ?? null
      const state = submissionStateFromDbStatus(submission?.status ?? null)

      // Count only a deliverable question set: a generated draft quiz shows 0
      // questions until its questions are published, exactly as it did before
      // the legacy `Quiz` store was retired.
      const quizQuestionCount =
        assessment.questions.length > 0 && quizDeliveryStatus(assessment.questions).deliverable
          ? assessment.questions.length
          : 0

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
        quizQuestionCount,
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
