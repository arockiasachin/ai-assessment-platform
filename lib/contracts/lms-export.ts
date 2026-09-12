import { z } from "zod"

import { nonEmptyString } from "./common"

/**
 * The weighted-final-grade and LMS-interoperability API contract.
 *
 * This pod implements product-spec §7 (grade export and LMS interoperability):
 * a configurable, sum-checked category weighting that turns *published* grades
 * into a final grade, a OneRoster 1.2-shaped CSV export, and the pure payload
 * builders a real LTI 1.3 AGS integration will need.
 *
 * The non-negotiable rule is encoded here and in `lib/lms-export/final-grade.ts`:
 * an unpublished `Grade` (a model suggestion no teacher has approved) can never
 * contribute to a final grade. The export reads `Grade.publishedAt`, never
 * `AIGradeSuggestion`. There is no legacy fallback: `AssessmentGrade` has been
 * retired, so the modern `Grade` is the only store.
 */

// ---------------------------------------------------------------------------
// Weight configuration
// ---------------------------------------------------------------------------

/** A category of assessments with a percentage weight of the final grade. */
export const finalGradeCategorySchema = z.object({
  id: nonEmptyString.max(100),
  name: nonEmptyString.max(200),
  /**
   * Percentage of the final grade. Category weights across a configuration must
   * sum to 100 (see `validateFinalGradeConfig`).
   */
  weight: z.number().finite().positive().max(1000),
  assessmentIds: z.array(nonEmptyString).min(1).max(200),
  /**
   * Optional relative weight of each assessment *within* the category. Defaults
   * to 1 for every assessment. Only ids present in `assessmentIds` are honoured.
   */
  assessmentWeights: z.record(z.string(), z.number().finite().positive().max(1000)).optional(),
})
export type FinalGradeCategoryConfig = z.infer<typeof finalGradeCategorySchema>

export const finalGradeConfigSchema = z.object({
  categories: z.array(finalGradeCategorySchema).min(1).max(50),
})
export type FinalGradeConfig = z.infer<typeof finalGradeConfigSchema>

/** `?offeringId=` query shared by the export routes. */
export const finalGradeExportQuerySchema = z.object({
  offeringId: nonEmptyString,
})
export type FinalGradeExportQuery = z.infer<typeof finalGradeExportQuerySchema>

/** `POST /api/teacher/export` request body. Omit `config` for equal weighting. */
export const finalGradeExportRequestSchema = z.object({
  offeringId: nonEmptyString,
  config: finalGradeConfigSchema.optional(),
})
export type FinalGradeExportRequest = z.infer<typeof finalGradeExportRequestSchema>

// ---------------------------------------------------------------------------
// OneRoster
// ---------------------------------------------------------------------------

export const LMS_EXPORT_FILES = ["lineItems", "results", "scoreScales"] as const
export const lmsExportFileSchema = z.enum(LMS_EXPORT_FILES)
export type LmsExportFile = z.infer<typeof lmsExportFileSchema>

export const oneRosterExportQuerySchema = z.object({
  offeringId: nonEmptyString,
  file: lmsExportFileSchema.default("lineItems"),
})
export type OneRosterExportQuery = z.infer<typeof oneRosterExportQuerySchema>

export const oneRosterExportRequestSchema = oneRosterExportQuerySchema.extend({
  config: finalGradeConfigSchema.optional(),
})
export type OneRosterExportRequest = z.infer<typeof oneRosterExportRequestSchema>

/** `?offeringId=&file=` for the signed-in student's own slice. */
export const studentOneRosterExportQuerySchema = oneRosterExportQuerySchema
export type StudentOneRosterExportQuery = z.infer<typeof studentOneRosterExportQuerySchema>

// ---------------------------------------------------------------------------
// Final grade read model
// ---------------------------------------------------------------------------

export const finalGradeMarkOriginSchema = z.literal("modern-grade")
export type FinalGradeMarkOrigin = z.infer<typeof finalGradeMarkOriginSchema>

/** One assessment result that contributed to (or was excluded from) a final grade. */
export const finalGradeMarkSchema = z.object({
  assessmentId: z.string(),
  assessmentTitle: z.string(),
  points: z.number(),
  maxPoints: z.number(),
  percentage: z.number(),
  origin: finalGradeMarkOriginSchema,
  publishedAt: z.string().nullable(),
})
export type FinalGradeMark = z.infer<typeof finalGradeMarkSchema>

