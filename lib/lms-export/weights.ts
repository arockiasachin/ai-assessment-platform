import type { FinalGradeCategoryConfig, FinalGradeConfig } from "@/lib/contracts/lms-export"

import { LmsExportValidationError } from "./errors"

/**
 * Pure coherence checks for a weighted-final-grade configuration.
 *
 * Category weights are percentages and must sum to 100. The tolerance absorbs
 * floating-point noise from values like `33.33 + 33.33 + 33.34` while still
 * rejecting a configuration that is materially wrong.
 */
export const WEIGHT_TOTAL = 100
export const WEIGHT_SUM_TOLERANCE = 0.01
export const MAX_CATEGORIES = 50

export type WeightValidationContext = {
  /** When supplied, every referenced assessment must be one of these ids. */
  knownAssessmentIds?: readonly string[]
}

/** Sum of the category weights, rounded to avoid float noise in messages. */
export function totalWeight(config: FinalGradeConfig): number {
  const sum = config.categories.reduce((accumulator, category) => accumulator + category.weight, 0)
  return Math.round(sum * 1e6) / 1e6
}

function assertUnique(values: readonly string[], kind: string): void {
  const seen = new Set<string>()
  for (const value of values) {
    const key = value.toLowerCase()
    if (seen.has(key)) {
      throw new LmsExportValidationError(
        `${kind}s must be unique; "${value}" appears more than once.`,
      )
    }
    seen.add(key)
  }
}

/**
 * Validate a weight configuration, throwing a status-carrying 400 with a
 * human-readable reason. This is the single gate every entry point calls before
 * a final grade is computed or exported.
 */
export function validateFinalGradeConfig(
  config: FinalGradeConfig,
  context: WeightValidationContext = {},
): void {
  if (config.categories.length === 0) {
    throw new LmsExportValidationError("A final grade configuration needs at least one category.")
  }
  if (config.categories.length > MAX_CATEGORIES) {
    throw new LmsExportValidationError(
      `A final grade configuration can have at most ${MAX_CATEGORIES} categories.`,
    )
  }

  assertUnique(
    config.categories.map((category) => category.id),
    "Category id",
  )
  assertUnique(
    config.categories.map((category) => category.name),
    "Category name",
  )

  const known = context.knownAssessmentIds ? new Set(context.knownAssessmentIds) : null
  const assignedTo = new Map<string, string>()

  for (const category of config.categories) {
    if (!Number.isFinite(category.weight) || category.weight <= 0) {
      throw new LmsExportValidationError(
        `Category "${category.name}" weight must be a positive number.`,
      )
    }
    if (category.assessmentIds.length === 0) {
      throw new LmsExportValidationError(
        `Category "${category.name}" must contain at least one assessment.`,
      )
    }

    for (const assessmentId of category.assessmentIds) {
      const previous = assignedTo.get(assessmentId)
      if (previous !== undefined) {
        throw new LmsExportValidationError(
          `Assessment "${assessmentId}" is assigned to both "${previous}" and "${category.name}"; each assessment may belong to only one category.`,
        )
      }
      assignedTo.set(assessmentId, category.name)
      if (known && !known.has(assessmentId)) {
        throw new LmsExportValidationError(
          `Assessment "${assessmentId}" in category "${category.name}" does not belong to this offering.`,
        )
      }
    }

    if (category.assessmentWeights) {
      const inCategory = new Set(category.assessmentIds)
      for (const [assessmentId, weight] of Object.entries(category.assessmentWeights)) {
        if (!inCategory.has(assessmentId)) {
          throw new LmsExportValidationError(
            `Category "${category.name}" has an assessment weight for "${assessmentId}", which is not in the category.`,
          )
        }
        if (!Number.isFinite(weight) || weight <= 0) {
          throw new LmsExportValidationError(
            `Category "${category.name}" assessment weight for "${assessmentId}" must be a positive number.`,
          )
        }
      }
    }
  }

  const sum = totalWeight(config)
  if (Math.abs(sum - WEIGHT_TOTAL) > WEIGHT_SUM_TOLERANCE) {
    throw new LmsExportValidationError(
      `Category weights must sum to ${WEIGHT_TOTAL} (they sum to ${sum}).`,
    )
  }
}

/**
 * The implicit configuration used when a teacher does not supply one: every
 * assessment in a single category weighted 100, i.e. equal weighting.
 */
export function defaultFinalGradeConfig(assessments: readonly { id: string }[]): FinalGradeConfig {
  const assessmentIds = assessments.map((assessment) => assessment.id)
  return {
    categories: [
      {
        id: "all-assessments",
        name: "All assessments",
        weight: WEIGHT_TOTAL,
        assessmentIds,
      },
    ],
  }
}

/** The weight a single assessment carries inside its category (default 1). */
export function assessmentWeight(category: FinalGradeCategoryConfig, assessmentId: string): number {
  return category.assessmentWeights?.[assessmentId] ?? 1
}

/** The category an assessment belongs to, or `null` when unconfigured. */
export function categoryForAssessment(
  config: FinalGradeConfig,
  assessmentId: string,
): FinalGradeCategoryConfig | null {
  return config.categories.find((category) => category.assessmentIds.includes(assessmentId)) ?? null
}
