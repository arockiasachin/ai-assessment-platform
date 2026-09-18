import "server-only"

import {
  absoluteLetter,
  resolveRegimeForCourse,
  type RegimeDecision,
  type RelativeLetter,
} from "@/lib/analytics/grading-bands"
import { gatherRegimeInputs } from "@/lib/analytics/grading-regime"
import { buildTrendForOffering, type CohortTrend } from "@/lib/analytics/trend"
import { liveEnrollmentStatuses } from "@/lib/enrollment-scope"
import type { AssessmentType } from "@/lib/generated/prisma/enums"
import { studentRegimeNote, type StudentRegimeNote } from "@/lib/grading/regime-view"
import { FINALIZED_STATUSES, GRADED } from "@/lib/quiz-attempts/kinds"
import { publishedQuizQuestions } from "@/lib/quiz-attempts/metadata"
import { prisma } from "@/lib/prisma"
import { listStudentCourseOutcomes, type StudentCourseOutcome } from "@/lib/student-course-outcome"
import { MIN_COHORT_FOR_CLASS_AVERAGE } from "@/lib/student-assessments"
import {
  buildAssessmentComparisons,
  buildTopicMastery,
  focusDistribution,
  positionLetter,
  publishedScoresByAssessment,
  visibleComparisons,
  type AssessmentComparison,
  type AssessmentMarkState,
  type TopicMasteryBreakdown,
} from "@/lib/student-analytics-view"
import type { AuthUser } from "@/lib/session"

export type { AssessmentComparison, TopicMasteryBreakdown }

/** One enrolled course, with every analytics section the data supports. */
export type StudentAnalyticsCourse = {
  offeringId: string
  courseId: string
  courseCode: string
  courseName: string
  term: string
  academicYear: number
  /** ISO, or `null` when the offering carries no boundary. */
  endsOn: string | null
  ended: boolean
  /** The regime decision, so the page can say which scale every number below uses. */
  regime: RegimeDecision
  regimeNote: StudentRegimeNote
  /**
   * The per-course verdict from `lib/student-course-outcome.ts`, or `null` when that reader
   * returned nothing for an enrollment this one saw (a concurrent enrollment change). The page
   * says "cannot say" rather than fabricating a verdict.
   */
  outcome: StudentCourseOutcome | null
  /** Per-assessment comparison rows, already filtered to the ones with data. */
  comparisons: AssessmentComparison[]
  /** The assessment the distribution card charts, or `null` when none qualifies. */
  distribution: AssessmentComparison | null
  /**
   * The band the student's own mark falls in **on the distribution's absolute scale**, or
   * `null`. This is a per-assessment position, so it is labelled as the histogram's scale
   * rather than as an awarded course letter.
   */
  distributionLetter: RelativeLetter | null
  /** The cohort's weekly trend. Render only when `hasTrendData(series)`. */
  trend: CohortTrend
  /**
   * Per-topic mastery over the student's own graded sittings in this course, or `null` when
   * they have no finalized quiz attempt here — no evidence is not 0% mastery.
   */
  topics: TopicMasteryBreakdown | null
  /**
   * The letter the student's **course grand total** falls in under this course's regime, or
   * `null` when the total cannot be stated (usually an unpublished FAT). A VIT letter is
   * awarded on the grand total, so this — not `distributionLetter` — is the course letter.
   */
  grandTotalLetter: RelativeLetter | null
}

export type StudentAnalytics = {
  generatedAt: string
  /** The disclosure floor in force, so the page can explain a withheld average. */
  minimumCohort: number
  courses: StudentAnalyticsCourse[]
}

type AssessmentRow = {
  id: string
  offeringId: string
  title: string
  type: AssessmentType
  dueDate: Date
  maxMarks: number
}

type MyGradeRow = {
  assessmentId: string
  points: unknown
  maxPoints: unknown
  publishedAt: Date | null
}

function myMarkState(grade: MyGradeRow | undefined): AssessmentMarkState {
  if (!grade) return "none"
  return grade.publishedAt !== null ? "released" : "withheld"
}

function myPercentage(grade: MyGradeRow | undefined): number | null {
  if (!grade || grade.publishedAt === null) return null
  const points = Number(grade.points)
  const maxPoints = Number(grade.maxPoints)
  if (!Number.isFinite(points) || !Number.isFinite(maxPoints) || maxPoints <= 0) return null
  return (points / maxPoints) * 100
}

