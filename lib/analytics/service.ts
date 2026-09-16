import type { AuthUser } from "@/lib/session"
import type {
  AnalyticsAssessmentSummary,
  AnalyticsOfferingSummary,
  AnalyticsSettingsResponse,
  AssessmentItemAnalysisResponse,
  ItemAnalysisResponse,
  RetakableAssessment,
  TeacherAnalyticsOverviewResponse,
} from "@/lib/contracts/analytics"
import { updateAnalyticsSettingsRequestSchema } from "@/lib/contracts/analytics"
import type { Prisma } from "@/lib/generated/prisma/client"
import { summarizeContributions } from "@/lib/groups/contribution"
import { prisma } from "@/lib/prisma"
import { serializeQuestionForStudent } from "@/lib/quiz-generation/serialize"

import {
  evaluateInterventionAlerts,
  type InterventionAlert,
  type InterventionThresholds,
} from "./alerts"
import { buildCohortDistribution, type CohortDistribution, type CohortScore } from "./cohort"
import { gatherRegimeInputs } from "./grading-regime"
import { buildRosterForOffering } from "./at-risk"
import { buildTrendForOffering } from "./trend"
import { resolveRegimeForCourse } from "./grading-bands"
import {
  loadOwnedAssessment,
  loadOwnedOffering,
  resolveStudentProfile,
  resolveTeacherStaffId,
} from "./authz"
import { AnalyticsError } from "./errors"
import { analyzeItem, type ItemAnalysisThresholds } from "./item-analysis"
import { selectAdaptiveRetakeQuestions } from "./retake"
import {
  mergeAnalyticsSettings,
  readAnalyticsSettings,
  resolveInterventionThresholds,
  resolveItemAnalysisThresholds,
} from "./settings"

/**
 * DB-backed analytics service.
 *
 * This module is the only place `QuizAttempt` / `QuizResponse` rows are read
 * for analytics, and it is server-only (it imports Prisma). Every function
 * takes the signed-in `AuthUser` and resolves ownership through `./authz`
 * before reading anything, so a teacher cannot see another teacher's offering
 * and a student only ever sees their own attempts.
 */

const FINALIZED_STATUSES = ["SUBMITTED", "GRADED"] as const

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function selectLatestAttempts<T extends { studentId: string; attemptNumber: number }>(
  attempts: readonly T[],
): T[] {
  const byStudent = new Map<string, T>()
  for (const attempt of attempts) {
    const existing = byStudent.get(attempt.studentId)
    if (!existing || attempt.attemptNumber >= existing.attemptNumber) {
      byStudent.set(attempt.studentId, attempt)
    }
  }
  return [...byStudent.values()]
}

type AttemptWithResponses = {
  responses: readonly { questionId: string; isCorrect: boolean | null; pointsAwarded: unknown }[]
  maxScore: unknown
}

function attemptTotal(attempt: AttemptWithResponses): number {
  return attempt.responses.reduce((sum, response) => sum + toNumber(response.pointsAwarded), 0)
}

function attemptPercentage(attempt: AttemptWithResponses, fallbackMaxScore: number): number {
  const maxScore = toNumber(attempt.maxScore) || fallbackMaxScore
  if (maxScore <= 0) return 0
  const percentage = (attemptTotal(attempt) / maxScore) * 100
  return round2(Math.max(0, Math.min(100, percentage)))
}

function readOptionIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === "string")
}

// ---------------------------------------------------------------------------
// Teacher overview
// ---------------------------------------------------------------------------

