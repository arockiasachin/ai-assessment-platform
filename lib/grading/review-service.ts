import {
  aiGradeSuggestionInputSchema,
  reviewDecisionSchema,
  type AiGradeSuggestionInput,
  type AiGradeSuggestionResponse,
  type GradeResponse,
  type GradeReviewResponse,
  type GradeReviewStatusValue,
  type ReviewDecision,
} from "@/lib/contracts/grading"
import type { AIGradeSuggestion, Grade, GradeReview } from "@/lib/generated/prisma/client"
import type { Prisma } from "@/lib/generated/prisma/client"
import { prisma } from "@/lib/prisma"

import { writeAuditLog, type AuditActor } from "./audit"
import { GradePipelineError } from "./errors"
import { resolveTransition } from "./state-machine"

/**
 * Service layer for the `AIGradeSuggestion` -> `GradeReview` -> `Grade`
 * pipeline. Every mutation runs in a transaction with its `AuditLog` rows, and
 * the only code paths that set `Grade.publishedAt` require an explicit human
 * reviewer identity.
 */

/** The authenticated staff member performing a review decision. */
export type GradeReviewActor = { id: string; role: "admin" | "teacher" }

type AssessmentForReview = {
  id: string
  maxMarks: number
  createdById: string
  offering: { teacherId: string } | null
}

function serializeSuggestion(suggestion: AIGradeSuggestion): AiGradeSuggestionResponse {
  return {
    id: suggestion.id,
    assessmentId: suggestion.assessmentId,
    studentId: suggestion.studentId,
    criterionLabel: suggestion.criterionLabel,
    suggestedPoints: Number(suggestion.suggestedPoints),
    maxPoints: suggestion.maxPoints === null ? null : Number(suggestion.maxPoints),
    rationale: suggestion.rationale,
    evidence: suggestion.evidence,
    confidence: suggestion.confidence,
    model: suggestion.model,
    promptVersion: suggestion.promptVersion,
    latencyMs: suggestion.latencyMs,
    createdAt: suggestion.createdAt.toISOString(),
  }
}

function serializeReview(review: GradeReview): GradeReviewResponse {
  return {
    id: review.id,
    assessmentId: review.assessmentId,
    studentId: review.studentId,
    status: review.status,
    reviewerId: review.reviewerId,
    notes: review.notes,
    decidedAt: review.decidedAt?.toISOString() ?? null,
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString(),
  }
}

function serializeGrade(grade: Grade): GradeResponse {
  return {
    id: grade.id,
    assessmentId: grade.assessmentId,
    studentId: grade.studentId,
    points: Number(grade.points),
    maxPoints: Number(grade.maxPoints),
    percentage: grade.percentage,
    source: grade.source,
    approvedById: grade.approvedById,
    overrideReason: grade.overrideReason,
    publishedAt: grade.publishedAt?.toISOString() ?? null,
    isPublished: grade.publishedAt !== null,
  }
}

async function resolveMaxPoints(
  tx: Prisma.TransactionClient,
  assessmentId: string,
  assessmentMaxMarks: number,
): Promise<number> {
  const rubric = await tx.rubric.findUnique({
    where: { assessmentId },
    select: { maxPoints: true },
  })
  if (rubric?.maxPoints !== null && rubric?.maxPoints !== undefined) {
    return Number(rubric.maxPoints)
  }
  return assessmentMaxMarks
}

/**
 * The logical bucket a suggestion scores, so re-running the model for the same
 * criterion/response supersedes the previous score instead of adding to it.
 * Without this, every model re-run silently inflates the draft (and then the
 * published) grade.
 */
function suggestionGroupKey(suggestion: {
  rubricCriterionId: string | null
  quizResponseId: string | null
  submissionId: string | null
  criterionLabel: string | null
}): string {
  if (suggestion.rubricCriterionId) return `criterion:${suggestion.rubricCriterionId}`
  if (suggestion.quizResponseId) return `quizResponse:${suggestion.quizResponseId}`
  if (suggestion.submissionId) return `submission:${suggestion.submissionId}`
  if (suggestion.criterionLabel) return `label:${suggestion.criterionLabel}`
  return "overall"
}

