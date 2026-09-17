import type { AnalyticsSettingsResponse, AnalyticsSettingsValue } from "@/lib/contracts/analytics"

/**
 * Pure view logic for the analytics-threshold editor.
 *
 * ## Why this exists
 *
 * `GET`/`PUT /api/teacher/analytics/settings` shipped in Wave 2 and **had no caller** — the one route
 * in the analytics pod with no UI. It was dropped from the Wave 3 port deliberately, because the
 * mockup's "Analytics settings" control was inert and shipping it inert would have violated the
 * dangling-affordance rule. Wiring it is a form, not a port, which is why it needed its own slice.
 *
 * ## The shape of the problem
 *
 * Every threshold is **optional by design**: an omitted key keeps the code default in
 * `lib/analytics/{alerts,item-analysis}`. So the form has three states per field, and conflating them
 * would be a data-loss bug of exactly the kind this project guards against elsewhere:
 *
 * - **blank** — no override, the code default applies;
 * - **a number** — an explicit override;
 * - **invalid** — refused, with a message, rather than silently coerced.
 *
 * The field descriptors below are the single source of truth for the form **and** its validation, so a
 * field cannot be rendered with bounds its validator does not enforce.
 */

export type ThresholdKind = "percent" | "share" | "count" | "positiveCount"

export type ThresholdField = {
  key: string
  label: string
  /** How the value reads to a human, and what the validator enforces. */
  kind: ThresholdKind
  hint: string
}

/** The intervention thresholds — when a cohort is flagged for attention. */
export const INTERVENTION_FIELDS: readonly ThresholdField[] = [
  {
    key: "classAverageBelow",
    label: "Class average below",
    kind: "percent",
    hint: "Flag when a class average falls under this percentage.",
  },
  {
    key: "minClassSampleSize",
    label: "Minimum class sample",
    kind: "count",
    hint: "Do not judge a class average from fewer than this many attempts.",
  },
  {
    key: "contributionShareAtLeast",
    label: "Contribution share at least",
    kind: "share",
    hint: "Flag a group member contributing less than this share of the team's events.",
  },
  {
    key: "minContributionEvents",
    label: "Minimum contribution events",
    kind: "count",
    hint: "Ignore contribution shares computed from fewer events than this.",
  },
  {
    key: "pendingReviewsAtLeast",
    label: "Pending reviews at least",
    kind: "count",
    hint: "Flag a backlog of this many AI suggestions awaiting a decision.",
  },
] as const

/** The item-analysis thresholds — when a question's statistics are trustworthy. */
export const ITEM_ANALYSIS_FIELDS: readonly ThresholdField[] = [
  {
    key: "minAttemptsForDifficulty",
    label: "Minimum attempts for difficulty",
    kind: "positiveCount",
    hint: "Below this many attempts, difficulty is withheld rather than reported.",
  },
  {
    key: "minAttemptsForDiscrimination",
    label: "Minimum attempts for discrimination",
    kind: "positiveCount",
    hint: "Below this many attempts, discrimination is withheld rather than reported.",
  },
  {
    key: "extremeGroupFraction",
    label: "Extreme-group fraction",
    kind: "share",
    hint: "The share of the cohort taken from each end for the extreme-groups method.",
  },
] as const

export const ALL_THRESHOLD_FIELDS = [...INTERVENTION_FIELDS, ...ITEM_ANALYSIS_FIELDS] as const

/** One field's raw text, keyed by field key. `""` means "use the code default". */
export type ThresholdDraft = Record<string, string>

/**
 * The stored settings into form state.
 *
 * An override not present becomes `""` even though `payload.thresholds` carries the effective value —
 * that value is shown as the input's **placeholder**, not as its content. Writing the effective value
 * into the field would turn "no override" into "an override equal to today's default", which would then
 * stop tracking the default if it changed.
 */
