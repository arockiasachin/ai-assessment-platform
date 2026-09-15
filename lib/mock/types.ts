import type { StatusKey } from "@/components/ui/status-pill"

/**
 * UI view models for the mockup tree.
 *
 * These are deliberately hand-written, UI-shaped types — NOT Prisma types and
 * NOT API contracts. Two rules keep them useful:
 *
 *  1. String unions mirror the Prisma enums (`AssessmentType`, `SubmissionStatus`,
 *    `GradeReviewStatus`, `TestRunStatus`, `GroupStatus`, `MilestoneStatus`, …)
 *    so a later wiring pass maps 1:1 without translation tables.
 *  2. Numeric fields are nullable wherever the real product can legitimately
 *    have "no value yet" (an ungraded submission, a question with too few
 *    responses to analyse). The mockups must render those states, not hide them.
 */

export type MockupRole = "teacher" | "student" | "admin"

export type AssessmentKind = "QUIZ" | "DESCRIPTIVE" | "CODE" | "GROUP_PROJECT" | "ASSIGNMENT"

export type SubmissionState = "DRAFT" | "SUBMITTED" | "LATE" | "GRADED" | "RESUBMITTED"

export type ReviewState = "PENDING" | "AUTO_ACCEPTED" | "NEEDS_REVIEW" | "OVERRIDDEN" | "REJECTED"

export type GradeSourceKind = "AI_SUGGESTED" | "TEACHER_OVERRIDE" | "AUTO" | "IMPORTED"

export type TestRunState = "QUEUED" | "RUNNING" | "PASSED" | "FAILED" | "ERROR" | "TIMEOUT"

export type GroupState = "FORMING" | "ACTIVE" | "COMPLETED" | "ARCHIVED"

export type PeerEvaluationState = "DRAFT" | "SUBMITTED"

export type MilestoneState = "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "MISSED"

export type ContributionKind = "COMMIT" | "PULL_REQUEST" | "ISSUE" | "REVIEW" | "MANUAL" | "OTHER"

/** Signed-in-looking identity used by the shell and page headers. */
export type MockUser = {
  id: string
  name: string
  email: string
  role: MockupRole
  roleLabel: string
  roleTone: StatusKey
  initials: string
  detail: string
}

export type MockNotification = {
  id: string
  title: string
  description: string
  createdAt: string
  read: boolean
  tone: StatusKey
  href?: string
}

export type Course = {
  id: string
  code: string
  name: string
  description: string
  credits: number
  term: string
  academicYear: number
  section: string
  teacherName: string
  room: string
  studentCount: number
  /** Cohort mean across published grades. `null` until work is published. */
  avgPercent: number | null
  completionPercent: number
  atRiskCount: number
  startsOn: string
  endsOn: string
}

export type Student = {
  id: string
  name: string
  registerNumber: string
  email: string
  initials: string
  groupId: string | null
  groupName: string | null
  /** Mean of published grades, or `null` when nothing is published yet. */
  avgPercent: number | null
  submittedCount: number
  missingCount: number
  atRisk: boolean
  lastActiveAt: string | null
}

export type CriterionLevel = {
  label: string
  points: number
  description: string
}

export type RubricCriterion = {
  id: string
  order: number
  label: string
  description: string
  weight: number
  maxPoints: number
  levels: CriterionLevel[]
}

export type Rubric = {
  id: string
  title: string
  description: string
  maxPoints: number
  totalWeight: number
  criteria: RubricCriterion[]
  updatedAt: string
}

export type Assessment = {
  id: string
  title: string
  kind: AssessmentKind
  courseCode: string
  dueAt: string
  maxPoints: number
  /** draft | published | in-progress | completed | needs-review */
  state: StatusKey
  rubricId?: string
  expectedCount: number
  submissionCount: number
  gradedCount: number
  averagePercent: number | null
  /** Share of the final grade this assessment carries. */
  weightPercent: number
  published: boolean
}

export type QuestionOption = {
  id: string
  label: string
  text: string
  isCorrect: boolean
  /** Why a distractor is wrong — shown to the teacher, never to the student. */
  rationale?: string
}

export type QuizQuestion = {
  id: string
  order: number
  prompt: string
  type: "MULTIPLE_CHOICE" | "MULTIPLE_SELECT" | "TRUE_FALSE" | "SHORT_ANSWER"
  points: number
  topic: string
  /** 0..1, `null` for a hand-authored question with no estimate. */
  difficulty: number | null
  state: "draft" | "published"
  options: QuestionOption[]
  explanation: string
}

export type QuizAttemptSummary = {
  id: string
  /** The assessment this sitting belongs to — the title is shown on attempts tables. */
  assessmentId: string
  assessmentTitle: string
  studentId: string
  studentName: string
  attemptNumber: number
  state: StatusKey
  score: number | null
  maxScore: number
  submittedAt: string | null
  timeSpentMs: number | null
}

