import {
  rubricUpsertRequestSchema,
  type RubricCriterionInput,
  type RubricLevelInput,
  type RubricUpsertRequest,
} from "./contracts"
import { RubricValidationError } from "./errors"

/**
 * Rubric coherence rules, kept pure so they can be unit tested without a
 * database and reused by any authoring surface.
 *
 * The rubric is the binding grading contract (product spec rule 3), so the
 * checks are deliberately strict: a criterion must have a positive weight and
 * point ceiling, labels must be unique, any level cannot exceed its criterion's
 * ceiling, and the declared total must match the criteria and fit inside the
 * assessment's maximum.
 */

const EPSILON = 1e-6

export function roundPoints(value: number): number {
  return Math.round(value * 100) / 100
}

export type NormalizedCriterion = {
  order: number
  label: string
  description: string | null
  weight: number
  maxPoints: number
  levels: RubricLevelInput[]
}

export type RubricCoherence = {
  maxPoints: number
  criteria: NormalizedCriterion[]
}

export function validateRubricCoherence(
  input: RubricUpsertRequest,
  options: { assessmentMaxMarks: number },
): RubricCoherence {
  const issues: string[] = []
  const criteria = input.criteria

  if (criteria.length === 0) {
    issues.push("A rubric needs at least one criterion.")
  }

  const seenLabels = new Set<string>()
  for (const criterion of criteria) {
    const key = criterion.label.trim().toLowerCase()
    if (seenLabels.has(key)) {
      issues.push(`Duplicate criterion label "${criterion.label}".`)
    }
    seenLabels.add(key)

    if (!Number.isFinite(criterion.weight) || criterion.weight <= 0) {
      issues.push(`Criterion "${criterion.label}" must have a positive weight.`)
    }
    if (!Number.isFinite(criterion.maxPoints) || criterion.maxPoints <= 0) {
      issues.push(`Criterion "${criterion.label}" must have a positive point ceiling.`)
    }

    const seenLevels = new Set<string>()
    for (const level of criterion.levels ?? []) {
      const levelKey = level.label.trim().toLowerCase()
      if (seenLevels.has(levelKey)) {
        issues.push(`Criterion "${criterion.label}" has a duplicate level "${level.label}".`)
      }
      seenLevels.add(levelKey)
      if (
        Number.isFinite(level.points) &&
        Number.isFinite(criterion.maxPoints) &&
        level.points > criterion.maxPoints + EPSILON
      ) {
        issues.push(
          `Criterion "${criterion.label}" level "${level.label}" awards ${roundPoints(level.points)} points, above the criterion ceiling of ${roundPoints(criterion.maxPoints)}.`,
        )
      }
    }
  }

  const summedPoints = criteria.reduce(
    (total, criterion) => total + (Number.isFinite(criterion.maxPoints) ? criterion.maxPoints : 0),
    0,
  )

  if (input.maxPoints !== undefined && Math.abs(input.maxPoints - summedPoints) > EPSILON) {
    issues.push(
      `Rubric total ${roundPoints(input.maxPoints)} must equal the sum of criterion points ${roundPoints(summedPoints)}.`,
    )
  }

  const maxPoints = input.maxPoints ?? summedPoints

  if (Number.isFinite(maxPoints) && maxPoints <= 0) {
    issues.push("A rubric must be worth more than zero points.")
  }
  if (maxPoints > options.assessmentMaxMarks + EPSILON) {
    issues.push(
      `Rubric total ${roundPoints(maxPoints)} cannot exceed the assessment maximum of ${options.assessmentMaxMarks}.`,
    )
  }

  if (issues.length > 0) throw new RubricValidationError(issues)

  return {
    maxPoints: roundPoints(maxPoints),
    criteria: criteria.map((criterion, index) => ({
      order: index + 1,
      label: criterion.label.trim(),
      description: criterion.description?.trim() || null,
      weight: criterion.weight,
      maxPoints: roundPoints(criterion.maxPoints),
      levels: (criterion.levels ?? []).map((level) => ({
        label: level.label.trim(),
        descriptor: level.descriptor?.trim() || undefined,
        points: roundPoints(level.points),
      })),
    })),
  }
}

/** Parse-and-validate entry point for callers that receive untrusted input. */
export function parseRubricUpsertRequest(
  input: unknown,
  options: { assessmentMaxMarks: number },
): { request: RubricUpsertRequest; coherence: RubricCoherence } {
  const request = rubricUpsertRequestSchema.parse(input)
  return { request, coherence: validateRubricCoherence(request, options) }
}

/** Exposed for UI hints; keeps the "what counts as sane" rule in one place. */
export function criterionWeightIsSane(weight: number): boolean {
  return Number.isFinite(weight) && weight > 0 && weight <= 1000
}

export type { RubricCriterionInput }
