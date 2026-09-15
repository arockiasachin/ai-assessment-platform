import { z } from "zod"

import { nonEmptyString, parseableDateString } from "./common"

/**
 * The groups / peer-evaluation API contract.
 *
 * Confidentiality is a hard product rule, so the student-facing shapes here are
 * deliberately poor in identifying detail: received ratings are returned only as
 * an aggregate with a rater count (never a rater identity), and there is no shape
 * that exposes another group's evaluations.
 */

export const peerEvaluationDimensionKeySchema = z.enum([
  "contributing",
  "interacting",
  "keepingOnTrack",
  "expectingQuality",
  "knowledgeSkillsAbilities",
])
export type PeerEvaluationDimensionKeyValue = z.infer<typeof peerEvaluationDimensionKeySchema>

export const peerEvaluationRatingsSchema = z.object({
  contributing: z.number().int().min(1).max(5),
  interacting: z.number().int().min(1).max(5),
  keepingOnTrack: z.number().int().min(1).max(5),
  expectingQuality: z.number().int().min(1).max(5),
  knowledgeSkillsAbilities: z.number().int().min(1).max(5),
})
export type PeerEvaluationRatingsValue = z.infer<typeof peerEvaluationRatingsSchema>

// ---------------------------------------------------------------------------
// Team formation
// ---------------------------------------------------------------------------

export const formationCriterionKindSchema = z.enum([
  "categorical-diversity",
  "categorical-similarity",
  "numeric-balance",
  "numeric-spread",
])
export type FormationCriterionKindValue = z.infer<typeof formationCriterionKindSchema>

export const formationCriterionSchema = z.object({
  id: nonEmptyString.max(80),
  label: nonEmptyString.max(200),
  kind: formationCriterionKindSchema,
  weight: z.number().finite().nonnegative().max(1000),
  attribute: nonEmptyString.max(80),
})
export type FormationCriterionValue = z.infer<typeof formationCriterionSchema>

export const formationStudentSchema = z.object({
  studentId: nonEmptyString,
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).default({}),
  /** Declared available slots. `[]` means "never available" and cannot be placed. */
  availability: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
})
export type FormationStudentValue = z.infer<typeof formationStudentSchema>

/**
 * Per-student team-formation attributes and availability, persisted on
 * `StudentProfile.formationProfile` so a roster can be configured once. An
 * explicit `students` array on a formation run remains as a one-off override.
 */
export const formationProfileSchema = z.object({
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).default({}),
  availability: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
})
export type FormationProfileValue = z.infer<typeof formationProfileSchema>

export const saveFormationProfilesRequestSchema = z.object({
  offeringId: nonEmptyString,
  profiles: z
    .array(
      formationProfileSchema.extend({
        studentId: nonEmptyString,
      }),
    )
    .min(1)
    .max(500),
})
export type SaveFormationProfilesRequest = z.infer<typeof saveFormationProfilesRequestSchema>

export const formTeamsRequestSchema = z.object({
  offeringId: nonEmptyString,
  criteria: z.array(formationCriterionSchema).min(1).max(12),
  /**
   * Optional per-student attributes/availability override. When omitted, every
   * actively enrolled student is included using their persisted
   * `StudentProfile.formationProfile` (and no attributes when it is unset).
   */
  students: z.array(formationStudentSchema).min(2).max(500).optional(),
  teamSize: z.number().int().min(2).max(20).optional(),
  teamCount: z.number().int().min(1).max(100).optional(),
  /** Persist the formed teams as `Group` rows. `false` previews only. */
  persist: z.boolean().default(false),
  groupNamePrefix: z.string().trim().min(1).max(80).optional(),
})
export type FormTeamsRequest = z.infer<typeof formTeamsRequestSchema>

export const formedTeamSchema = z.object({
  index: z.number().int(),
  memberIds: z.array(z.string()),
  score: z.number(),
  criterionScores: z.record(z.string(), z.number()),
  compatible: z.boolean(),
  commonAvailability: z.array(z.string()),
})
export type FormedTeamValue = z.infer<typeof formedTeamSchema>

