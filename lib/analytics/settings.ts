import { analyticsSettingsSchema, type AnalyticsSettingsValue } from "@/lib/contracts/analytics"

import { DEFAULT_INTERVENTION_THRESHOLDS, type InterventionThresholds } from "./alerts"
import { DEFAULT_ITEM_ANALYSIS_THRESHOLDS, type ItemAnalysisThresholds } from "./item-analysis"

/**
 * Persisted analytics settings, read from `CourseOffering.analyticsSettings`
 * (a JSON column). The column is instructor-controlled input, so it is parsed
 * defensively: a malformed value is treated as "unset" rather than failing a
 * read, and every missing key falls back to the code default. This keeps the
 * merge order explicit and testable:
 *
 *   code default  <-  persisted setting  <-  per-request override
 */

/** Parse the stored JSON, dropping anything that does not match the schema. */
export function readAnalyticsSettings(value: unknown): AnalyticsSettingsValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const parsed = analyticsSettingsSchema.safeParse(value)
  return parsed.success ? parsed.data : {}
}

/** Merge persisted intervention thresholds over the code defaults. */
export function resolveInterventionThresholds(
  stored: AnalyticsSettingsValue,
  overrides: Partial<InterventionThresholds> = {},
): InterventionThresholds {
  return {
    ...DEFAULT_INTERVENTION_THRESHOLDS,
    ...(stored.intervention ?? {}),
    ...overrides,
  }
}

/** Merge persisted item-analysis thresholds over the code defaults. */
export function resolveItemAnalysisThresholds(
  stored: AnalyticsSettingsValue,
  overrides: Partial<ItemAnalysisThresholds> = {},
): ItemAnalysisThresholds {
  return {
    ...DEFAULT_ITEM_ANALYSIS_THRESHOLDS,
    ...(stored.itemAnalysis ?? {}),
    ...overrides,
  }
}

/**
 * Combine an existing stored settings object with a new one. A provided
 * `intervention` / `itemAnalysis` section replaces that section wholesale, so a
 * teacher can clear a threshold by sending a section without it; omitted
 * sections are preserved.
 */
export function mergeAnalyticsSettings(
  current: AnalyticsSettingsValue,
  incoming: AnalyticsSettingsValue,
): AnalyticsSettingsValue {
  return {
    ...(incoming.intervention !== undefined
      ? { intervention: incoming.intervention }
      : current.intervention !== undefined
        ? { intervention: current.intervention }
        : {}),
    ...(incoming.itemAnalysis !== undefined
      ? { itemAnalysis: incoming.itemAnalysis }
      : current.itemAnalysis !== undefined
        ? { itemAnalysis: current.itemAnalysis }
        : {}),
  }
}
