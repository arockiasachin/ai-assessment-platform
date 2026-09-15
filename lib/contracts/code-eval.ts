import { z } from "zod"

import { nonEmptyString } from "./common"

/**
 * The sandboxed code-evaluation API contract.
 *
 * Two invariants the shapes encode:
 *
 *  - A `TestRun` is **evidence**. It reports per-test pass/fail with output,
 *    never a bare score, and never publishes a `Grade`. Publication stays in the
 *    existing human review flow (`lib/grading/review-service.ts`).
 *  - Students only ever receive their own runs. The teacher-facing shapes carry
 *    the student's source code; the student-facing shapes never carry another
 *    student's data and never carry `TestCase.expectedOutput`.
 */

/** Languages the sandbox harness supports today. */
export const codeLanguageSchema = z.enum(["python", "javascript"])
export type CodeLanguage = z.infer<typeof codeLanguageSchema>

/**
 * PrairieLearn-style test categories. `input-output` is the canonical spelling
 * in the product spec; the parser normalizes a few aliases on the way in.
 */
export const TEST_CATEGORIES = ["unit", "input-output", "structure", "code-quality"] as const
export const testCategorySchema = z.enum(TEST_CATEGORIES)
export type TestCategory = z.infer<typeof testCategorySchema>

/** Generated tests are drafts until the teacher publishes them. */
export const testCaseStatusSchema = z.enum(["draft", "active"])
export type TestCaseStatus = z.infer<typeof testCaseStatusSchema>

export const testRunStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "PASSED",
  "FAILED",
  "ERROR",
  "TIMEOUT",
])
export type TestRunStatusValue = z.infer<typeof testRunStatusSchema>

