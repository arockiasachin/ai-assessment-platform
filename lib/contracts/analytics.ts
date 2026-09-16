import { z } from "zod"

import { nonEmptyString } from "./common"
import { generatedQuestionForStudentSchema } from "./quiz-generation"

/**
 * The analytics / item-analysis / intervention / adaptive-retake API contract.
 *
 * Everything here is either derived from real `QuizAttempt` / `QuizResponse`
 * rows (teacher analytics) or is strictly the signed-in student's own data
 * (retake). No schema exposes an answer key: the retake questions use the
 * existing student-facing question shape from `quiz-generation`, which has no
 * `correctOptionId` / `isCorrect` field at all.
 */

// ---------------------------------------------------------------------------
// Thresholds (configurable per request; defaults live in lib/analytics)
// ---------------------------------------------------------------------------

export const itemAnalysisThresholdsSchema = z.object({
  minAttemptsForDifficulty: z.number().int().positive(),
  minAttemptsForDiscrimination: z.number().int().positive(),
  extremeGroupFraction: z.number().positive().max(1),
})
export type ItemAnalysisThresholdsValue = z.infer<typeof itemAnalysisThresholdsSchema>

export const interventionThresholdsSchema = z.object({
  classAverageBelow: z.number(),
  minClassSampleSize: z.number().int().nonnegative(),
  contributionShareAtLeast: z.number().min(0).max(1),
  minContributionEvents: z.number().int().nonnegative(),
  pendingReviewsAtLeast: z.number().int().nonnegative(),
})
export type InterventionThresholdsValue = z.infer<typeof interventionThresholdsSchema>

/**
 * Query-string overrides for the intervention thresholds. Query values arrive
 * as strings, so `z.coerce` parses them; an out-of-range value is a 400 rather
 * than silently clamping.
 */
export const interventionThresholdOverridesSchema = z.object({
  classAverageBelow: z.coerce.number().finite().min(0).max(100).optional(),
  minClassSampleSize: z.coerce.number().int().min(0).max(10000).optional(),
  contributionShareAtLeast: z.coerce.number().finite().min(0).max(1).optional(),
  minContributionEvents: z.coerce.number().int().min(0).max(100000).optional(),
  pendingReviewsAtLeast: z.coerce.number().int().min(0).max(100000).optional(),
})
export type InterventionThresholdOverrides = z.infer<typeof interventionThresholdOverridesSchema>

// ---------------------------------------------------------------------------
// Persisted per-offering settings
// ---------------------------------------------------------------------------

/**
 * Partial thresholds stored on `CourseOffering.analyticsSettings`. Unlike the
 * query-param schema above these are already typed JSON numbers, so no coercion;
 * any omitted key keeps the code default in `lib/analytics/alerts.ts`.
 */
export const interventionThresholdSettingsSchema = z.object({
  classAverageBelow: z.number().finite().min(0).max(100).optional(),
  minClassSampleSize: z.number().int().min(0).max(10000).optional(),
  contributionShareAtLeast: z.number().finite().min(0).max(1).optional(),
  minContributionEvents: z.number().int().min(0).max(100000).optional(),
  pendingReviewsAtLeast: z.number().int().min(0).max(100000).optional(),
})
export type InterventionThresholdSettings = z.infer<typeof interventionThresholdSettingsSchema>

export const itemAnalysisThresholdSettingsSchema = z.object({
  minAttemptsForDifficulty: z.number().int().positive().max(100000).optional(),
  minAttemptsForDiscrimination: z.number().int().positive().max(100000).optional(),
  extremeGroupFraction: z.number().positive().max(1).optional(),
})
export type ItemAnalysisThresholdSettings = z.infer<typeof itemAnalysisThresholdSettingsSchema>

export const analyticsSettingsSchema = z.object({
  intervention: interventionThresholdSettingsSchema.optional(),
  itemAnalysis: itemAnalysisThresholdSettingsSchema.optional(),
})
export type AnalyticsSettingsValue = z.infer<typeof analyticsSettingsSchema>

export const updateAnalyticsSettingsRequestSchema = z.object({
  offeringId: nonEmptyString,
  settings: analyticsSettingsSchema,
})
export type UpdateAnalyticsSettingsRequest = z.infer<typeof updateAnalyticsSettingsRequestSchema>

export const analyticsSettingsResponseSchema = z.object({
  success: z.literal(true),
  offeringId: z.string(),
  settings: analyticsSettingsSchema,
  /** The effective thresholds after code defaults are applied. */
  thresholds: z.object({
    intervention: interventionThresholdsSchema,
    itemAnalysis: itemAnalysisThresholdsSchema,
  }),
})
export type AnalyticsSettingsResponse = z.infer<typeof analyticsSettingsResponseSchema>

// ---------------------------------------------------------------------------
// Item analysis
// ---------------------------------------------------------------------------