export async function listTeacherOfferingsForAnalytics(
  user: AuthUser,
): Promise<AnalyticsOfferingSummary[]> {
  const staffId = await resolveTeacherStaffId(user)
  const offerings = await prisma.courseOffering.findMany({
    where: { teacherId: staffId },
    orderBy: [{ academicYear: "desc" }, { term: "asc" }],
    select: {
      id: true,
      term: true,
      academicYear: true,
      course: { select: { code: true, name: true } },
      classRoom: { select: { name: true, section: true } },
    },
  })
  return offerings.map((offering) => ({
    id: offering.id,
    courseCode: offering.course.code,
    courseName: offering.course.name,
    className: offering.classRoom.section
      ? `${offering.classRoom.name} ${offering.classRoom.section}`
      : offering.classRoom.name,
    term: offering.term,
    academicYear: offering.academicYear,
  }))
}

export type TeacherAnalyticsOverview = Omit<TeacherAnalyticsOverviewResponse, "success">

export async function getTeacherAnalyticsOverview(
  user: AuthUser,
  options: { offeringId: string; thresholds?: Partial<InterventionThresholds> },
): Promise<TeacherAnalyticsOverview> {
  const offering = await loadOwnedOffering(user, options.offeringId)
  const stored = readAnalyticsSettings(offering.analyticsSettings)
  const offerings = await listTeacherOfferingsForAnalytics(user)

  const assessments = await prisma.assessment.findMany({
    where: { offeringId: offering.id },
    orderBy: { dueDate: "desc" },
    select: {
      id: true,
      title: true,
      type: true,
      dueDate: true,
      maxMarks: true,
      quizAttempts: {
        where: { status: { in: [...FINALIZED_STATUSES] } },
        orderBy: { attemptNumber: "asc" },
        select: {
          id: true,
          studentId: true,
          attemptNumber: true,
          maxScore: true,
          responses: { select: { questionId: true, isCorrect: true, pointsAwarded: true } },
        },
      },
    },
  })

  const summaries: AnalyticsAssessmentSummary[] = assessments.map((assessment) => {
    const latest = selectLatestAttempts(assessment.quizAttempts)
    const scores: CohortScore[] = latest.map((attempt) => ({
      studentId: attempt.studentId,
      percentage: attemptPercentage(attempt, assessment.maxMarks),
    }))
    const cohort = buildCohortDistribution(scores)
    return {
      id: assessment.id,
      title: assessment.title,
      type: assessment.type,
      dueDate: assessment.dueDate.toISOString(),
      maxMarks: assessment.maxMarks,
      attemptCount: latest.length,
      average: cohort.average,
      passRate: cohort.passRate,
    }
  })

  const groups = await prisma.group.findMany({
    where: { offeringId: offering.id },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      members: { select: { studentId: true, student: { select: { fullName: true } } } },
      contributionEvents: {
        select: { studentId: true, type: true, weight: true, occurredAt: true },
      },
    },
  })

  const contributionGroups = groups.map((group) => {
    const summaries = new Map(
      summarizeContributions(
        group.contributionEvents.map((event) => ({
          studentId: event.studentId,
          type: event.type,
          weight: event.weight,
          occurredAt: event.occurredAt,
        })),
      ).map((summary) => [summary.studentId, summary]),
    )
    return {
      offeringId: offering.id,
      groupId: group.id,
      groupName: group.name,
      members: group.members.map((member) => {
        const summary = summaries.get(member.studentId)
        return {
          studentId: member.studentId,
          fullName: member.student.fullName,
          weight: summary?.totalWeight ?? 0,
          eventCount: summary?.eventCount ?? 0,
        }
      }),
    }
  })

  const pendingCount = await prisma.gradeReview.count({
    where: {
      status: { in: ["PENDING", "NEEDS_REVIEW"] },
      assessment: { offeringId: offering.id },
    },
  })

  const alerts: InterventionAlert[] = evaluateInterventionAlerts(
    {
      classAverages: summaries.map((summary) => ({
        offeringId: offering.id,
        assessmentId: summary.id,
        assessmentTitle: summary.title,
        average: summary.average,
        sampleSize: summary.attemptCount,
      })),
      contributionGroups,
      pendingReviews: { offeringId: offering.id, pendingCount },
    },
    { ...(stored.intervention ?? {}), ...options.thresholds },
  )

  // The regime is resolved from the offering's own numbers, so this page can say which
  // banding is in force — and explain it when the answer is a fallback rather than
  // silently substituting one for the other.
  //
  // The roster and the trend ride the same payload rather than a second request, because the
  // page already fetches per offering and a switch would otherwise cost two more round trips.
  // Each does its own queries; ownership was checked above.
  const [regimeInputs, atRisk, trend] = await Promise.all([
    gatherRegimeInputs(offering.id),
    buildRosterForOffering(offering.id),
    buildTrendForOffering(offering.id),
  ])
  const regimeDecision = resolveRegimeForCourse(regimeInputs)

  return {
    offerings,
    offeringId: offering.id,
    assessments: summaries,
    alerts,
    thresholds: resolveInterventionThresholds(stored, options.thresholds),
    gradingRegime: {
      regime: regimeDecision.regime,
      reason: regimeDecision.regime === "absolute" ? regimeDecision.reason : null,
      category: regimeInputs.category,
      enrolledCount: regimeInputs.enrolledCount,
      publishedCount: regimeInputs.publishedTotals.length,
      mean: regimeDecision.regime === "relative" ? regimeDecision.mean : null,
      standardDeviation:
        regimeDecision.regime === "relative" ? regimeDecision.standardDeviation : null,
      // The contract carries `progress` as explicit null, while `GradingNotice` omits it
      // when absent. Normalised here rather than loosened in the contract, because a client
      // branching on "has progress" should not have to handle `undefined` as well.
      notice:
        regimeDecision.regime === "absolute"
          ? { ...regimeDecision.notice, progress: regimeDecision.notice.progress ?? null }
          : null,
    },
    atRisk: {
      boundary: atRisk.boundary,
      regime: atRisk.regime,
      publishedCount: atRisk.publishedCount,
      enrolledCount: atRisk.enrolledCount,
      aboveBoundaryCount: atRisk.aboveBoundaryCount,
      atRisk: atRisk.atRisk,
    },
    trend: { series: trend.series, markedCount: trend.markedCount },
    generatedAt: new Date().toISOString(),
  }
}

