import type {
  AiGradeSuggestionResponse,
  GradeResponse,
  GradeReviewResponse,
} from "@/lib/contracts/grading"
import { recordAiSuggestion } from "@/lib/grading"
import type { LlmGenerateResult, LlmMessage, LlmProvider } from "@/lib/llm"
import { getLlmProvider } from "@/lib/llm"
import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

import type { RubricLevelInput } from "./contracts"
import { RubricGradingError } from "./errors"
import { collectFlagReasons } from "./flagging"
import { parseCriterionEvaluation } from "./parsing"
import { flagReviewForAi } from "./review-transitions"
import { resolveTeacherStaffId, teacherOwnsAssessment } from "./rubric-service"
import { isGradeableSubmissionStatus } from "./submission-status"

/**
 * Per-criterion AI evaluation.
 *
 * The model is asked for one criterion at a time and must return a score, a
 * rationale, a quoted evidence span, and a confidence. The result is persisted
 * through `recordAiSuggestion`, which keeps only the latest suggestion per
 * logical bucket — so re-running evaluation supersedes the previous scores
 * instead of summing them (bug-fix run 1).
 *
 * Evaluation never publishes. It only refreshes the draft `Grade` and, when a
 * criterion is low-confidence, unverified, clamped, or the total is a cohort
 * outlier, moves the review to `NEEDS_REVIEW`.
 */

/** Bump whenever the criterion prompt template changes. Stored on every suggestion. */
export const RUBRIC_PROMPT_VERSION = "rubric-grading-v1"

export type CriterionPromptInput = {
  assessmentTitle: string
  criterionLabel: string
  criterionDescription: string | null
  levels: readonly RubricLevelInput[]
  maxPoints: number
  submissionText: string
}

export function buildCriterionPrompt(input: CriterionPromptInput): LlmMessage[] {
  const levels =
    input.levels.length > 0
      ? input.levels
          .map(
            (level) =>
              `- ${level.label}: up to ${level.points} points${level.descriptor ? ` — ${level.descriptor}` : ""}`,
          )
          .join("\n")
      : "No level descriptors were supplied; score against the criterion descriptor."

  return [
    {
      role: "system",
      content:
        "You are a meticulous, fair grading assistant. Score exactly ONE rubric criterion. " +
        "Respond with a single JSON object and nothing else, using this shape: " +
        '{"score": number, "rationale": string, "evidence": string, "confidence": number}. ' +
        "The score must be between 0 and the criterion maximum. The rationale must explain the score. " +
        "The evidence must be an exact, verbatim quote copied from the student's submission. " +
        "The confidence must be between 0 and 1 and reflect how certain you are.",
    },
    {
      role: "user",
      content: [
        `Assessment: ${input.assessmentTitle}`,
        `Criterion: ${input.criterionLabel}`,
        input.criterionDescription ? `Descriptor: ${input.criterionDescription}` : null,
        `Maximum points: ${input.maxPoints}`,
        `Levels:\n${levels}`,
        `Student submission:\n"""\n${input.submissionText}\n"""`,
        `Return the JSON object for "${input.criterionLabel}".`,
      ]
        .filter((line): line is string => line !== null)
        .join("\n\n"),
    },
  ]
}

export type EvaluationDeps = {
  /** Injected for tests; defaults to the process-wide provider from env. */
  provider?: LlmProvider
}

export type EvaluationOutcome = {
  suggestions: AiGradeSuggestionResponse[]
  review: GradeReviewResponse
  grade: GradeResponse
  /** True when at least one flag reason was raised. */
  flagged: boolean
  flagReasons: string[]
  /** The total points written to the draft grade (capped at the rubric ceiling). */
  totalPoints: number
}

type EvaluationAssessment = {
  id: string
  title: string
  maxMarks: number
  rubricMaxPoints: number
  createdById: string
  offering: { teacherId: string } | null
  criteria: Array<{
    id: string
    label: string
    description: string | null
    maxPoints: number
    levels: RubricLevelInput[]
  }>
}

const assessmentSelect = {
  id: true,
  title: true,
  maxMarks: true,
  createdById: true,
  offering: { select: { teacherId: true } },
  rubric: {
    select: {
      maxPoints: true,
      criteria: {
        orderBy: { order: "asc" as const },
        select: {
          id: true,
          label: true,
          description: true,
          maxPoints: true,
          levelsJson: true,
        },
      },
    },
  },
} as const