/**
 * Outcome of one question in a **submitted** attempt.
 *
 * This is a state union rather than a bare `isCorrect` boolean on purpose: a
 * question the student never answered is neither correct nor incorrect, and the
 * student surface must be able to say so without inventing a `false`.
 */
export type QuizResponseOutcome = "CORRECT" | "PARTIALLY_CORRECT" | "INCORRECT" | "UNANSWERED"

/** One question as the student's own submission reports it. */
export type QuizResponse = {
  id: string
  questionId: string
  outcome: QuizResponseOutcome
  /** Option ids the student selected. Empty when the question was not answered. */
  selectedOptionIds: string[]
  pointsAwarded: number
}

/**
 * A quiz sitting the student has started but not submitted.
 *
 * Deliberately holds the student's own selections and nothing else: there is no
 * correctness flag, no answer key and no explanation anywhere in this shape,
 * which is exactly what the pre-submission student payload must never contain.
 * The key is only reachable through `QuizResponse` after submission.
 */
export type QuizInProgressAttempt = {
  id: string
  assessmentId: string
  title: string
  /** `GRADED` counts against the attempt cap; `PRACTICE` is adaptive retake. */
  kind: "GRADED" | "PRACTICE"
  attemptNumber: number
  maxScore: number
  startedAt: string
  expiresAt: string
  /** Ordered question ids in the sitting. */
  questionIds: string[]
  answeredQuestionIds: string[]
  flaggedQuestionIds: string[]
  /** Current selections, keyed by question id — no key, no correctness. */
  selections: Record<string, string[]>
  /** Elapsed and remaining time, measured against the fixed mock clock. */
  timeSpentMs: number
  timeRemainingMs: number
}

export type ItemAnalysis = {
  questionId: string
  order: number
  prompt: string
  topic: string
  responses: number
  /** `null` when the response count is below the item-analysis threshold. */
  percentCorrect: number | null
  discrimination: number | null
  /** active (healthy) | needs-review | insufficient-data */
  flag: StatusKey
  note: string
}

export type GradeSuggestion = {
  id: string
  assessmentId: string
  assessmentTitle: string
  studentId: string
  studentName: string
  criterionId: string
  criterionLabel: string
  suggestedPoints: number
  maxPoints: number
  rationale: string
  evidence: string | null
  /** 0..1 */
  confidence: number
  model: string
  promptVersion: string
  latencyMs: number
  state: ReviewState
  decidedBy?: string
  decidedAt?: string
  finalPoints?: number
  overrideReason?: string
}

export type ReviewQueueItem = {
  id: string
  assessmentId: string
  assessmentTitle: string
  kind: AssessmentKind
  studentId: string
  studentName: string
  groupName?: string
  /** `null` for a quiz attempt that was never submitted. */
  submittedAt: string | null
  state: ReviewState
  suggestedPoints: number
  maxPoints: number
  confidence: number
  flags: string[]
  reviewer: string | null
  priority: "high" | "normal" | "low"
  criteria: GradeSuggestion[]
}

export type Grade = {
  id: string
  assessmentId: string
  assessmentTitle: string
  studentId: string
  studentName: string
  points: number | null
  maxPoints: number
  percent: number | null
  source: GradeSourceKind
  published: boolean
  publishedAt: string | null
  overrideReason?: string
  approvedBy?: string
}

export type CatmeRatings = {
  contributing: number
  interacting: number
  keepingOnTrack: number
  expectingQuality: number
  knowledgeSkillsAbilities: number
}

export type PeerEvaluation = {
  id: string
  evaluatorId: string
  evaluatorName: string
  evaluateeId: string
  evaluateeName: string
  state: PeerEvaluationState
  ratings: CatmeRatings | null
  overall: number | null
  comments: string | null
  submittedAt: string | null
}

export type GroupMember = {
  studentId: string
  name: string
  registerNumber: string
  role: string | null
  adjustmentFactor: number | null
  selfAdjustmentFactor: number | null
  /** 0..1 share of the group's contribution signals. */
  contributionShare: number
  freeRider: boolean
}

export type Milestone = {
  id: string
  title: string
  description: string
  state: MilestoneState
  weight: number
  dueAt: string | null
  completedAt: string | null
}

export type ContributionEvent = {
  id: string
  studentId: string | null
  studentName: string | null
  kind: ContributionKind
  summary: string
  occurredAt: string
  weight: number
}

export type Group = {
  id: string
  name: string
  projectTitle: string
  state: GroupState
  members: GroupMember[]
  peerEvaluations: PeerEvaluation[]
  milestones: Milestone[]
  contributions: ContributionEvent[]
  avgContribution: number
  lastActivityAt: string
  similarityFlag: boolean
}

