import { z } from "zod"

import type {
  AIGradeSuggestion,
  Grade,
  GradeReview,
  Rubric,
  RubricCriterion,
} from "@/lib/generated/prisma/client"
import type {
  AiGradeSuggestionResponse,
  GradeResponse,
  GradeReviewResponse,
} from "@/lib/contracts/grading"

import {
  rubricLevelInputSchema,
  type RubricCriterionResponse,
  type RubricResponse,
} from "./contracts"

/** Response serializers for the rubric-grading API surface. */

const levelsSchema = z.array(rubricLevelInputSchema)

function readLevels(levelsJson: unknown) {
  const parsed = levelsSchema.safeParse(levelsJson)
  return parsed.success ? parsed.data : []
}

export function serializeCriterion(criterion: RubricCriterion): RubricCriterionResponse {
  return {
    id: criterion.id,
    rubricId: criterion.rubricId,
    order: criterion.order,
    label: criterion.label,
    description: criterion.description,
    weight: criterion.weight,
    maxPoints: Number(criterion.maxPoints),
    levels: readLevels(criterion.levelsJson),
  }
}

export function serializeRubric(rubric: Rubric & { criteria: RubricCriterion[] }): RubricResponse {
  return {
    id: rubric.id,
    assessmentId: rubric.assessmentId,
    courseId: rubric.courseId,
    title: rubric.title,
    description: rubric.description,
    maxPoints: rubric.maxPoints === null ? null : Number(rubric.maxPoints),
    promptVersion: rubric.promptVersion,
    criteria: [...rubric.criteria]
      .sort((a, b) => a.order - b.order)
      .map((criterion) => serializeCriterion(criterion)),
  }
}

export function serializeSuggestion(suggestion: AIGradeSuggestion): AiGradeSuggestionResponse {
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

export function serializeReview(review: GradeReview): GradeReviewResponse {
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

export function serializeGrade(grade: Grade): GradeResponse {
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

/**
 * Read the AI flag reasons a previous evaluation wrote into
 * `GradeReview.decisionsJson`. Kept next to the serializers so the queue and the
 * flagging service agree on the shape.
 */
export function readAiFlagReasons(decisionsJson: unknown): string[] {
  if (!Array.isArray(decisionsJson)) return []
  const reasons: string[] = []
  for (const entry of decisionsJson) {
    if (!entry || typeof entry !== "object") continue
    const record = entry as Record<string, unknown>
    if (record.kind !== "ai_flag") continue
    const entryReasons = record.reasons
    if (!Array.isArray(entryReasons)) continue
    for (const reason of entryReasons) {
      if (typeof reason === "string" && reason.trim().length > 0) reasons.push(reason)
    }
  }
  return reasons
}
