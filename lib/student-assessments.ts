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
   * Whether a mark exists at all, released or not.
   *
   * Paired with `published`, this is what separates "not marked yet" from
   * "marked but not yet released" — both of which render as `score: null`, and
   * which are different things to tell a student. The mark's *value* is never
   * exposed until it is released; only the fact of its existence.
   */
  hasMark: boolean
  /** Whether that mark has been released, so `score` is populated. */
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
        // `ownGrade !== null` is the discriminator the earlier version computed
        // and then threw away, which made `published: false` mean two different
        // things. The mark's value still never leaves here unless published.
        hasMark: ownGrade !== null,
        published: publishedGrade !== null,
        classAveragePercentage,
        quizQuestionCount,
        submissionState: submissionStateFromDbStatus(submission?.status ?? null),
        submittedAt: submission?.submittedAt?.toISOString() ?? null,
        gradedAt: submission?.gradedAt?.toISOString() ?? null,
        // Feedback is withheld until the mark is released, matching the design's
        // rule that a student sees nothing about an assessment's outcome before
        // publication. A teacher can write feedback with no score attached, so
        // this is reachable without a grade row.
        feedback: publishedGrade !== null ? (submission?.feedback ?? null) : null,
        submissionContent: submission?.contentText ?? null,
        daysUntilDue: Math.ceil((dueTime - now.getTime()) / dayMs),
        isPastDue: dueTime < now.getTime(),
      }
    }),
  }
}