export type TestCase = {
  id: string
  order: number
  name: string
  description: string
  category: string
  isHidden: boolean
  points: number
  /** `null` means the case has not been run yet. */
  lastResult: StatusKey | null
}

export type TestRun = {
  id: string
  studentId: string
  studentName: string
  state: TestRunState
  passedCount: number
  failedCount: number
  totalCount: number
  coverage: number | null
  runtimeMs: number | null
  finishedAt: string | null
  stderr: string | null
}

export type SimilarityRow = {
  id: string
  studentName: string
  comparedStudentName: string
  /** 0..1 */
  similarity: number
  verdict: StatusKey
}

export type CodeTask = {
  id: string
  assessmentId: string
  title: string
  language: string
  instructions: string
  timeLimitMs: number
  memoryLimitMb: number
  testCases: TestCase[]
  runs: TestRun[]
  avgPassRate: number | null
  avgCoverage: number | null
  similarity: SimilarityRow[]
}

export type DistributionBucket = { bucket: string; count: number }

export type TrendPoint = { period: string; value: number | null; average: number | null }

export type TopicMastery = {
  topic: string
  /** `null` when the topic has too few responses to report. */
  mastery: number | null
  responses: number
}

export type CourseRating = {
  id: string
  studentName: string
  rating: number
  comment: string | null
  createdAt: string
  purged: boolean
}

export type ExportRow = {
  id: string
  target: string
  platform: string
  course: string
  state: StatusKey
  lastSyncedAt: string | null
  mappedUsers: number
  totalUsers: number
  issues: string[]
  lineItemsUrl: string | null
}

export type AuditEvent = {
  id: string
  action: string
  entityType: string
  entityId: string
  actorName: string
  actorRole: string
  summary: string
  createdAt: string
  tone: StatusKey
}

export type AdminUser = {
  id: string
  name: string
  email: string
  role: string
  state: StatusKey
  offerings: number
  lastLoginAt: string | null
}

export type AdminOffering = {
  id: string
  courseCode: string
  courseName: string
  section: string
  teacherName: string
  term: string
  enrolled: number
  capacity: number
  state: StatusKey
}

export type AdminDataset = {
  id: string
  name: string
  source: string
  rowCount: number
  updatedAt: string
  owner: string
  state: StatusKey
  /** `null` when results are not published, so the purge clock has not started. */
  retentionUntil: string | null
}

export type Kpi = {
  id: string
  label: string
  value: string
  hint?: string
  delta?: {
    value: string
    direction: "up" | "down" | "flat"
    sentiment: "positive" | "negative" | "neutral"
  }
  tone?: StatusKey
}

/** One row of the teacher "Submissions" table. */
export type SubmissionRow = {
  id: string
  assessmentId: string
  assessmentTitle: string
  kind: AssessmentKind
  studentId: string
  studentName: string
  state: SubmissionState
  submittedAt: string | null
  points: number | null
  maxPoints: number
  published: boolean
  gradedAt: string | null
  feedback: string | null
  versionCount: number
  late: boolean
}

/** One row of a student's own assessment list. */
export type StudentAssessmentRow = {
  assessmentId: string
  title: string
  kind: AssessmentKind
  dueAt: string
  state: StatusKey
  points: number | null
  maxPoints: number
  submittedAt: string | null
  feedback: string | null
  published: boolean
}

/** A calendar entry for the planner and the "upcoming" panels. */
export type CalendarEventView = {
  id: string
  title: string
  kind: "CLASS" | "ASSESSMENT" | "HOLIDAY" | "REMINDER"
  startAt: string
  endAt: string | null
  location: string | null
  courseCode: string | null
  detail: string | null
}

/** A course material in the resources library. */
export type MaterialView = {
  id: string
  title: string
  kind: "DOCUMENT" | "SLIDE_DECK" | "VIDEO" | "TRANSCRIPT" | "LINK" | "OTHER"
  topic: string
  sourceUrl: string | null
  mimeType: string | null
  sizeLabel: string | null
  updatedAt: string
  courseCode: string
  /** Whether the retrieval index has processed it (quiz AI depends on this). */
  indexed: boolean
  chunks: number
  state: StatusKey
}

/** One adaptive-retake recommendation built from the weakest subtopics. */
export type RetakeRecommendation = {
  id: string
  topic: string
  /** `null` when there is not enough attempt history to score the topic. */
  mastery: number | null
  questions: number
  reason: string
  state: StatusKey
}

/** A maintenance/diagnostic action in the admin tools panel. */
export type AdminTool = {
  id: string
  name: string
  description: string
  category: "Retention" | "Integrations" | "Diagnostics" | "Access"
  state: StatusKey
  /** `null` when the tool has never been run. */
  lastRunAt: string | null
  lastRunBy: string | null
}

/** A platform feature flag. */
export type FeatureFlag = {
  id: string
  key: string
  description: string
  enabled: boolean
  rolloutPercent: number
  owner: string
}