export const itemAnalysisResponseSchema = z.object({
  questionId: z.string(),
  questionOrder: z.number().int(),
  prompt: z.string(),
  subtopic: z.string().nullable(),
  attemptCount: z.number().int(),
  answeredCount: z.number().int(),
  correctCount: z.number().int(),
  incorrectCount: z.number().int(),
  unansweredCount: z.number().int(),
  facilityIndex: z.number().nullable(),
  difficultyIndex: z.number().nullable(),
  discriminationIndex: z.number().nullable(),
  discriminationMethod: z.enum(["extreme-groups-27"]).nullable(),
  upperGroupSize: z.number().int(),
  lowerGroupSize: z.number().int(),
  upperCorrect: z.number().int(),
  lowerCorrect: z.number().int(),
  difficultyInsufficientData: z.boolean(),
  discriminationInsufficientData: z.boolean(),
  insufficientData: z.boolean(),
  notes: z.array(z.string()),
})
export type ItemAnalysisResponse = z.infer<typeof itemAnalysisResponseSchema>

// ---------------------------------------------------------------------------
// Cohort distribution
// ---------------------------------------------------------------------------

export const scoreBucketSchema = z.object({
  // VIT's seven performance letters, from the absolute Table-6 bands.
  grade: z.enum(["S", "A", "B", "C", "D", "E", "F"]),
  label: z.string(),
  min: z.number(),
  max: z.number(),
  count: z.number().int(),
})
export type ScoreBucketValue = z.infer<typeof scoreBucketSchema>

export const cohortDistributionSchema = z.object({
  count: z.number().int(),
  average: z.number().nullable(),
  passRate: z.number().nullable(),
  passThreshold: z.number(),
  highest: z.number().nullable(),
  lowest: z.number().nullable(),
  buckets: z.array(scoreBucketSchema),
})
export type CohortDistributionValue = z.infer<typeof cohortDistributionSchema>

// ---------------------------------------------------------------------------
// Intervention alerts
// ---------------------------------------------------------------------------

export const interventionAlertTypeSchema = z.enum([
  "class-average-below-threshold",
  "contribution-imbalance",
  "pending-reviews",
])
export type InterventionAlertTypeValue = z.infer<typeof interventionAlertTypeSchema>

export const interventionAlertSeveritySchema = z.enum(["info", "warning", "critical"])
export type InterventionAlertSeverityValue = z.infer<typeof interventionAlertSeveritySchema>

export const interventionAlertSchema = z.object({
  type: interventionAlertTypeSchema,
  severity: interventionAlertSeveritySchema,
  title: z.string(),
  message: z.string(),
  evidence: z.record(z.string(), z.unknown()),
  relatedIds: z.object({
    offeringId: z.string().nullable(),
    assessmentId: z.string().nullable(),
    groupId: z.string().nullable(),
    studentId: z.string().nullable(),
  }),
})
export type InterventionAlertValue = z.infer<typeof interventionAlertSchema>

// ---------------------------------------------------------------------------
// Teacher overview
// ---------------------------------------------------------------------------

export const analyticsOfferingSummarySchema = z.object({
  id: z.string(),
  courseCode: z.string(),
  courseName: z.string(),
  className: z.string(),
  term: z.string(),
  academicYear: z.number().int(),
})
export type AnalyticsOfferingSummary = z.infer<typeof analyticsOfferingSummarySchema>

export const analyticsAssessmentSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.string(),
  dueDate: z.string(),
  maxMarks: z.number(),
  /** Students with a finalized (submitted or graded) attempt. */
  attemptCount: z.number().int(),
  average: z.number().nullable(),
  passRate: z.number().nullable(),
})
export type AnalyticsAssessmentSummary = z.infer<typeof analyticsAssessmentSummarySchema>

/**
 * The grading regime in force for an offering, as the analytics page reports it.
 *
 * `notice` is present exactly when the regime is absolute, and carries the reason so the UI
 * can explain a fallback rather than silently substituting one banding for another. That is
 * the whole point: a relative-graded class shown absolute bands with no explanation looks
 * like a correct grade that happens to be wrong.
 */
export const gradingRegimeSummarySchema = z.object({
  regime: z.enum(["relative", "absolute"]),
  /** Why, when absolute. Absent for relative. */
  reason: z
    .enum(["category-unset", "small-class", "non-theory-course", "awaiting-base-metrics"])
    .nullable(),
  category: z.string().nullable(),
  enrolledCount: z.number().int(),
  publishedCount: z.number().int(),
  /** Present for relative. */
  mean: z.number().nullable(),
  standardDeviation: z.number().nullable(),
  notice: z
    .object({
      tone: z.enum(["info", "warning"]),
      title: z.string(),
      detail: z.string(),
      progress: z.object({ available: z.number().int(), required: z.number().int() }).nullable(),
    })
    .nullable(),
})
export type GradingRegimeSummary = z.infer<typeof gradingRegimeSummarySchema>

/**
 * The at-risk roster, as the analytics page reports it.
 *
 * `no-published-work` is a distinct group rather than a flag, because a student with no
 * released mark has not been *judged* — there is nothing to compare them against. Reporting
 * them inside `belowBoundary` would flag them on evidence that does not exist.
 */