/** Per-category contribution to a student's final grade. */
export const finalGradeCategoryBreakdownSchema = z.object({
  id: z.string(),
  name: z.string(),
  weight: z.number(),
  score: z.number().nullable(),
  included: z.boolean(),
  assessmentIds: z.array(z.string()),
  includedAssessmentIds: z.array(z.string()),
  missingAssessmentIds: z.array(z.string()),
})
export type FinalGradeCategoryBreakdown = z.infer<typeof finalGradeCategoryBreakdownSchema>

export const studentFinalGradeSchema = z.object({
  studentId: z.string(),
  fullName: z.string(),
  registerNumber: z.string(),
  percentage: z.number().nullable(),
  letter: z.string().nullable(),
  /** Sum of the weights of categories that had at least one usable mark. */
  completedWeight: z.number(),
  totalWeight: z.number(),
  /**
   * True when at least one configured category had no usable published mark and
   * was therefore excluded. The final percentage is renormalised over the
   * completed weight, so an ungraded category neither helps nor harms.
   */
  incomplete: z.boolean(),
  categories: z.array(finalGradeCategoryBreakdownSchema),
  marks: z.array(finalGradeMarkSchema),
  /** Modern `Grade` rows that exist but are unpublished — deliberately excluded. */
  excludedUnpublishedAssessmentIds: z.array(z.string()),
})
export type StudentFinalGrade = z.infer<typeof studentFinalGradeSchema>

export const lmsOfferingSchema = z.object({
  id: z.string(),
  courseCode: z.string(),
  courseName: z.string(),
  className: z.string(),
  term: z.string(),
  academicYear: z.number().int(),
})
export type LmsOffering = z.infer<typeof lmsOfferingSchema>

export const lmsAssessmentSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.string(),
  dueDate: z.string(),
  maxMarks: z.number(),
  category: z.string(),
})
export type LmsAssessment = z.infer<typeof lmsAssessmentSchema>

export const ltiConfigStatusSchema = z.object({
  configured: z.boolean(),
  missing: z.array(z.string()),
  message: z.string().nullable(),
  scopes: z.array(z.string()),
})
export type LtiConfigStatus = z.infer<typeof ltiConfigStatusSchema>

export const teacherGradeExportResponseSchema = z.object({
  success: z.literal(true),
  offering: lmsOfferingSchema,
  config: finalGradeConfigSchema,
  assessments: z.array(lmsAssessmentSchema),
  students: z.array(studentFinalGradeSchema),
  lti: ltiConfigStatusSchema,
  generatedAt: z.string(),
})
export type TeacherGradeExportResponse = z.infer<typeof teacherGradeExportResponseSchema>

export const studentGradeExportResponseSchema = z.object({
  success: z.literal(true),
  offering: lmsOfferingSchema,
  config: finalGradeConfigSchema,
  finalGrade: studentFinalGradeSchema,
  lti: ltiConfigStatusSchema,
  generatedAt: z.string(),
})
export type StudentGradeExportResponse = z.infer<typeof studentGradeExportResponseSchema>

// ---------------------------------------------------------------------------
// LTI 1.3 AGS (pure payloads + dry-run)
// ---------------------------------------------------------------------------

export const AGS_ACTIVITY_PROGRESS_VALUES = [
  "Initialized",
  "Started",
  "InProgress",
  "Submitted",
  "Completed",
] as const
export const AGS_GRADING_PROGRESS_VALUES = [
  "FullyGraded",
  "Pending",
  "PendingManual",
  "Failed",
  "NotReady",
] as const

export const agsScorePayloadSchema = z.object({
  userId: z.string(),
  timestamp: z.string(),
  scoreGiven: z.number(),
  scoreMaximum: z.number().positive(),
  comment: z.string().optional(),
  activityProgress: z.enum(AGS_ACTIVITY_PROGRESS_VALUES),
  gradingProgress: z.enum(AGS_GRADING_PROGRESS_VALUES),
})
export type AgsScorePayload = z.infer<typeof agsScorePayloadSchema>

export const agsLineItemPayloadSchema = z.object({
  scoreMaximum: z.number().positive(),
  label: z.string(),
  resourceId: z.string(),
  tag: z.string().optional(),
  startDateTime: z.string().optional(),
  endDateTime: z.string().optional(),
  gradesReleased: z.boolean().optional(),
})
export type AgsLineItemPayload = z.infer<typeof agsLineItemPayloadSchema>

