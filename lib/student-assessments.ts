import "server-only"

import { toAssessmentScale } from "@/lib/gradebook"
import { prisma } from "@/lib/prisma"
import { quizDeliveryStatus } from "@/lib/quiz-attempts/metadata"
import type { AuthUser } from "@/lib/session"

export type AssessmentKind = "Quiz" | "Assignment"
export type SubmissionState =
  "not_submitted" | "draft" | "submitted" | "resubmitted" | "graded" | "late"

export type StudentAssessmentItem = {
  id: string
  title: string
  type: AssessmentKind
  dueDate: string
  maxMarks: number
  courseId: string
  courseCode: string
  courseName: string
  className: string
  term: string
  academicYear: number
  teacherName: string
  score: number | null
  percentage: number | null
  /**
   * Whether the student's own mark has been released.
   *
   * Distinguishes "marked but not yet released" from "not marked at all" — both
   * of which otherwise render as `score: null`, and they are different facts to
   * put in front of a student.
   */
  published: boolean
  classAveragePercentage: number | null
  quizQuestionCount: number
  submissionState: SubmissionState
  submittedAt: string | null
  gradedAt: string | null
  feedback: string | null
  submissionContent: string | null
  daysUntilDue: number
  isPastDue: boolean
}

export type StudentAssessmentsPayload = {
  generatedAt: string
  assessments: StudentAssessmentItem[]
}

/** Map a stored submission status onto the view-model vocabulary. */
function submissionStateFromDbStatus(status: string | null): SubmissionState {
  if (status === "DRAFT") return "draft"
  if (status === "SUBMITTED") return "submitted"
  if (status === "RESUBMITTED") return "resubmitted"
  if (status === "GRADED") return "graded"
  if (status === "LATE") return "late"
  return "not_submitted"
}

/**
 * The student's assessment list.
 *
 * Extracted from `app/api/student/assessments/route.ts`, which used to hold this
 * query inline with a client `useEffect` as its only consumer. A server component
 * cannot call a route handler, so the port needed the query to live somewhere
 * both can reach — and pulling it out is what lets the page render from props
 * instead of fetching on mount (`docs/quality/a11y-perf-audit.md`, the deferred
 * P1 finding).
 *
 * `finalGrades` is deliberately **not** filtered to published rows: `score` and
 * `percentage` are still computed from the student's *published* grade only, so
 * nothing unpublished can leak, but the extra `published` flag means the UI can
 * tell "marked, not yet released" apart from "not marked" — two states that both
 * otherwise render as `null`.
 *
 * Returns `null` when the user has no student profile, which the route surfaces
 * as a 404.
 */
export async function listStudentAssessments(
  user: AuthUser,
): Promise<StudentAssessmentsPayload | null> {
  const student = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (!student) return null

  const now = new Date()

  const assessments = await prisma.assessment.findMany({
    where: {
      offering: {
        enrollments: {
          some: { studentId: student.id, status: { in: ["active", "waitlisted"] } },
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
        select: { studentId: true, points: true, maxPoints: true, publishedAt: true },
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
        select: { status: true, metadata: true, options: { select: { isCorrect: true } } },
      },
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
  })

  const dayMs = 1000 * 60 * 60 * 24

  return {
    generatedAt: now.toISOString(),
    assessments: assessments.map((assessment) => {
      const ownGrade = assessment.finalGrades.find((grade) => grade.studentId === student.id)
      // Published only: an unreleased mark is not a student-facing fact.
      const publishedGrade = ownGrade?.publishedAt != null ? ownGrade : null

      const score =
        publishedGrade && Number(publishedGrade.maxPoints) > 0
          ? toAssessmentScale(
              Number(publishedGrade.points),
              Number(publishedGrade.maxPoints),
              assessment.maxMarks,
            )
          : null
      const percentage =
        publishedGrade && Number(publishedGrade.maxPoints) > 0
          ? (Number(publishedGrade.points) / Number(publishedGrade.maxPoints)) * 100
          : null

      const classPercentages = assessment.finalGrades
        .filter((grade) => grade.publishedAt != null)
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

      // Count only a deliverable question set: a generated draft quiz shows 0
      // questions until its questions are published, exactly as it did before the
      // legacy `Quiz` store was retired.
      const quizQuestionCount =
        assessment.questions.length > 0 && quizDeliveryStatus(assessment.questions).deliverable
          ? assessment.questions.length
          : 0

      const dueTime = assessment.dueDate.getTime()

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
        published: publishedGrade !== null,
        classAveragePercentage,
        quizQuestionCount,
        submissionState: submissionStateFromDbStatus(submission?.status ?? null),
        submittedAt: submission?.submittedAt?.toISOString() ?? null,
        gradedAt: submission?.gradedAt?.toISOString() ?? null,
        feedback: submission?.feedback ?? null,
        submissionContent: submission?.contentText ?? null,
        daysUntilDue: Math.ceil((dueTime - now.getTime()) / dayMs),
        isPastDue: dueTime < now.getTime(),
      }
    }),
  }
}