/**
 * A student's own analytics, scoped to the courses they are enrolled in.
 *
 * ## Scope comes from the session, never from a caller-supplied id
 *
 * Exactly the shape `lib/student-grading-regime.ts` established: the offering ids come only
 * from the caller's own live enrollments, so there is nothing a caller can point at another
 * student's cohort or another cohort's marks. A user with no student profile gets `null`, and
 * a student with no live enrollment gets an empty course list.
 *
 * ## It composes the ownership-agnostic readers, not the teacher-scoped ones
 *
 * The teacher entry points (`getTeacherAnalyticsOverview`, `getAtRiskRosterForTeacher`, …) run
 * `loadOwnedOffering` and would throw for a student. Behind this module's own enrollment check
 * it calls the *readers* instead — `gatherRegimeInputs`, `resolveRegimeForCourse`,
 * `buildTrendForOffering` and `listStudentCourseOutcomes` — plus the pure builders
 * `buildCohortDistribution` and `selectAdaptiveRetakeQuestions`. Nothing here re-implements a
 * rule; if the regime, the trend or the pass verdict changes, every number on the page follows.
 *
 * ## The cohort is published marks only
 *
 * See `lib/student-analytics-view.ts`: the per-assessment cohort is published `Grade` rows,
 * not the teacher's attempt-merged population, because an unreleased mark is not a
 * student-facing fact. `Grade.publishedAt != null` is the predicate the marks pages already
 * use, so the analytics page cannot disagree with them about whether a mark exists.
 */