export const atRiskStudentSchema = z.object({
  studentId: z.string(),
  fullName: z.string(),
  registerNumber: z.string(),
  grandTotal: z.number().nullable(),
  group: z.enum(["below-boundary", "no-published-work"]),
})
export type AtRiskStudentValue = z.infer<typeof atRiskStudentSchema>

export const atRiskRosterSchema = z.object({
  boundary: z.number().nullable(),
  regime: z.enum(["relative", "absolute"]),
  publishedCount: z.number().int(),
  enrolledCount: z.number().int(),
  aboveBoundaryCount: z.number().int(),
  atRisk: z.array(atRiskStudentSchema),
})
export type AtRiskRosterValue = z.infer<typeof atRiskRosterSchema>

/** One point per teaching week. `average` is null for a week with no assessed work. */
export const weeklyPointSchema = z.object({
  week: z.number().int(),
  average: z.number().nullable(),
  count: z.number().int(),
})
export type WeeklyPointValue = z.infer<typeof weeklyPointSchema>

export const cohortTrendSchema = z.object({
  /** Absent when the offering has no term window, so there is no axis to bucket against. */
  series: z
    .object({
      weeks: z.number().int(),
      points: z.array(weeklyPointSchema),
      startsOn: z.string(),
      endsOn: z.string(),
    })
    .nullable(),
  markedCount: z.number().int(),
})
export type CohortTrendValue = z.infer<typeof cohortTrendSchema>

export const teacherAnalyticsOverviewResponseSchema = z.object({
  success: z.literal(true),
  offerings: z.array(analyticsOfferingSummarySchema),
  offeringId: z.string().nullable(),
  assessments: z.array(analyticsAssessmentSummarySchema),
  alerts: z.array(interventionAlertSchema),
  thresholds: interventionThresholdsSchema,
  gradingRegime: gradingRegimeSummarySchema,
  atRisk: atRiskRosterSchema,
  trend: cohortTrendSchema,
  generatedAt: z.string(),
})
export type TeacherAnalyticsOverviewResponse = z.infer<
  typeof teacherAnalyticsOverviewResponseSchema
>

// ---------------------------------------------------------------------------
// Assessment item analysis
// ---------------------------------------------------------------------------

export const assessmentAnalyticsHeaderSchema = z.object({
  id: z.string(),
  title: z.string(),
  offeringId: z.string(),
  maxMarks: z.number(),
  /** Distinct students with a finalized attempt. */
  studentCount: z.number().int(),
})
export type AssessmentAnalyticsHeader = z.infer<typeof assessmentAnalyticsHeaderSchema>

export const assessmentItemAnalysisResponseSchema = z.object({
  success: z.literal(true),
  assessment: assessmentAnalyticsHeaderSchema,
  cohort: cohortDistributionSchema,
  items: z.array(itemAnalysisResponseSchema),
  thresholds: itemAnalysisThresholdsSchema,
  generatedAt: z.string(),
})
export type AssessmentItemAnalysisResponse = z.infer<typeof assessmentItemAnalysisResponseSchema>

// ---------------------------------------------------------------------------
// Adaptive retake (student)
// ---------------------------------------------------------------------------

export const retakableAssessmentSchema = z.object({
  id: z.string(),
  title: z.string(),
  offeringId: z.string(),
  courseCode: z.string(),
  courseName: z.string(),
  maxMarks: z.number(),
  /** Questions the student got wrong on their latest finalized attempt. */
  failedCount: z.number().int(),
  /** Questions left unanswered on that attempt. */
  unansweredCount: z.number().int(),
})
export type RetakableAssessment = z.infer<typeof retakableAssessmentSchema>

export const retakableAssessmentsResponseSchema = z.object({
  success: z.literal(true),
  assessments: z.array(retakableAssessmentSchema),
})
export type RetakableAssessmentsResponse = z.infer<typeof retakableAssessmentsResponseSchema>

export const retakePreviousResponseSchema = z.object({
  questionId: z.string(),
  selectedOptionIds: z.array(z.string()),
  isCorrect: z.boolean().nullable(),
})
export type RetakePreviousResponse = z.infer<typeof retakePreviousResponseSchema>

export const adaptiveRetakeResponseSchema = z.object({
  success: z.literal(true),
  assessment: z.object({
    id: z.string(),
    title: z.string(),
    maxMarks: z.number(),
  }),
  sourceAttemptId: z.string().nullable(),
  totalQuestions: z.number().int(),
  questionIds: z.array(z.string()),
  failedQuestionIds: z.array(z.string()),
  unansweredQuestionIds: z.array(z.string()),
  includeUnanswered: z.boolean(),
  questions: z.array(generatedQuestionForStudentSchema),
  previousResponses: z.array(retakePreviousResponseSchema),
  generatedAt: z.string(),
})
export type AdaptiveRetakeResponse = z.infer<typeof adaptiveRetakeResponseSchema>

/** `GET /api/student/analytics/retake?assessmentId=` query. */
export const adaptiveRetakeQuerySchema = z.object({
  assessmentId: nonEmptyString,
  includeUnanswered: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value !== "false"),
})
export type AdaptiveRetakeQuery = z.infer<typeof adaptiveRetakeQuerySchema>