export const testCaseResponseSchema = z.object({
  id: z.string(),
  codeTaskId: z.string(),
  order: z.number().int(),
  name: z.string(),
  description: z.string().nullable(),
  category: testCategorySchema,
  categoryLabel: z.string(),
  input: z.string().nullable(),
  expectedOutput: z.string().nullable(),
  points: z.number(),
  isHidden: z.boolean(),
  status: testCaseStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type TestCaseResponse = z.infer<typeof testCaseResponseSchema>

export const codeTaskResponseSchema = z.object({
  id: z.string(),
  assessmentId: z.string(),
  assessmentTitle: z.string(),
  language: codeLanguageSchema,
  instructions: z.string().nullable(),
  starterCode: z.string().nullable(),
  timeLimitMs: z.number().int(),
  memoryLimitMb: z.number().int(),
  maxSubmissions: z.number().int(),
  testCaseCount: z.number().int(),
  draftTestCaseCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type CodeTaskResponse = z.infer<typeof codeTaskResponseSchema>

export const codeTaskDetailResponseSchema = z.object({
  task: codeTaskResponseSchema,
  testCases: z.array(testCaseResponseSchema),
})
export type CodeTaskDetailResponse = z.infer<typeof codeTaskDetailResponseSchema>

export const codeTaskSummarySchema = z.object({
  assessmentId: z.string(),
  assessmentTitle: z.string(),
  assessmentType: z.string(),
  dueDate: z.string(),
  maxMarks: z.number(),
  courseCode: z.string(),
  courseName: z.string(),
  className: z.string(),
  hasCodeTask: z.boolean(),
  language: codeLanguageSchema.nullable(),
  testCaseCount: z.number().int(),
  draftTestCaseCount: z.number().int(),
  submissionCount: z.number().int(),
  maxSubmissions: z.number().int(),
})
export type CodeTaskSummary = z.infer<typeof codeTaskSummarySchema>

export const codeTaskListResponseSchema = z.object({
  success: z.literal(true),
  tasks: z.array(codeTaskSummarySchema),
})
export type CodeTaskListResponse = z.infer<typeof codeTaskListResponseSchema>

export const codeTaskDetailEnvelopeSchema = z.object({
  success: z.literal(true),
  message: z.string().optional(),
  task: codeTaskResponseSchema,
  testCases: z.array(testCaseResponseSchema),
})
export type CodeTaskDetailEnvelope = z.infer<typeof codeTaskDetailEnvelopeSchema>

/**
 * `POST/PATCH /api/teacher/code-tasks` request. Limits are capped so a single
 * request can never ask for an unbounded container.
 */
export const upsertCodeTaskRequestSchema = z.object({
  assessmentId: nonEmptyString,
  language: codeLanguageSchema,
  instructions: z.string().trim().max(20_000).nullable().optional(),
  starterCode: z.string().max(100_000).nullable().optional(),
  timeLimitMs: z.number().int().min(100).max(60_000).default(5_000),
  memoryLimitMb: z.number().int().min(32).max(1_024).default(256),
  /** Hard cap on runs per student, enforced server-side before the sandbox. */
  maxSubmissions: z.number().int().min(1).max(100).default(10),
})
export type UpsertCodeTaskRequest = z.infer<typeof upsertCodeTaskRequestSchema>

export const createTestCaseRequestSchema = z.object({
  name: nonEmptyString.max(200),
  description: z.string().trim().max(2_000).nullable().optional(),
  category: testCategorySchema.default("unit"),
  input: z.string().max(100_000).nullable().optional(),
  expectedOutput: z.string().max(100_000).nullable().optional(),
  points: z.number().finite().positive().max(1_000).default(1),
  isHidden: z.boolean().default(true),
})
export type CreateTestCaseRequest = z.infer<typeof createTestCaseRequestSchema>

export const updateTestCaseRequestSchema = z
  .object({
    name: nonEmptyString.max(200).optional(),
    description: z.string().trim().max(2_000).nullable().optional(),
    category: testCategorySchema.optional(),
    input: z.string().max(100_000).nullable().optional(),
    expectedOutput: z.string().max(100_000).nullable().optional(),
    points: z.number().finite().positive().max(1_000).optional(),
    isHidden: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "At least one field must be provided.",
  })
export type UpdateTestCaseRequest = z.infer<typeof updateTestCaseRequestSchema>

/** LLM-assisted draft generation request. */
export const generateTestCasesRequestSchema = z.object({
  /** How many draft test cases to ask the model for (1-20). */
  count: z.number().int().min(1).max(20).default(5),
  /** Optional teacher hint about the behaviours worth testing. */
  focus: z.string().trim().max(2_000).optional(),
})
export type GenerateTestCasesRequest = z.infer<typeof generateTestCasesRequestSchema>

export const generatedTestCaseDraftSchema = z.object({
  name: nonEmptyString,
  description: z.string().nullable(),
  category: testCategorySchema,
  input: z.string().nullable(),
  expectedOutput: z.string().nullable(),
  points: z.number().finite().positive(),
})
export type GeneratedTestCaseDraft = z.infer<typeof generatedTestCaseDraftSchema>

export const publishTestCasesRequestSchema = z.object({
  /** Omit to publish every generated draft on the owned code task. */
  testCaseIds: z.array(nonEmptyString).min(1).max(100).optional(),
})
export type PublishTestCasesRequest = z.infer<typeof publishTestCasesRequestSchema>

export const publishTestCasesResponseSchema = z.object({
  success: z.literal(true),
  message: z.string().optional(),
  published: z.array(testCaseResponseSchema),
  alreadyActive: z.array(z.string()),
})
export type PublishTestCasesResponse = z.infer<typeof publishTestCasesResponseSchema>

/** One PrairieLearn-style per-test result. Never a bare score. */
export const testResultSchema = z.object({
  testCaseId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  category: testCategorySchema,
  points: z.number(),
  earnedPoints: z.number(),
  passed: z.boolean(),
  stdout: z.string(),
  stderr: z.string(),
  message: z.string(),
  durationMs: z.number().int(),
})
export type TestResult = z.infer<typeof testResultSchema>

export const testRunResponseSchema = z.object({
  id: z.string(),
  codeTaskId: z.string(),
  assessmentId: z.string(),
  studentId: z.string(),
  /** Populated for teacher-facing run views; `null` in the student's own view. */
  studentName: z.string().nullable(),
  studentRegisterNumber: z.string().nullable(),
  language: codeLanguageSchema,
  status: testRunStatusSchema,
  passedCount: z.number().int(),
  failedCount: z.number().int(),
  totalCount: z.number().int(),
  earnedPoints: z.number(),
  maxPoints: z.number(),
  runtimeMs: z.number().int().nullable(),
  /** Fraction of the task's test cases the harness actually executed. */
  coverage: z.number().nullable(),
  results: z.array(testResultSchema),
  stdout: z.string().nullable(),
  stderr: z.string().nullable(),
  timedOut: z.boolean(),
  memoryExceeded: z.boolean(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
})
export type TestRunResponse = z.infer<typeof testRunResponseSchema>

export const testRunEnvelopeSchema = z.object({
  success: z.literal(true),
  message: z.string().optional(),
  run: testRunResponseSchema,
})
export type TestRunEnvelope = z.infer<typeof testRunEnvelopeSchema>

export const testRunListResponseSchema = z.object({
  success: z.literal(true),
  runs: z.array(testRunResponseSchema),
})
export type TestRunListResponse = z.infer<typeof testRunListResponseSchema>

/** `POST /api/student/code-submissions` request body. */
export const codeSubmissionRequestSchema = z.object({
  assessmentId: nonEmptyString,
  sourceCode: nonEmptyString.max(200_000),
})
export type CodeSubmissionRequest = z.infer<typeof codeSubmissionRequestSchema>

/**
 * The student's own code task with their submission budget. `reason` explains a
 * blocked submission ("deadline passed", "submission cap reached").
 *
 * `maxMarks` (from the assessment) and the sandbox `timeLimitMs`/`memoryLimitMb`
 * (from the code task) are carried so the student's own page can state what the
 * task is worth and the limits a run is killed at, without re-deriving them or
 * widening the student surface with anything teacher-only.
 */
export const studentCodeTaskSchema = z.object({
  assessmentId: z.string(),
  assessmentTitle: z.string(),
  dueDate: z.string(),
  language: codeLanguageSchema,
  instructions: z.string().nullable(),
  starterCode: z.string().nullable(),
  testCaseCount: z.number().int(),
  maxMarks: z.number().int(),
  timeLimitMs: z.number().int(),
  memoryLimitMb: z.number().int(),
  maxSubmissions: z.number().int(),
  submissionsUsed: z.number().int(),
  canSubmit: z.boolean(),
  blockedReason: z.string().nullable(),
  latestRunStatus: testRunStatusSchema.nullable(),
  latestRunAt: z.string().nullable(),
})
export type StudentCodeTask = z.infer<typeof studentCodeTaskSchema>

export const studentCodeTaskListResponseSchema = z.object({
  success: z.literal(true),
  tasks: z.array(studentCodeTaskSchema),
})
export type StudentCodeTaskListResponse = z.infer<typeof studentCodeTaskListResponseSchema>

/** A flagged (or pending) cohort similarity pair. Flags, never decides. */
export const similarityPairSchema = z.object({
  id: z.string(),
  codeTaskId: z.string(),
  similarity: z.number(),
  verdict: z.enum(["PENDING", "FLAGGED", "CLEARED"]),
  studentId: z.string(),
  studentName: z.string(),
  comparedStudentId: z.string(),
  comparedStudentName: z.string(),
  evidence: z
    .object({
      method: z.string(),
      shingleSize: z.number().int(),
      sharedShingles: z.number().int(),
      tokenCountA: z.number().int(),
      tokenCountB: z.number().int(),
    })
    .nullable(),
  checkedAt: z.string(),
})
export type SimilarityPair = z.infer<typeof similarityPairSchema>

export const similarityListResponseSchema = z.object({
  success: z.literal(true),
  threshold: z.number(),
  pairs: z.array(similarityPairSchema),
})
export type SimilarityListResponse = z.infer<typeof similarityListResponseSchema>

export const similarityScanRequestSchema = z.object({
  /** Jaccard threshold in [0, 1]; defaults to the module constant. */
  threshold: z.number().finite().min(0).max(1).optional(),
})
export type SimilarityScanRequest = z.infer<typeof similarityScanRequestSchema>

export const setSimilarityVerdictRequestSchema = z.object({
  verdict: z.enum(["FLAGGED", "CLEARED"]),
})
export type SetSimilarityVerdictRequest = z.infer<typeof setSimilarityVerdictRequestSchema>