export async function getStudentAnalytics(
  user: AuthUser,
  options: { now?: Date } = {},
): Promise<StudentAnalytics | null> {
  const now = options.now ?? new Date()

  const student = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (!student) return null

  const enrollments = await prisma.enrollment.findMany({
    where: { studentId: student.id, status: { in: liveEnrollmentStatuses() } },
    select: {
      offering: {
        select: {
          id: true,
          courseId: true,
          term: true,
          academicYear: true,
          startsOn: true,
          endsOn: true,
          course: { select: { code: true, name: true } },
        },
      },
    },
  })

  if (enrollments.length === 0) {
    return {
      generatedAt: now.toISOString(),
      minimumCohort: MIN_COHORT_FOR_CLASS_AVERAGE,
      courses: [],
    }
  }

  // Deterministic order, the same shape the outcome reader uses: newest year first, then term,
  // then course code. `findMany` without an `orderBy` has no guaranteed order, which would make
  // the page reorder itself between requests.
  enrollments.sort(
    (a, b) =>
      b.offering.academicYear - a.offering.academicYear ||
      a.offering.term.localeCompare(b.offering.term) ||
      a.offering.course.code.localeCompare(b.offering.course.code),
  )

  const offeringIds = enrollments.map((enrollment) => enrollment.offering.id)

  const [
    assessments,
    publishedGrades,
    myGrades,
    questionRows,
    attemptRows,
    outcomes,
    regimes,
    trends,
  ] = await Promise.all([
    prisma.assessment.findMany({
      where: { offeringId: { in: offeringIds } },
      orderBy: [{ offeringId: "asc" }, { dueDate: "asc" }],
      select: {
        id: true,
        offeringId: true,
        title: true,
        type: true,
        dueDate: true,
        maxMarks: true,
      },
    }),
    // The cohort: published only. Never widened to unpublished rows.
    prisma.grade.findMany({
      where: { assessment: { offeringId: { in: offeringIds } }, publishedAt: { not: null } },
      select: { assessmentId: true, studentId: true, points: true, maxPoints: true },
    }),
    // The student's own rows **including unpublished**, so the page can tell "not released
    // yet" from "not marked". Only the published value is ever rendered.
    prisma.grade.findMany({
      where: { studentId: student.id, assessment: { offeringId: { in: offeringIds } } },
      select: { assessmentId: true, points: true, maxPoints: true, publishedAt: true },
    }),
    prisma.question.findMany({
      where: { assessment: { offeringId: { in: offeringIds } } },
      orderBy: [{ assessmentId: "asc" }, { order: "asc" }],
      select: { id: true, assessmentId: true, subtopic: true, status: true, metadata: true },
    }),
    prisma.quizAttempt.findMany({
      where: {
        studentId: student.id,
        status: { in: [...FINALIZED_STATUSES] },
        kind: GRADED,
        assessment: { offeringId: { in: offeringIds } },
      },
      orderBy: [{ assessmentId: "asc" }, { attemptNumber: "asc" }],
      select: {
        id: true,
        assessmentId: true,
        attemptNumber: true,
        responses: { select: { questionId: true, isCorrect: true } },
      },
    }),
    listStudentCourseOutcomes(user, { now }),
    Promise.all(enrollments.map(({ offering }) => gatherRegimeInputs(offering.id))),
    Promise.all(enrollments.map(({ offering }) => buildTrendForOffering(offering.id))),
  ])

  const scoresByAssessment = publishedScoresByAssessment(
    publishedGrades.map((grade) => ({
      assessmentId: grade.assessmentId,
      studentId: grade.studentId,
      points: Number(grade.points),
      maxPoints: Number(grade.maxPoints),
    })),
  )

  const myGradeByAssessment = new Map<string, MyGradeRow>(
    myGrades.map((grade) => [grade.assessmentId, grade]),
  )
  const outcomeByOffering = new Map(outcomes.map((outcome) => [outcome.offeringId, outcome]))

  const assessmentsByOffering = new Map<string, AssessmentRow[]>()
  for (const assessment of assessments) {
    const rows = assessmentsByOffering.get(assessment.offeringId)
    if (rows) rows.push(assessment)
    else assessmentsByOffering.set(assessment.offeringId, [assessment])
  }

  // Published questions per assessment, so a draft is never counted as part of a quiz (TN-41).
  // The draft/published filter runs on the full rows (it reads `status`/`metadata`), then only
  // the fields the mastery grouping needs are kept.
  const publishedQuestionsByAssessment = new Map<
    string,
    { id: string; subtopic: string | null }[]
  >()
  for (const question of publishedQuizQuestions(questionRows)) {
    const rows = publishedQuestionsByAssessment.get(question.assessmentId)
    if (rows) rows.push({ id: question.id, subtopic: question.subtopic })
    else
      publishedQuestionsByAssessment.set(question.assessmentId, [
        { id: question.id, subtopic: question.subtopic },
      ])
  }

  // The latest finalized graded sitting per assessment — the same "latest attempt" rule the
  // retake reader uses. Ordered ascending, so the last row wins.
  const latestAttemptByAssessment = new Map<string, (typeof attemptRows)[number]>()
  for (const attempt of attemptRows) {
    latestAttemptByAssessment.set(attempt.assessmentId, attempt)
  }

  const courses: StudentAnalyticsCourse[] = enrollments.map(({ offering }, index) => {
    const decision = resolveRegimeForCourse(regimes[index])
    const offeringAssessments = assessmentsByOffering.get(offering.id) ?? []

    const comparisons = visibleComparisons(
      buildAssessmentComparisons(
        offeringAssessments.map((assessment) => {
          const myGrade = myGradeByAssessment.get(assessment.id)
          return {
            id: assessment.id,
            title: assessment.title,
            dueDate: assessment.dueDate.toISOString(),
            maxMarks: assessment.maxMarks,
            scores: scoresByAssessment.get(assessment.id) ?? [],
            yourPercentage: myPercentage(myGrade),
            yourMarkState: myMarkState(myGrade),
          }
        }),
        MIN_COHORT_FOR_CLASS_AVERAGE,
      ),
    )

    const distribution = focusDistribution(comparisons)
    const distributionLetter =
      distribution?.yourPercentage != null ? absoluteLetter(distribution.yourPercentage) : null

    const topics = buildCourseTopicMastery(
      offeringAssessments,
      publishedQuestionsByAssessment,
      latestAttemptByAssessment,
    )
    const outcome = outcomeByOffering.get(offering.id) ?? null

    return {
      offeringId: offering.id,
      courseId: offering.courseId,
      courseCode: offering.course.code,
      courseName: offering.course.name,
      term: offering.term,
      academicYear: offering.academicYear,
      endsOn: offering.endsOn?.toISOString() ?? null,
      ended: offering.endsOn !== null && offering.endsOn.getTime() <= now.getTime(),
      regime: decision,
      regimeNote: studentRegimeNote(decision),
      outcome,
      comparisons,
      distribution,
      distributionLetter,
      trend: trends[index],
      topics,
      grandTotalLetter: positionLetter(outcome?.grandTotal ?? null, decision),
    }
  })

  return {
    generatedAt: now.toISOString(),
    minimumCohort: MIN_COHORT_FOR_CLASS_AVERAGE,
    courses,
  }
}

/**
 * Topic mastery for one course, from the student's own finalized quiz sittings.
 *
 * Only assessments the student actually has a finalized graded attempt on are passed to the
 * builder, and only their **published** questions. A quiz with no attempt is omitted rather
 * than reported as 0% — that would be absence rendered as a number.
 */
function buildCourseTopicMastery(
  assessments: readonly AssessmentRow[],
  publishedQuestionsByAssessment: ReadonlyMap<string, { id: string; subtopic: string | null }[]>,
  latestAttemptByAssessment: ReadonlyMap<
    string,
    { responses: readonly { questionId: string; isCorrect: boolean | null }[] }
  >,
): TopicMasteryBreakdown | null {
  const inputs = assessments
    .filter((assessment) => assessment.type === "QUIZ")
    .flatMap((assessment) => {
      const attempt = latestAttemptByAssessment.get(assessment.id)
      if (!attempt) return []
      const questions = publishedQuestionsByAssessment.get(assessment.id) ?? []
      if (questions.length === 0) return []
      return [{ questions, responses: attempt.responses }]
    })

  if (inputs.length === 0) return null
  return buildTopicMastery({ assessments: inputs })
}
