import {
  offeringGradingConfigSchema,
  type OfferingGradingConfigValue,
} from "@/lib/contracts/courses"
import type { FinalGradeConfig } from "@/lib/contracts/lms-export"

import {
  DEFAULT_CATEGORY_WEIGHTS,
  DEFAULT_FAT_MINIMUM_CAT_PERCENT,
  deriveDefaultGradingConfig,
  type GradingAssessmentInput,
} from "./policy"

/**
 * The offering's grading policy: reading it, defaulting it, and resolving it into the
 * weighted configuration the export actually computes with.
 *
 * ## Why this module exists
 *
 * `lib/grading/policy.ts` holds the rules (the split, the gate, the inclusion rule) and
 * `lib/lms-export/*` holds the weighted total. Neither knew about the other, so the policy
 * was a tested library that nothing in the product called: the export fell back to
 * `defaultFinalGradeConfig`, which weights every assessment equally and expresses no CAT/FAT
 * shape at all, and the FAT gate was never evaluated for anyone.
 *
 * This module is the seam. It is the **one** place a stored column becomes a grade
 * configuration, so the export, the policy editor, and any future reader cannot disagree
 * about what an offering's split is.
 *
 * ## The two failure modes, handled differently
 *
 * - **Nothing stored** (`null` column) is the normal case for every offering that predates
 *   the column, and means "the defaults apply". Not an error.
 * - **Something stored that is unusable** — a hand-edited row, a value from an older shape,
 *   weights that no longer sum to 100 — falls back to the defaults rather than throwing.
 *   This is deliberate: the column is read on the export path, and an offering with a
 *   malformed policy should export with the documented default split, not fail entirely.
 *   The reader reports which case it was, so the UI can distinguish them.
 */

/** The stored shape, or `null` when the offering has never been configured. */
export type StoredGradingConfig = OfferingGradingConfigValue | null

/** Why the effective policy is what it is. */
export type GradingConfigSource = "stored" | "defaults" | "stored-invalid"

export type ResolvedGradingPolicy = {
  config: OfferingGradingConfigValue
  source: GradingConfigSource
}

/** The policy an unconfigured offering runs on: CAT 40 / FAT 60, gate at 30%. */
export function defaultOfferingGradingConfig(): OfferingGradingConfigValue {
  return {
    catWeight: DEFAULT_CATEGORY_WEIGHTS.CAT,
    fatWeight: DEFAULT_CATEGORY_WEIGHTS.FAT,
    finalAssessmentId: null,
    minimumCatPercent: DEFAULT_FAT_MINIMUM_CAT_PERCENT,
  }
}

/**
 * Validate a value read from the JSON column.
 *
 * Returns `null` for anything unusable — including a partial object, which is why this goes
 * through the schema rather than checking for `undefined` field by field. A caller cannot
 * tell "absent" from "malformed" from the return value alone, so `resolveGradingPolicy`
 * below is the one to use when that distinction matters.
 */
export function parseStoredGradingConfig(value: unknown): StoredGradingConfig {
  // `undefined` is Prisma's shape for a null JSON column; `null` is what a plain read gives.
  if (value === null || value === undefined) return null
  const parsed = offeringGradingConfigSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/**
 * The policy in force for an offering, and where it came from.
 *
 * This is what readers should call: it never throws, and it tells the caller whether the
 * offering is running on its own configuration or on the defaults — which the policy editor
 * has to show, because "CAT 40 / FAT 60" looks identical either way.
 */
export function resolveGradingPolicy(stored: unknown): ResolvedGradingPolicy {
  if (stored === null || stored === undefined) {
    return { config: defaultOfferingGradingConfig(), source: "defaults" }
  }
  const parsed = offeringGradingConfigSchema.safeParse(stored)
  return parsed.success
    ? { config: parsed.data, source: "stored" }
    : { config: defaultOfferingGradingConfig(), source: "stored-invalid" }
}

export type DerivedGradingMembership = {
  catAssessmentIds: string[]
  fatAssessmentId: string | null
  /** True when the FAT came from the due-date heuristic rather than a teacher's choice. */
  fatDerived: boolean
}

/**
 * The CAT/FAT membership a policy implies for a set of assessments.
 *
 * Split out from `resolveFinalGradeConfig` so the policy editor can display the membership
 * without building a whole grade configuration, and so there is one definition of it.
 * Returns `null` when there are fewer than two assessments: there is no split to draw.
 */
export function derivedGradingMembership(
  config: OfferingGradingConfigValue,
  assessments: readonly GradingAssessmentInput[],
): DerivedGradingMembership | null {
  const gradeConfig = resolveFinalGradeConfig(config, assessments)
  if (gradeConfig === null) return null

  const cat = gradeConfig.categories.find((category) => category.id === "cat")
  const fat = gradeConfig.categories.find((category) => category.id === "fat")
  const fatAssessmentId = fat?.assessmentIds[0] ?? null

  return {
    catAssessmentIds: cat?.assessmentIds ?? [],
    fatAssessmentId,
    // The membership resolver only honours an explicit id it can actually find.
    fatDerived: config.finalAssessmentId === null || config.finalAssessmentId !== fatAssessmentId,
  }
}

/**
 * Resolve a policy plus an offering's assessments into the weighted configuration
 * `computeFinalGrade` understands.
 *
 * `null` when there are fewer than two assessments — with one assessment, or none, there is
 * no CAT/FAT shape to express, and the caller keeps the equal-weight default, which is the
 * honest answer for a course that has a single component.
 *
 * The category weights come from the policy; the membership is derived. The FAT carries no
 * explicit `assessmentWeights` because it holds exactly one assessment, so the whole pool
 * goes to it either way.
 */
export function resolveFinalGradeConfig(
  config: OfferingGradingConfigValue,
  assessments: readonly GradingAssessmentInput[],
): FinalGradeConfig | null {
  return deriveDefaultGradingConfig(assessments, {
    weights: { CAT: config.catWeight, FAT: config.fatWeight },
    finalAssessmentId: config.finalAssessmentId,
  })
}