/**
 * Persist per-offering analytics thresholds. Merged into any existing settings
 * so updating intervention thresholds does not drop item-analysis thresholds;
 * a missing key keeps the code default (never a null). Returns the effective
 * thresholds after defaults are applied.
 */
export async function updateAnalyticsSettingsForTeacher(
  user: AuthUser,
  input: unknown,
): Promise<AnalyticsSettingsResponse> {
  const request = updateAnalyticsSettingsRequestSchema.parse(input)
  const offering = await loadOwnedOffering(user, request.offeringId)
  const current = readAnalyticsSettings(offering.analyticsSettings)
  const merged = mergeAnalyticsSettings(current, request.settings)

  await prisma.courseOffering.update({
    where: { id: offering.id },
    data: { analyticsSettings: merged as Prisma.InputJsonValue },
  })

  return {
    success: true,
    offeringId: offering.id,
    settings: merged,
    thresholds: {
      intervention: resolveInterventionThresholds(merged),
      itemAnalysis: resolveItemAnalysisThresholds(merged),
    },
  }
}

/** Read the persisted per-offering analytics settings plus effective thresholds. */
export async function getAnalyticsSettingsForTeacher(
  user: AuthUser,
  offeringId: string,
): Promise<AnalyticsSettingsResponse> {
  const offering = await loadOwnedOffering(user, offeringId)
  const settings = readAnalyticsSettings(offering.analyticsSettings)
  return {
    success: true,
    offeringId: offering.id,
    settings,
    thresholds: {
      intervention: resolveInterventionThresholds(settings),
      itemAnalysis: resolveItemAnalysisThresholds(settings),
    },
  }
}

// ---------------------------------------------------------------------------
// Item analysis
// ---------------------------------------------------------------------------

export type AssessmentAnalytics = Omit<AssessmentItemAnalysisResponse, "success">