/**
 * Sum the *latest* suggestion per logical bucket. `count` is the number of
 * suggestion rows seen, which callers use to distinguish "no AI input" from
 * "all suggestions scored zero".
 */
async function latestSuggestionTotals(
  tx: Prisma.TransactionClient,
  assessmentId: string,
  studentId: string,
): Promise<{ total: number; count: number }> {
  const suggestions = await tx.aIGradeSuggestion.findMany({
    where: { assessmentId, studentId },
    select: {
      suggestedPoints: true,
      rubricCriterionId: true,
      quizResponseId: true,
      submissionId: true,
      criterionLabel: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  })

  const latestPointsByGroup = new Map<string, number>()
  for (const suggestion of suggestions) {
    const key = suggestionGroupKey(suggestion)
    if (!latestPointsByGroup.has(key)) {
      latestPointsByGroup.set(key, Number(suggestion.suggestedPoints))
    }
  }

  let total = 0
  for (const points of latestPointsByGroup.values()) total += points

  return { total: Math.max(0, total), count: suggestions.length }
}

/**
 * Object-level authorization: a teacher may only manage reviews for assessments
 * they created or offer. Admins may manage any. Returns the reviewer's staff id
 * (null when an admin has no staff profile), for `Grade.approvedById`.
 */
async function assertCanManageAssessment(
  tx: Prisma.TransactionClient,
  assessment: AssessmentForReview,
  reviewer: GradeReviewActor,
): Promise<string | null> {
  if (reviewer.role !== "teacher" && reviewer.role !== "admin") {
    throw new GradePipelineError(403, "Forbidden")
  }

  const staff = await tx.staffProfile.findUnique({
    where: { userId: reviewer.id },
    select: { id: true },
  })

  if (reviewer.role === "admin") return staff?.id ?? null

  if (!staff) throw new GradePipelineError(403, "Forbidden")
  const ownsAssessment =
    assessment.createdById === staff.id || assessment.offering?.teacherId === staff.id
  if (!ownsAssessment) throw new GradePipelineError(403, "Forbidden")

  return staff.id
}

function appendDecision(
  existing: Prisma.JsonValue,
  entry: Record<string, unknown>,
): Prisma.InputJsonValue {
  const list = Array.isArray(existing) ? existing : []
  return [...list, entry] as unknown as Prisma.InputJsonValue
}

/**
 * Record one AI suggestion and keep the review/grade in sync.
 *
 * A new suggestion puts the review in `PENDING` (or reopens a `REJECTED` one)
 * and refreshes the *unpublished* draft `Grade`. A published grade is never
 * mutated by a model output; it can only change through a human override.
 */
export async function recordAiSuggestion(
  input: AiGradeSuggestionInput,
  actor: AuditActor = { role: "system" },
) {
  const data = aiGradeSuggestionInputSchema.parse(input)

  return prisma.$transaction(async (tx) => {
    const assessment = await tx.assessment.findUnique({
      where: { id: data.assessmentId },
      select: {
        id: true,
        maxMarks: true,
        createdById: true,
        offering: { select: { teacherId: true } },
      },
    })
    if (!assessment) throw new GradePipelineError(404, "Assessment not found.")

    const student = await tx.studentProfile.findUnique({
      where: { id: data.studentId },
      select: { id: true },
    })
    if (!student) throw new GradePipelineError(404, "Student not found.")

    let review = await tx.gradeReview.findUnique({
      where: {
        assessmentId_studentId: { assessmentId: data.assessmentId, studentId: data.studentId },
      },
    })

    if (!review) {
      review = await tx.gradeReview.create({
        data: { assessmentId: data.assessmentId, studentId: data.studentId, status: "PENDING" },
      })
      await writeAuditLog(tx, {
        entityType: "GradeReview",
        entityId: review.id,
        action: "grade_review.created",
        actor,
        after: { status: "PENDING" },
      })
    } else if (review.status === "REJECTED") {
      const previous = review.status
      review = await tx.gradeReview.update({
        where: { id: review.id },
        data: { status: "PENDING", decidedAt: null },
      })
      await writeAuditLog(tx, {
        entityType: "GradeReview",
        entityId: review.id,
        action: "grade_review.reopened",
        actor,
        before: { status: previous },
        after: { status: "PENDING" },
      })
    }

    const suggestion = await tx.aIGradeSuggestion.create({
      data: {
        assessmentId: data.assessmentId,
        studentId: data.studentId,
        submissionId: data.submissionId,
        quizResponseId: data.quizResponseId,
        rubricCriterionId: data.rubricCriterionId,
        criterionLabel: data.criterionLabel,
        suggestedPoints: data.suggestedPoints,
        maxPoints: data.maxPoints,
        rationale: data.rationale,
        evidence: data.evidence,
        confidence: data.confidence,
        model: data.model,
        promptVersion: data.promptVersion,
        promptTokens: data.promptTokens,
        completionTokens: data.completionTokens,
        latencyMs: data.latencyMs,
        rawResponse: data.rawResponse as Prisma.InputJsonValue | undefined,
      },
    })

    await writeAuditLog(tx, {
      entityType: "AIGradeSuggestion",
      entityId: suggestion.id,
      action: "ai_suggestion.recorded",
      actor,
      after: {
        assessmentId: data.assessmentId,
        studentId: data.studentId,
        suggestedPoints: data.suggestedPoints,
        confidence: data.confidence,
        model: data.model,
        promptVersion: data.promptVersion,
        latencyMs: data.latencyMs,
      },
    })

    const maxPoints = await resolveMaxPoints(tx, assessment.id, assessment.maxMarks)
    const { total: latestTotal } = await latestSuggestionTotals(
      tx,
      data.assessmentId,
      data.studentId,
    )
    const total = Math.min(latestTotal, maxPoints)

    const existingGrade = await tx.grade.findUnique({
      where: {
        assessmentId_studentId: { assessmentId: data.assessmentId, studentId: data.studentId },
      },
    })

    // Never let a new model output rewrite a grade a human already published.
    const grade =
      existingGrade?.publishedAt != null
        ? existingGrade
        : await tx.grade.upsert({
            where: {
              assessmentId_studentId: {
                assessmentId: data.assessmentId,
                studentId: data.studentId,
              },
            },
            create: {
              assessmentId: data.assessmentId,
              studentId: data.studentId,
              reviewId: review.id,
              points: total,
              maxPoints,
              percentage: maxPoints > 0 ? (total / maxPoints) * 100 : null,
              source: "AI_SUGGESTED",
            },
            update: {
              reviewId: review.id,
              points: total,
              maxPoints,
              percentage: maxPoints > 0 ? (total / maxPoints) * 100 : null,
              source: "AI_SUGGESTED",
            },
          })

    // A model output may only refresh an *unpublished* draft. A published grade
    // is returned untouched (and deliberately not re-audited) above.
    if (existingGrade?.publishedAt == null) {
      await writeAuditLog(tx, {
        entityType: "Grade",
        entityId: grade.id,
        action: existingGrade ? "grade.ai_draft_updated" : "grade.ai_draft_created",
        actor,
        after: { points: total, maxPoints, source: "AI_SUGGESTED" },
      })
    }

    return {
      suggestion: serializeSuggestion(suggestion),
      review: serializeReview(review),
      grade: serializeGrade(grade),
    }
  })
}

export type SubmitReviewDecisionInput = {
  assessmentId: string
  studentId: string
  reviewer: GradeReviewActor
  decision: ReviewDecision
}

/**
 * Apply one human review decision. `accept` and `override` publish the grade;
 * `flag`, `reject`, and `reopen` never do. Every transition is audited.
 */
export async function submitReviewDecision(input: SubmitReviewDecisionInput) {
  const decision = reviewDecisionSchema.parse(input.decision)

  return prisma.$transaction(async (tx) => {
    const assessment = await tx.assessment.findUnique({
      where: { id: input.assessmentId },
      select: {
        id: true,
        maxMarks: true,
        createdById: true,
        offering: { select: { teacherId: true } },
      },
    })
    if (!assessment) throw new GradePipelineError(404, "Assessment not found.")

    const reviewerStaffId = await assertCanManageAssessment(tx, assessment, input.reviewer)

    const review = await tx.gradeReview.findUnique({
      where: {
        assessmentId_studentId: {
          assessmentId: input.assessmentId,
          studentId: input.studentId,
        },
      },
    })
    if (!review) throw new GradePipelineError(404, "Grade review not found.")

    let nextStatus: GradeReviewStatusValue
    try {
      nextStatus = resolveTransition(review.status, decision.action)
    } catch (error) {
      throw new GradePipelineError(
        409,
        error instanceof Error ? error.message : "Illegal grade review transition.",
      )
    }

    const { total: suggestedTotal, count: suggestionCount } = await latestSuggestionTotals(
      tx,
      input.assessmentId,
      input.studentId,
    )

    if (decision.action === "accept" && suggestionCount === 0) {
      throw new GradePipelineError(409, "No AI suggestions to accept.")
    }

    const maxPoints = await resolveMaxPoints(tx, assessment.id, assessment.maxMarks)
    let publishedAt: Date | null = null
    let points = Math.min(suggestedTotal, maxPoints)
    let source: "AI_SUGGESTED" | "TEACHER_OVERRIDE" = "AI_SUGGESTED"
    let overrideReason: string | null = null
    let approvedById: string | null = null
    let decidedAt: Date | null = null

    if (decision.action === "accept") {
      publishedAt = new Date()
      decidedAt = publishedAt
      approvedById = reviewerStaffId
    } else if (decision.action === "override") {
      if (decision.points > maxPoints) {
        throw new GradePipelineError(
          400,
          `Override points cannot exceed the rubric ceiling of ${maxPoints}.`,
        )
      }
      publishedAt = new Date()
      decidedAt = publishedAt
      points = decision.points
      source = "TEACHER_OVERRIDE"
      overrideReason = decision.reason
      approvedById = reviewerStaffId
    } else if (decision.action === "reject") {
      decidedAt = new Date()
    }

    const grade = await tx.grade.upsert({
      where: {
        assessmentId_studentId: {
          assessmentId: input.assessmentId,
          studentId: input.studentId,
        },
      },
      create: {
        assessmentId: input.assessmentId,
        studentId: input.studentId,
        reviewId: review.id,
        points,
        maxPoints,
        percentage: maxPoints > 0 ? (points / maxPoints) * 100 : null,
        source,
        approvedById,
        overrideReason,
        publishedAt,
      },
      update: {
        reviewId: review.id,
        points,
        maxPoints,
        percentage: maxPoints > 0 ? (points / maxPoints) * 100 : null,
        source,
        approvedById,
        overrideReason,
        publishedAt,
      },
    })

    const notes =
      decision.action === "flag"
        ? (decision.notes ?? review.notes)
        : decision.action === "reject"
          ? (decision.reason ?? review.notes)
          : review.notes

    const updatedReview = await tx.gradeReview.update({
      where: { id: review.id },
      data: {
        status: nextStatus,
        reviewerId: reviewerStaffId,
        decidedAt,
        notes,
        decisionsJson: appendDecision(review.decisionsJson, {
          action: decision.action,
          reviewerId: reviewerStaffId,
          at: new Date().toISOString(),
        }),
      },
    })

    const actor: AuditActor = { id: input.reviewer.id, role: input.reviewer.role }
    const isPublishing = publishedAt !== null

    await writeAuditLog(tx, {
      entityType: "GradeReview",
      entityId: review.id,
      action: `grade_review.${decision.action}`,
      actor,
      before: { status: review.status },
      after: { status: nextStatus, published: isPublishing, points, maxPoints },
      metadata: decision.action === "override" ? { reason: decision.reason } : undefined,
    })

    if (isPublishing) {
      await writeAuditLog(tx, {
        entityType: "Grade",
        entityId: grade.id,
        action: "grade.published",
        actor,
        after: {
          points,
          maxPoints,
          source,
          approvedById,
          publishedAt: publishedAt?.toISOString() ?? null,
        },
      })
    }

    return { review: serializeReview(updatedReview), grade: serializeGrade(grade) }
  })
}