export function toThresholdDraft(settings: AnalyticsSettingsValue): ThresholdDraft {
  const draft: ThresholdDraft = {}
  const sections: [readonly ThresholdField[], Record<string, number> | undefined][] = [
    [INTERVENTION_FIELDS, settings.intervention as Record<string, number> | undefined],
    [ITEM_ANALYSIS_FIELDS, settings.itemAnalysis as Record<string, number> | undefined],
  ]
  for (const [fields, section] of sections) {
    for (const field of fields) {
      const value = section?.[field.key]
      draft[field.key] = value === undefined ? "" : String(value)
    }
  }
  return draft
}

/** The effective value for a field, as the placeholder text. `undefined` when the payload has none. */
export function effectivePlaceholder(
  payload: AnalyticsSettingsResponse | null,
  field: ThresholdField,
): string | undefined {
  if (!payload) return undefined
  const section = INTERVENTION_FIELDS.includes(field)
    ? (payload.thresholds.intervention as unknown as Record<string, number>)
    : (payload.thresholds.itemAnalysis as unknown as Record<string, number>)
  const value = section?.[field.key]
  return value === undefined ? undefined : String(value)
}

/** Whether any field carries an override — i.e. whether the offering has been configured at all. */
export function hasAnyOverride(draft: ThresholdDraft): boolean {
  return Object.values(draft).some((value) => value.trim() !== "")
}

/** How many fields carry an override, for the panel's summary line. */
export function overrideCount(draft: ThresholdDraft): number {
  return Object.values(draft).filter((value) => value.trim() !== "").length
}

export type DraftValidation =
  { ok: true; settings: AnalyticsSettingsValue } | { ok: false; message: string }

function parseField(field: ThresholdField, raw: string): number | string {
  const value = Number(raw)
  if (!Number.isFinite(value)) return `“${field.label}” must be a number.`

  switch (field.kind) {
    case "percent":
      if (value < 0 || value > 100) return `“${field.label}” must be between 0 and 100.`
      return value
    case "share":
      // Stored as a fraction, not a percentage — the schema's own bound.
      if (value < 0 || value > 1) return `“${field.label}” must be between 0 and 1.`
      return value
    case "count":
      if (!Number.isInteger(value) || value < 0) {
        return `“${field.label}” must be a whole number, 0 or more.`
      }
      return value
    case "positiveCount":
      // The schema requires `positive()`, so 0 is not a small value here — it is invalid.
      if (!Number.isInteger(value) || value <= 0) {
        return `“${field.label}” must be a whole number greater than 0.`
      }
      return value
  }
}

/**
 * The request body for a draft, or the reason it cannot be sent.
 *
 * A field left blank is **omitted**, not sent as `null` or 0 — the API's merge keeps the code default
 * for an omitted key, and sending 0 would be a real (and wrong) override for every field whose valid
 * range includes zero. A section with no overrides is omitted entirely so the stored section is
 * preserved rather than cleared.
 */
export function thresholdDraftToSettings(draft: ThresholdDraft): DraftValidation {
  const intervention: Record<string, number> = {}
  const itemAnalysis: Record<string, number> = {}

  for (const field of ALL_THRESHOLD_FIELDS) {
    const raw = (draft[field.key] ?? "").trim()
    if (raw === "") continue
    const parsed = parseField(field, raw)
    if (typeof parsed === "string") return { ok: false, message: parsed }
    if (INTERVENTION_FIELDS.includes(field)) intervention[field.key] = parsed
    else itemAnalysis[field.key] = parsed
  }

  const settings: AnalyticsSettingsValue = {}
  if (Object.keys(intervention).length > 0) {
    settings.intervention = intervention as AnalyticsSettingsValue["intervention"]
  }
  if (Object.keys(itemAnalysis).length > 0) {
    settings.itemAnalysis = itemAnalysis as AnalyticsSettingsValue["itemAnalysis"]
  }
  return { ok: true, settings }
}

/** The panel's one-line summary. */
export function settingsSummary(payload: AnalyticsSettingsResponse | null): string {
  if (payload === null) return "When the analytics surfaces raise a flag."
  const count = overrideCount(toThresholdDraft(payload.settings))
  if (count === 0) return "Using the code defaults — nothing is overridden for this offering."
  return `${count} threshold${count === 1 ? "" : "s"} overridden for this offering.`
}