export async function evaluateSubmissionForTeacher(
  user: AuthUser,
  submissionId: string,
  deps: EvaluationDeps = {},
): Promise<EvaluationOutcome> {
  const staffId = await resolveTeacherStaffId(user)

  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      status: true,
      assessmentId: true,
      studentId: true,
      contentText: true,
      assessment: { select: assessmentSelect },
    },
  })
  if (!submission) throw new RubricGradingError(404, "Submission not found.")
  if (!teacherOwnsAssessment(submission.assessment, staffId)) {
    throw new RubricGradingError(403, "Forbidden")
  }
  // TN-35: the candidate reader hides a draft, but a caller with the submission
  // id could still ask the evaluator to score it. The same rule is enforced on
  // both paths so neither can publish a mark for work never handed in.
  if (!isGradeableSubmissionStatus(submission.status)) {
    throw new RubricGradingError(
      409,
      "Submission has not been handed in; there is nothing to grade.",
    )
  }

  const rubric = submission.assessment.rubric
  if (!rubric || rubric.criteria.length === 0) {
    throw new RubricGradingError(409, "Assessment has no rubric with criteria to grade against.")
  }

  const submissionText = submission.contentText?.trim() ?? ""
  if (submissionText.length === 0) {
    throw new RubricGradingError(409, "Submission has no text content to evaluate.")
  }

  const assessment: EvaluationAssessment = {
    id: submission.assessment.id,
    title: submission.assessment.title,
    maxMarks: submission.assessment.maxMarks,
    rubricMaxPoints: rubric.maxPoints === null ? 0 : Number(rubric.maxPoints),
    createdById: submission.assessment.createdById,
    offering: submission.assessment.offering,
    criteria: rubric.criteria.map((criterion) => ({
      id: criterion.id,
      label: criterion.label,
      description: criterion.description,
      maxPoints: Number(criterion.maxPoints),
      levels: Array.isArray(criterion.levelsJson)
        ? (criterion.levelsJson as unknown as RubricLevelInput[])
        : [],
    })),
  }

  const provider = deps.provider ?? getLlmProvider()
  const actor = { id: user.id, role: user.role }

  const suggestions: AiGradeSuggestionResponse[] = []
  const evaluations: Array<{
    criterionLabel: string
    confidence: number
    clampedToCeiling: boolean
    evidenceVerified: boolean
  }> = []
  let totalPoints = 0
  let grade: GradeResponse | null = null
  let review: GradeReviewResponse | null = null

  for (const criterion of assessment.criteria) {
    const messages = buildCriterionPrompt({
      assessmentTitle: assessment.title,
      criterionLabel: criterion.label,
      criterionDescription: criterion.description,
      levels: criterion.levels,
      maxPoints: criterion.maxPoints,
      submissionText,
    })

    let result: LlmGenerateResult
    try {
      result = await provider.generate({
        messages,
        task: "rubric-grading",
        promptVersion: RUBRIC_PROMPT_VERSION,
        json: true,
        temperature: 0,
      })
    } catch (error) {
      throw new RubricGradingError(
        502,
        `Model call failed for criterion "${criterion.label}": ${error instanceof Error ? error.message : "unknown error"}.`,
      )
    }

    const parsed = parseCriterionEvaluation(result.text, {
      criterionLabel: criterion.label,
      maxPoints: criterion.maxPoints,
      submissionText,
    })

    const recorded = await recordAiSuggestion(
      {
        assessmentId: assessment.id,
        studentId: submission.studentId,
        submissionId: submission.id,
        rubricCriterionId: criterion.id,
        criterionLabel: criterion.label,
        suggestedPoints: parsed.score,
        maxPoints: criterion.maxPoints,
        rationale: parsed.rationale,
        evidence: parsed.evidence,
        confidence: parsed.confidence,
        model: result.model,
        promptVersion: RUBRIC_PROMPT_VERSION,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        latencyMs: result.latencyMs,
        rawResponse: result.raw,
      },
      actor,
    )

    suggestions.push(recorded.suggestion)
    review = recorded.review
    grade = recorded.grade
    totalPoints += parsed.score
    evaluations.push({
      criterionLabel: criterion.label,
      confidence: parsed.confidence,
      clampedToCeiling: parsed.clampedToCeiling,
      evidenceVerified: parsed.evidenceVerified,
    })
  }

  if (!review || !grade) {
    throw new RubricGradingError(409, "No rubric criteria were evaluated.")
  }

  const cappedTotal =
    assessment.rubricMaxPoints > 0 ? Math.min(totalPoints, assessment.rubricMaxPoints) : totalPoints

  // Cohort signal: every other student's current grade total for this assessment.
  const cohort = await prisma.grade.findMany({
    where: { assessmentId: assessment.id, studentId: { not: submission.studentId } },
    select: { points: true },
  })
  const cohortPoints = cohort.map((row) => Number(row.points))

  const flagReasons = collectFlagReasons({
    evaluations,
    totalPoints: cappedTotal,
    cohortPoints,
  })

  if (flagReasons.length > 0) {
    review = await flagReviewForAi({
      assessmentId: assessment.id,
      studentId: submission.studentId,
      reasons: flagReasons,
      actor,
    })
  }

  return {
    suggestions,
    review,
    grade,
    flagged: flagReasons.length > 0,
    flagReasons,
    totalPoints: cappedTotal,
  }
}