export async function getAssessmentItemAnalysisForTeacher(
  user: AuthUser,
  options: { assessmentId: string; thresholds?: Partial<ItemAnalysisThresholds> },
): Promise<AssessmentAnalytics> {
  const assessment = await loadOwnedAssessment(user, options.assessmentId)
  const offeringSettings = await prisma.courseOffering.findUnique({
    where: { id: assessment.offeringId },
    select: { analyticsSettings: true },
  })
  const stored = readAnalyticsSettings(offeringSettings?.analyticsSettings)
  // Persisted per-offering settings are the middle layer: code default <-
  // offering setting <- per-request override.
  const thresholds: ItemAnalysisThresholds = resolveItemAnalysisThresholds(
    stored,
    options.thresholds,
  )

  const [questions, attempts] = await Promise.all([
    prisma.question.findMany({
      where: { assessmentId: assessment.id },
      orderBy: { order: "asc" },
      select: { id: true, order: true, prompt: true, subtopic: true },
    }),
    prisma.quizAttempt.findMany({
      where: { assessmentId: assessment.id, status: { in: [...FINALIZED_STATUSES] } },
      orderBy: { attemptNumber: "asc" },
      select: {
        id: true,
        studentId: true,
        attemptNumber: true,
        maxScore: true,
        responses: { select: { questionId: true, isCorrect: true, pointsAwarded: true } },
      },
    }),
  ])

  const latest = selectLatestAttempts(attempts)
  const studentTotals = new Map<string, number>()
  const responsesByStudent = new Map<string, Map<string, boolean | null>>()
  for (const attempt of latest) {
    studentTotals.set(attempt.studentId, attemptTotal(attempt))
    const byQuestion = new Map<string, boolean | null>()
    for (const response of attempt.responses) {
      byQuestion.set(response.questionId, response.isCorrect)
    }
    responsesByStudent.set(attempt.studentId, byQuestion)
  }

  const items: ItemAnalysisResponse[] = questions.map((question) => {
    const responses = latest.map((attempt) => ({
      studentId: attempt.studentId,
      isCorrect: responsesByStudent.get(attempt.studentId)?.get(question.id) ?? null,
    }))
    const analysis = analyzeItem({
      questionId: question.id,
      responses,
      studentTotals,
      thresholds,
    })
    return {
      ...analysis,
      questionOrder: question.order,
      prompt: question.prompt,
      subtopic: question.subtopic ?? null,
    }
  })

  const scores: CohortScore[] = latest.map((attempt) => ({
    studentId: attempt.studentId,
    percentage: attemptPercentage(attempt, assessment.maxMarks),
  }))
  const cohort: CohortDistribution = buildCohortDistribution(scores)

  return {
    assessment: {
      id: assessment.id,
      title: assessment.title,
      offeringId: assessment.offeringId,
      maxMarks: assessment.maxMarks,
      studentCount: latest.length,
    },
    cohort,
    items,
    thresholds,
    generatedAt: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Adaptive retake (student)
// ---------------------------------------------------------------------------

export async function listStudentRetakableAssessmentsForStudent(
  user: AuthUser,
): Promise<RetakableAssessment[]> {
  const student = await resolveStudentProfile(user)
  const assessments = await prisma.assessment.findMany({
    where: {
      offering: { enrollments: { some: { studentId: student.studentId, status: "active" } } },
      quizAttempts: {
        some: { studentId: student.studentId, status: { in: [...FINALIZED_STATUSES] } },
      },
    },
    orderBy: { dueDate: "desc" },
    select: {
      id: true,
      title: true,
      offeringId: true,
      maxMarks: true,
      offering: { select: { course: { select: { code: true, name: true } } } },
      questions: { orderBy: { order: "asc" }, select: { id: true } },
      quizAttempts: {
        where: { studentId: student.studentId, status: { in: [...FINALIZED_STATUSES] } },
        orderBy: { attemptNumber: "asc" },
        select: {
          id: true,
          attemptNumber: true,
          responses: { select: { questionId: true, isCorrect: true } },
        },
      },
    },
  })

  return assessments.map((assessment) => {
    const latest = assessment.quizAttempts.at(-1)
    const selection = selectAdaptiveRetakeQuestions({
      questionIds: assessment.questions.map((question) => question.id),
      responses: latest?.responses ?? [],
    })
    return {
      id: assessment.id,
      title: assessment.title,
      offeringId: assessment.offeringId,
      courseCode: assessment.offering.course.code,
      courseName: assessment.offering.course.name,
      maxMarks: assessment.maxMarks,
      failedCount: selection.failedQuestionIds.length,
      unansweredCount: selection.unansweredQuestionIds.length,
    }
  })
}

export type AdaptiveRetake = {
  assessment: { id: string; title: string; maxMarks: number }
  sourceAttemptId: string | null
  totalQuestions: number
  questionIds: string[]
  failedQuestionIds: string[]
  unansweredQuestionIds: string[]
  includeUnanswered: boolean
  questions: ReturnType<typeof serializeQuestionForStudent>[]
  previousResponses: {
    questionId: string
    selectedOptionIds: string[]
    isCorrect: boolean | null
  }[]
  generatedAt: string
}

export async function getAdaptiveRetakeForStudent(
  user: AuthUser,
  options: { assessmentId: string; includeUnanswered?: boolean },
): Promise<AdaptiveRetake> {
  const student = await resolveStudentProfile(user)

  const assessment = await prisma.assessment.findUnique({
    where: { id: options.assessmentId },
    select: {
      id: true,
      title: true,
      maxMarks: true,
      offeringId: true,
      offering: {
        select: {
          enrollments: {
            where: { studentId: student.studentId, status: "active" },
            select: { id: true },
          },
        },
      },
      questions: {
        orderBy: { order: "asc" },
        include: { options: { orderBy: { order: "asc" } } },
      },
      quizAttempts: {
        where: { studentId: student.studentId, status: { in: [...FINALIZED_STATUSES] } },
        orderBy: { attemptNumber: "asc" },
        select: {
          id: true,
          attemptNumber: true,
          responses: { select: { questionId: true, selectedOptionIds: true, isCorrect: true } },
        },
      },
    },
  })

  if (!assessment) throw new AnalyticsError(404, "Assessment not found.")
  if (assessment.offering.enrollments.length === 0) {
    throw new AnalyticsError(403, "You are not enrolled in this course offering.")
  }

  const latest = assessment.quizAttempts.at(-1)
  const selection = selectAdaptiveRetakeQuestions({
    questionIds: assessment.questions.map((question) => question.id),
    responses: latest?.responses ?? [],
    includeUnanswered: options.includeUnanswered,
  })

  const selected = new Set(selection.questionIds)
  const questions = assessment.questions
    .filter((question) => selected.has(question.id))
    .map((question) => serializeQuestionForStudent(question))

  const responseByQuestion = new Map(
    (latest?.responses ?? []).map((response) => [response.questionId, response]),
  )
  const previousResponses = selection.questionIds.flatMap((questionId) => {
    const response = responseByQuestion.get(questionId)
    if (!response) return []
    return [
      {
        questionId,
        selectedOptionIds: readOptionIds(response.selectedOptionIds),
        isCorrect: response.isCorrect,
      },
    ]
  })

  return {
    assessment: { id: assessment.id, title: assessment.title, maxMarks: assessment.maxMarks },
    sourceAttemptId: latest?.id ?? null,
    totalQuestions: selection.totalQuestions,
    questionIds: selection.questionIds,
    failedQuestionIds: selection.failedQuestionIds,
    unansweredQuestionIds: selection.unansweredQuestionIds,
    includeUnanswered: selection.includeUnanswered,
    questions,
    previousResponses,
    generatedAt: new Date().toISOString(),
  }
}
