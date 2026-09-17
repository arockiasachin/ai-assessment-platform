import "server-only"

import { releasedAssessmentWhere } from "@/lib/assessment-visibility"
import { liveEnrollmentStatuses } from "@/lib/enrollment-scope"
import { toAssessmentScale } from "@/lib/gradebook"
import { prisma } from "@/lib/prisma"
import { GRADED } from "@/lib/quiz-attempts/kinds"
import { quizDeliveryStatus } from "@/lib/quiz-attempts/metadata"
import type { AssessmentType } from "@/lib/generated/prisma/enums"
import type { AuthUser } from "@/lib/session"

/** Kept as an alias so existing call sites read the same, but it is the Prisma enum now. */
export type AssessmentKind = AssessmentType
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
 * The submission state a graded quiz sitting implies (SN-32).
 *
 * A quiz writes `QuizAttempt`/`QuizResponse` and never a `Submission`, so
 * deriving the state from `Submission` alone reported "Not submitted" for a quiz
 * the student had actually finished — with a released mark next to it.
 *
 * `PRACTICE` sittings are excluded by the caller's query: a practice sitting is
 * not a submission at all. Of the `GRADED` sittings, a finished one outranks one
 * still in progress, because a student who submitted and then opened a retake is
 * a submitter with a retake open, not a draft. `EXPIRED`/`ABANDONED` rows were
 * never submitted, so this returns `null` and the caller's `not_submitted` stays
 * honest rather than becoming a third alias for "submitted".
 */
function submissionStateFromAttempts(
  attempts: readonly { status: string; submittedAt: Date | null }[],
  hasReleasedMark: boolean,
): { state: SubmissionState; submittedAt: Date | null } | null {
  const finished = attempts.find(
    (attempt) => attempt.status === "SUBMITTED" || attempt.status === "GRADED",
  )
  if (finished) {
    return {
      // A released mark is the quiz equivalent of a `GRADED` submission: the
      // attempt row itself never leaves `SUBMITTED`, even after a teacher
      // publishes, so the mark is the only signal that grading is done.
      state: finished.status === "GRADED" || hasReleasedMark ? "graded" : "submitted",
      submittedAt: finished.submittedAt,
    }
  }

  if (attempts.some((attempt) => attempt.status === "IN_PROGRESS")) {
    return { state: "draft", submittedAt: null }
  }

  return null
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
      // Release governs visibility, and this is the assessment-list half of the
      // same rule the gradebook projection applies (`lib/gradebook-db.ts`, the
      // SN-29 fix), `listStudentCalendar` already applied (`lib/calendar.ts`) and
      // the written-submission route now enforces (`app/api/student/…/submission`).
      // The predicate is imported rather than retyped so the student-facing
      // surfaces cannot drift into disagreeing about whether an unreleased
      // assessment exists. This is what makes the planner's "Hidden from students"
      // label true on the student side, where it was previously false (SN-5 / TN-33).
      ...releasedAssessmentWhere(),
      offering: {
        enrollments: {
          some: { studentId: student.id, status: { in: liveEnrollmentStatuses() } },
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
      quizAttempts: {
        // A quiz's submission record is the sitting, not a `Submission` row.
        // `PRACTICE` is recorded for history but is not a submission, so it is
        // excluded here rather than filtered in JS; `GRADED` is the vocabulary's
        // own constant, so this cannot drift from the attempt rules.
        where: { studentId: student.id, kind: GRADED },
        orderBy: { attemptNumber: "desc" },
        select: { status: true, submittedAt: true },
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
      const attemptSubmission = submissionStateFromAttempts(
        assessment.quizAttempts,
        publishedGrade !== null,
      )
      // An assessment's submission record is one or the other: a `Submission`
      // row for the assignment types, a graded `QuizAttempt` for quizzes. The
      // `Submission` row wins if both somehow exist, because it is the explicit
      // record rather than an inference from a sitting.
      const submissionState =
        submission !== null
          ? submissionStateFromDbStatus(submission.status)
          : (attemptSubmission?.state ?? "not_submitted")
      const submittedAt =
        submission !== null ? submission.submittedAt : (attemptSubmission?.submittedAt ?? null)

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
        type: assessment.type,
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
        // `ownGrade` is `undefined`, not `null`, when no grade row exists.
        // `undefined !== null` is true, so the previous expression reported a
        // withheld mark on every assessment — including ones never marked at all
        // (SN-4). The mark's value still never leaves here unless published.
        hasMark: ownGrade !== undefined,
        published: publishedGrade !== null,
        classAveragePercentage,
        quizQuestionCount,
        submissionState,
        submittedAt: submittedAt?.toISOString() ?? null,
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