export const agsDryRunRequestSchema = z.object({
  offeringId: nonEmptyString,
  config: finalGradeConfigSchema.optional(),
  /**
   * Optional map from internal `StudentProfile.id` to the LMS platform user id
   * the AGS `userId` field requires. This is an explicit per-request override;
   * persisted `LtiUserMapping` rows (the default) are used when it is omitted,
   * and the internal id is the last-resort fallback.
   */
  ltiUserIds: z.record(z.string(), nonEmptyString).optional(),
})
export type AgsDryRunRequest = z.infer<typeof agsDryRunRequestSchema>

// ---------------------------------------------------------------------------
// LTI registration and student↔LTI-user mapping (persisted)
// ---------------------------------------------------------------------------

/**
 * A stored LTI registration. Note there is no private-key field: `privateKeyRef`
 * is an opaque pointer (env-var name, secret-manager ARN, key-vault id). The PEM
 * stays in the environment/secret store and is never returned by the API.
 */
export const ltiRegistrationInputSchema = z.object({
  platformIssuer: nonEmptyString.max(500),
  clientId: nonEmptyString.max(200),
  deploymentId: nonEmptyString.max(200),
  keyId: nonEmptyString.max(200),
  privateKeyRef: z.string().trim().max(500).optional(),
  lineItemsUrl: z.string().trim().url().max(2000).optional(),
  scopes: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  name: z.string().trim().max(200).optional(),
  isActive: z.boolean().default(true),
})
export type LtiRegistrationInput = z.infer<typeof ltiRegistrationInputSchema>

export const ltiRegistrationResponseSchema = z.object({
  id: z.string(),
  platformIssuer: z.string(),
  clientId: z.string(),
  deploymentId: z.string(),
  keyId: z.string(),
  privateKeyRef: z.string().nullable(),
  lineItemsUrl: z.string().nullable(),
  scopes: z.array(z.string()),
  name: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type LtiRegistrationResponse = z.infer<typeof ltiRegistrationResponseSchema>

export const ltiUserMappingInputSchema = z.object({
  studentId: nonEmptyString,
  ltiUserId: nonEmptyString.max(500),
})
export type LtiUserMappingInput = z.infer<typeof ltiUserMappingInputSchema>

export const saveLtiMappingsRequestSchema = z.object({
  offeringId: nonEmptyString,
  /** Defaults to the active registration when omitted. */
  registrationId: nonEmptyString.optional(),
  mappings: z.array(ltiUserMappingInputSchema).min(1).max(500),
})
export type SaveLtiMappingsRequest = z.infer<typeof saveLtiMappingsRequestSchema>

export const ltiRegistrationEnvelopeSchema = z.object({
  success: z.literal(true),
  registration: ltiRegistrationResponseSchema.nullable(),
})
export type LtiRegistrationEnvelope = z.infer<typeof ltiRegistrationEnvelopeSchema>

export const ltiUserMappingsEnvelopeSchema = z.object({
  success: z.literal(true),
  registrationId: z.string(),
  mappings: z.array(
    ltiUserMappingInputSchema.extend({
      id: z.string(),
      updatedAt: z.string(),
    }),
  ),
})
export type LtiUserMappingsEnvelope = z.infer<typeof ltiUserMappingsEnvelopeSchema>

export const agsCallLogEntrySchema = z.object({
  service: z.enum(["lineItems", "scores", "results"]),
  operation: z.string(),
  detail: z.unknown(),
})
export type AgsCallLogEntry = z.infer<typeof agsCallLogEntrySchema>

export const agsDryRunResponseSchema = z.object({
  success: z.literal(true),
  mode: z.literal("dry-run"),
  offering: lmsOfferingSchema,
  contentTypes: z.object({
    score: z.string(),
    lineItem: z.string(),
    result: z.string(),
  }),
  scopes: z.array(z.string()),
  lineItems: z.array(agsLineItemPayloadSchema),
  scores: z.array(agsScorePayloadSchema),
  /** Published grades that were skipped only because they had no LTI user id. */
  skippedUnpublished: z.array(z.object({ assessmentId: z.string(), studentId: z.string() })),
  log: z.array(agsCallLogEntrySchema),
  /** How each student's AGS `userId` was resolved (first non-fallback wins). */
  userIdMapping: z.enum(["provided", "persisted", "internal-id-fallback"]),
  generatedAt: z.string(),
})
export type AgsDryRunResponse = z.infer<typeof agsDryRunResponseSchema>