export const formationResultSchema = z.object({
  teams: z.array(formedTeamSchema),
  objective: z.number(),
  teamCount: z.number().int(),
  scheduleCompatible: z.boolean(),
  criteria: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      kind: formationCriterionKindSchema,
      attribute: z.string(),
      weight: z.number(),
      normalizedWeight: z.number(),
      active: z.boolean(),
    }),
  ),
})
export type FormationResultValue = z.infer<typeof formationResultSchema>

export const formTeamsResponseSchema = z.object({
  success: z.literal(true),
  message: z.string().optional(),
  formation: formationResultSchema,
  persistedGroupIds: z.array(z.string()),
})
export type FormTeamsResponse = z.infer<typeof formTeamsResponseSchema>

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export const groupStatusSchema = z.enum(["FORMING", "ACTIVE", "COMPLETED", "ARCHIVED"])
export type GroupStatusValue = z.infer<typeof groupStatusSchema>

export const createGroupRequestSchema = z.object({
  offeringId: nonEmptyString,
  name: nonEmptyString.max(120),
  projectTitle: z.string().trim().max(200).optional(),
  studentIds: z.array(nonEmptyString).min(1).max(50),
})
export type CreateGroupRequest = z.infer<typeof createGroupRequestSchema>

export const updateGroupRequestSchema = z
  .object({
    name: nonEmptyString.max(120).optional(),
    projectTitle: z.string().trim().max(200).nullable().optional(),
    status: groupStatusSchema.optional(),
    addStudentIds: z.array(nonEmptyString).min(1).max(50).optional(),
    removeStudentIds: z.array(nonEmptyString).min(1).max(50).optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.projectTitle !== undefined ||
      value.status !== undefined ||
      value.addStudentIds !== undefined ||
      value.removeStudentIds !== undefined,
    { message: "At least one field must be provided." },
  )
export type UpdateGroupRequest = z.infer<typeof updateGroupRequestSchema>

export const groupMemberResponseSchema = z.object({
  id: z.string(),
  studentId: z.string(),
  fullName: z.string(),
  registerNumber: z.string(),
  role: z.string().nullable(),
  adjustmentFactor: z.number().nullable(),
  selfAdjustmentFactor: z.number().nullable(),
  joinedAt: z.string(),
  leftAt: z.string().nullable(),
})
export type GroupMemberResponse = z.infer<typeof groupMemberResponseSchema>

export const milestoneStatusSchema = z.enum(["PLANNED", "IN_PROGRESS", "COMPLETED", "MISSED"])
export type MilestoneStatusValue = z.infer<typeof milestoneStatusSchema>

export const milestoneResponseSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: milestoneStatusSchema,
  weight: z.number(),
  dueDate: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type MilestoneResponse = z.infer<typeof milestoneResponseSchema>

export const milestoneProgressSchema = z.object({
  total: z.number().int(),
  planned: z.number().int(),
  inProgress: z.number().int(),
  completed: z.number().int(),
  missed: z.number().int(),
  weightedCompletion: z.number(),
  overdue: z.number().int(),
  dueSoon: z.number().int(),
  nextDueAt: z.string().nullable(),
  behind: z.boolean(),
})
export type MilestoneProgressValue = z.infer<typeof milestoneProgressSchema>

export const groupSummarySchema = z.object({
  id: z.string(),
  offeringId: z.string(),
  name: z.string(),
  projectTitle: z.string().nullable(),
  status: groupStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  memberCount: z.number().int(),
  members: z.array(groupMemberResponseSchema),
  milestoneProgress: milestoneProgressSchema,
  behind: z.boolean(),
  lopsided: z.boolean(),
})
export type GroupSummary = z.infer<typeof groupSummarySchema>

export const groupsResponseSchema = z.object({
  success: z.literal(true),
  groups: z.array(groupSummarySchema),
})
export type GroupsResponse = z.infer<typeof groupsResponseSchema>

export const rosterStudentSchema = z.object({
  studentId: z.string(),
  fullName: z.string(),
  registerNumber: z.string(),
  /** Persisted formation attributes; `{}` when the roster was never configured. */
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
  /** Persisted availability slots; `null` means "not declared / unconstrained". */
  availability: z.array(z.string()).nullable(),
})
export type RosterStudent = z.infer<typeof rosterStudentSchema>

export const rosterResponseSchema = z.object({
  success: z.literal(true),
  students: z.array(rosterStudentSchema),
})
export type RosterResponse = z.infer<typeof rosterResponseSchema>

export const teacherOfferingSummarySchema = z.object({
  id: z.string(),
  courseCode: z.string(),
  courseName: z.string(),
  className: z.string(),
  term: z.string(),
  academicYear: z.number().int(),
  groupCount: z.number().int(),
})
export type TeacherOfferingSummary = z.infer<typeof teacherOfferingSummarySchema>

export const groupDetailResponseSchema = z.object({
  success: z.literal(true),
  group: groupSummarySchema,
  milestones: z.array(milestoneResponseSchema),
})
export type GroupDetailResponse = z.infer<typeof groupDetailResponseSchema>

// ---------------------------------------------------------------------------
// Analysis (instructor)
// ---------------------------------------------------------------------------

export const memberAdjustmentSchema = z.object({
  studentId: z.string(),
  receivedAverage: z.number().nullable(),
  teamAverage: z.number().nullable(),
  adjustmentFactor: z.number(),
  dimensionFactors: z.record(peerEvaluationDimensionKeySchema, z.number()),
  ratingCount: z.number().int(),
  includesSelf: z.boolean(),
  insufficientRatings: z.boolean(),
})
export type MemberAdjustmentValue = z.infer<typeof memberAdjustmentSchema>

export const freeRiderSignalSchema = z.object({
  studentId: z.string(),
  receivedAverage: z.number().nullable(),
  teamMean: z.number().nullable(),
  teamStdDev: z.number().nullable(),
  zScore: z.number().nullable(),
  ratioToTeamMean: z.number().nullable(),
  ratingCount: z.number().int(),
  ratingSignal: z.boolean(),
  contributionCount: z.number().int(),
  contributionWeight: z.number(),
  contributionSignal: z.boolean(),
  surveyIncomplete: z.boolean(),
  submittedEvaluations: z.number().int(),
  expectedEvaluations: z.number().int(),
  completionRate: z.number(),
  flagged: z.boolean(),
  severity: z.enum(["none", "watch", "at-risk"]),
  reasons: z.array(z.string()),
  evidenceOnly: z.boolean(),
})
export type FreeRiderSignalValue = z.infer<typeof freeRiderSignalSchema>

export const contributionEvidenceSchema = z.object({
  evidenceOnly: z.literal(true),
  gradeBasis: z.literal(false),
  notice: z.string(),
  summaries: z.array(
    z.object({
      studentId: z.string().nullable(),
      eventCount: z.number().int(),
      totalWeight: z.number(),
      byType: z.record(z.string(), z.number()),
      firstAt: z.string().nullable(),
      lastAt: z.string().nullable(),
    }),
  ),
  events: z.array(
    z.object({
      id: z.string(),
      groupId: z.string(),
      studentId: z.string().nullable(),
      type: z.string(),
      source: z.string().nullable(),
      externalId: z.string().nullable(),
      summary: z.string().nullable(),
      weight: z.number(),
      occurredAt: z.string(),
    }),
  ),
})
export type ContributionEvidenceValue = z.infer<typeof contributionEvidenceSchema>

export const suggestedIndividualGradeSchema = z.object({
  studentId: z.string(),
  groupGrade: z.number(),
  factor: z.number(),
  individualGrade: z.number(),
  factorWasClamped: z.boolean(),
  withSelf: z.object({
    groupGrade: z.number(),
    factor: z.number(),
    individualGrade: z.number(),
    factorWasClamped: z.boolean(),
  }),
})
export type SuggestedIndividualGradeValue = z.infer<typeof suggestedIndividualGradeSchema>

/**
 * Instructor-only: the evaluator↔evaluatee pair matrix.
 *
 * Decision D6 (`docs/plans/wave-1.md` §4) resolved that a teacher may see who
 * rated whom. It is standard CATME practice — an instructor needs the pairs to
 * spot collusion and free-riding — and the anonymity promise is
 * student-to-student, not student-to-instructor.
 *
 * This shape must never be attached to a student payload. A student's `received`
 * aggregate stays identity-free (`receivedAggregateSchema`), and
 * `tests/groups-peer-evaluation.test.ts` stringifies it to prove so.
 */
export const peerEvaluationPairSchema = z.object({
  evaluatorId: z.string(),
  evaluatorName: z.string(),
  evaluateeId: z.string(),
  evaluateeName: z.string(),
  status: z.enum(["DRAFT", "SUBMITTED"]),
  /** Dimension values; `null` while the rating is still a draft. */
  ratings: peerEvaluationRatingsSchema.nullable(),
  submittedAt: z.string().nullable(),
})
export type PeerEvaluationPair = z.infer<typeof peerEvaluationPairSchema>

export const groupAnalysisSchema = z.object({
  groupId: z.string(),
  memberIds: z.array(z.string()),
  withoutSelf: z.array(memberAdjustmentSchema),
  withSelf: z.array(memberAdjustmentSchema),
  freeRiders: z.array(freeRiderSignalSchema),
  milestoneProgress: milestoneProgressSchema,
  submittedEvaluationCount: z.number().int(),
  completion: z.array(
    z.object({
      studentId: z.string(),
      submittedEvaluations: z.number().int(),
      expectedEvaluations: z.number().int(),
      completionRate: z.number(),
    }),
  ),
  contributionEvidence: contributionEvidenceSchema,
  /**
   * Instructor-only (D6). Every row names both sides of the rating; a `DRAFT`
   * row carries no values. Never part of a student payload.
   */
  peerEvaluationPairs: z.array(peerEvaluationPairSchema),
  suggestedIndividualGrades: z.array(suggestedIndividualGradeSchema).nullable(),
})
export type GroupAnalysisResponse = z.infer<typeof groupAnalysisSchema>

export const groupAnalysisEnvelopeSchema = z.object({
  success: z.literal(true),
  analysis: z.array(groupAnalysisSchema),
  cohortProgress: z.array(
    z.object({
      groupId: z.string(),
      behind: z.boolean(),
      lopsided: z.boolean(),
      weightedCompletion: z.number(),
    }),
  ),
})
export type GroupAnalysisEnvelope = z.infer<typeof groupAnalysisEnvelopeSchema>

// ---------------------------------------------------------------------------
// Peer evaluation (student)
// ---------------------------------------------------------------------------

export const peerEvaluationSubmitRequestSchema = z.object({
  groupId: nonEmptyString,
  evaluations: z
    .array(
      z.object({
        evaluateeId: nonEmptyString,
        ratings: peerEvaluationRatingsSchema,
        comments: z.string().trim().max(2000).optional(),
      }),
    )
    .min(1)
    .max(50),
  /** `false` saves drafts; `true` submits (the default). */
  submit: z.boolean().default(true),
})
export type PeerEvaluationSubmitRequest = z.infer<typeof peerEvaluationSubmitRequestSchema>

export const teammateResponseSchema = z.object({
  studentId: z.string(),
  fullName: z.string(),
  registerNumber: z.string(),
  isSelf: z.boolean(),
})
export type TeammateResponse = z.infer<typeof teammateResponseSchema>

export const myEvaluationResponseSchema = z.object({
  evaluateeId: z.string(),
  status: z.enum(["DRAFT", "SUBMITTED"]),
  overallScore: z.number().nullable(),
  ratings: peerEvaluationRatingsSchema.nullable(),
  comments: z.string().nullable(),
  submittedAt: z.string().nullable(),
})
export type MyEvaluationResponse = z.infer<typeof myEvaluationResponseSchema>

/**
 * Received results are deliberately anonymous: only dimension averages and the
 * number of non-self raters. There is no evaluator id, name, or free-text
 * comment, and the aggregate is withheld until enough teammates have rated.
 */
export const receivedAggregateSchema = z.object({
  dimensionAverages: z.record(peerEvaluationDimensionKeySchema, z.number()),
  overallAverage: z.number(),
  /** Distinct non-self raters folded into the averages. */
  ratingCount: z.number().int(),
  minRatersRequired: z.number().int(),
  withheld: z.literal(false),
})
export type ReceivedAggregate = z.infer<typeof receivedAggregateSchema>

export const receivedWithheldSchema = z.object({
  withheld: z.literal(true),
  ratingCount: z.number().int(),
  minRatersRequired: z.number().int(),
  reason: z.string(),
})
export type ReceivedWithheld = z.infer<typeof receivedWithheldSchema>

export const studentPeerEvaluationGroupSchema = z.object({
  groupId: z.string(),
  groupName: z.string(),
  projectTitle: z.string().nullable(),
  offeringId: z.string(),
  courseCode: z.string(),
  courseName: z.string(),
  teammates: z.array(teammateResponseSchema),
  myEvaluations: z.array(myEvaluationResponseSchema),
  selfEvaluationSubmitted: z.boolean(),
  expectedEvaluations: z.number().int(),
  submittedEvaluations: z.number().int(),
  received: z.union([receivedAggregateSchema, receivedWithheldSchema]),
})
export type StudentPeerEvaluationGroup = z.infer<typeof studentPeerEvaluationGroupSchema>

export const peerEvaluationWorkspaceResponseSchema = z.object({
  success: z.literal(true),
  groups: z.array(studentPeerEvaluationGroupSchema),
})
export type PeerEvaluationWorkspaceResponse = z.infer<typeof peerEvaluationWorkspaceResponseSchema>

export const peerEvaluationSubmitResponseSchema = z.object({
  success: z.literal(true),
  message: z.string().optional(),
  groupId: z.string(),
  submitted: z.number().int(),
  status: z.enum(["DRAFT", "SUBMITTED"]),
})
export type PeerEvaluationSubmitResponse = z.infer<typeof peerEvaluationSubmitResponseSchema>

// ---------------------------------------------------------------------------
// Contribution events and milestones (instructor)
// ---------------------------------------------------------------------------

export const contributionEventTypeSchema = z.enum([
  "COMMIT",
  "PULL_REQUEST",
  "ISSUE",
  "REVIEW",
  "MANUAL",
  "OTHER",
])
export type ContributionEventTypeValue = z.infer<typeof contributionEventTypeSchema>

export const contributionEventInputSchema = z.object({
  studentId: nonEmptyString.nullable().optional(),
  type: contributionEventTypeSchema,
  source: z.string().trim().max(200).optional(),
  externalId: z.string().trim().max(300).optional(),
  summary: z.string().trim().max(1000).optional(),
  weight: z.number().finite().positive().max(100).default(1),
  occurredAt: parseableDateString,
})
export type ContributionEventInput = z.infer<typeof contributionEventInputSchema>

export const recordContributionsRequestSchema = z.object({
  groupId: nonEmptyString,
  events: z.array(contributionEventInputSchema).min(1).max(500),
})
export type RecordContributionsRequest = z.infer<typeof recordContributionsRequestSchema>

export const recordContributionsResponseSchema = z.object({
  success: z.literal(true),
  message: z.string().optional(),
  recorded: z.number().int(),
  evidence: contributionEvidenceSchema,
})
export type RecordContributionsResponse = z.infer<typeof recordContributionsResponseSchema>

export const createMilestoneRequestSchema = z.object({
  groupId: nonEmptyString,
  title: nonEmptyString.max(200),
  description: z.string().trim().max(2000).optional(),
  weight: z.number().finite().positive().max(100).default(1),
  dueDate: parseableDateString.nullable().optional(),
})
export type CreateMilestoneRequest = z.infer<typeof createMilestoneRequestSchema>

export const updateMilestoneRequestSchema = z
  .object({
    title: nonEmptyString.max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    weight: z.number().finite().positive().max(100).optional(),
    dueDate: parseableDateString.nullable().optional(),
    status: milestoneStatusSchema.optional(),
    completedAt: parseableDateString.nullable().optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.description !== undefined ||
      value.weight !== undefined ||
      value.dueDate !== undefined ||
      value.status !== undefined ||
      value.completedAt !== undefined,
    { message: "At least one field must be provided." },
  )
export type UpdateMilestoneRequest = z.infer<typeof updateMilestoneRequestSchema>

export const milestoneEnvelopeSchema = z.object({
  success: z.literal(true),
  milestone: milestoneResponseSchema,
})
export type MilestoneEnvelope = z.infer<typeof milestoneEnvelopeSchema>

export const milestonesResponseSchema = z.object({
  success: z.literal(true),
  milestones: z.array(milestoneResponseSchema),
  cohortProgress: z.array(
    z.object({
      groupId: z.string(),
      behind: z.boolean(),
      lopsided: z.boolean(),
      weightedCompletion: z.number(),
    }),
  ),
})
export type MilestonesResponse = z.infer<typeof milestonesResponseSchema>
