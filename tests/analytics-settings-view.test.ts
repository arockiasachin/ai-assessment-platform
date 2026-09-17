import { describe, expect, it } from "vitest"

import type { AnalyticsSettingsResponse } from "@/lib/contracts/analytics"
import {
  ALL_THRESHOLD_FIELDS,
  effectivePlaceholder,
  hasAnyOverride,
  INTERVENTION_FIELDS,
  ITEM_ANALYSIS_FIELDS,
  overrideCount,
  settingsSummary,
  thresholdDraftToSettings,
  toThresholdDraft,
} from "@/lib/analytics/settings-view"

/**
 * The analytics-threshold editor's pure logic.
 *
 * These cover the slice that `GET`/`PUT /api/teacher/analytics/settings` had been missing: the route
 * shipped in Wave 2 with no caller, so these are the first assertions that its contract is usable.
 *
 * The tests concentrate on the three-state field, because that is where a data-loss bug would live:
 * **blank** must mean "keep the code default" and never be sent as `0`; **invalid** must be refused
 * rather than coerced; and a **blank section** must be omitted so the stored one is preserved rather
 * than cleared.
 */

const PAYLOAD: AnalyticsSettingsResponse = {
  success: true,
  offeringId: "o1",
  settings: {},
  thresholds: {
    intervention: {
      classAverageBelow: 50,
      minClassSampleSize: 5,
      contributionShareAtLeast: 0.2,
      minContributionEvents: 3,
      pendingReviewsAtLeast: 10,
    },
    itemAnalysis: {
      minAttemptsForDifficulty: 5,
      minAttemptsForDiscrimination: 20,
      extremeGroupFraction: 0.27,
    },
  },
}

describe("field descriptors", () => {
  it("covers every threshold the response carries", () => {
    // A threshold with no descriptor would be uneditable, and a descriptor with no threshold would
    // render an input that sends a key the API's schema rejects. The two lists must agree.
    const described = ALL_THRESHOLD_FIELDS.map((field) => field.key).sort()
    const fromPayload = [
      ...Object.keys(PAYLOAD.thresholds.intervention),
      ...Object.keys(PAYLOAD.thresholds.itemAnalysis),
    ].sort()

    expect(described).toEqual(fromPayload)
  })

  it("has no duplicate keys, which would silently drop an input", () => {
    const keys = ALL_THRESHOLD_FIELDS.map((field) => field.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe("toThresholdDraft", () => {
  it("leaves every field blank when nothing is stored", () => {
    // Blank means "the code default applies". Writing the effective value in would turn "no override"
    // into an override equal to today's default, which then stops tracking the default.
    const draft = toThresholdDraft({})

    expect(Object.values(draft).every((value) => value === "")).toBe(true)
    expect(hasAnyOverride(draft)).toBe(false)
    expect(overrideCount(draft)).toBe(0)
  })

  it("shows only the stored overrides, not the effective values", () => {
    const draft = toThresholdDraft({ intervention: { classAverageBelow: 42 } })

    expect(draft.classAverageBelow).toBe("42")
    expect(draft.minClassSampleSize).toBe("")
    expect(overrideCount(draft)).toBe(1)
  })

  it("keeps a stored zero, which is a real override", () => {
    // `minContributionEvents` allows 0, so a stored 0 is an override rather than an absent value.
    const draft = toThresholdDraft({ intervention: { minContributionEvents: 0 } })

    expect(draft.minContributionEvents).toBe("0")
    expect(hasAnyOverride(draft)).toBe(true)
  })
})

describe("effectivePlaceholder", () => {
  it("offers the effective value for a field, as a placeholder", () => {
    const field = INTERVENTION_FIELDS[0]
    expect(effectivePlaceholder(PAYLOAD, field)).toBe("50")

    const itemField = ITEM_ANALYSIS_FIELDS[0]
    expect(effectivePlaceholder(PAYLOAD, itemField)).toBe("5")
  })

  it("returns undefined with no payload rather than inventing a value", () => {
    expect(effectivePlaceholder(null, INTERVENTION_FIELDS[0])).toBeUndefined()
  })
})

describe("thresholdDraftToSettings", () => {
  it("omits blank fields instead of sending zero", () => {
    // The heart of it. `0` is inside the valid range of several fields, so sending it for an untouched
    // input would be a real and wrong override; omitting the key keeps the code default.
    const result = thresholdDraftToSettings({ classAverageBelow: "40" })

    expect(result.ok).toBe(true)
    expect(result.ok && result.settings).toEqual({ intervention: { classAverageBelow: 40 } })
    expect(result.ok && result.settings.intervention).not.toHaveProperty("minClassSampleSize")
  })

  it("omits a whole section that has no overrides, so the stored one is preserved", () => {
    const result = thresholdDraftToSettings({ classAverageBelow: "40" })

    expect(result.ok && result.settings).not.toHaveProperty("itemAnalysis")
  })

  it("returns an empty object for an entirely blank draft", () => {
    const result = thresholdDraftToSettings({})

    expect(result.ok).toBe(true)
    expect(result.ok && result.settings).toEqual({})
  })

  it("routes each field to its own section", () => {
    const result = thresholdDraftToSettings({
      classAverageBelow: "40",
      minAttemptsForDiscrimination: "25",
    })

    expect(result.ok && result.settings).toEqual({
      intervention: { classAverageBelow: 40 },
      itemAnalysis: { minAttemptsForDiscrimination: 25 },
    })
  })

  it("accepts a stored zero", () => {
    const result = thresholdDraftToSettings({ minContributionEvents: "0" })

    expect(result.ok).toBe(true)
    expect(result.ok && result.settings.intervention).toEqual({ minContributionEvents: 0 })
  })

  it("treats whitespace as blank", () => {
    const result = thresholdDraftToSettings({ classAverageBelow: "   " })

    expect(result.ok && result.settings).toEqual({})
  })

  it.each([
    ["a percentage above 100", { classAverageBelow: "101" }, /between 0 and 100/],
    ["a negative percentage", { classAverageBelow: "-1" }, /between 0 and 100/],
    ["a share above 1", { contributionShareAtLeast: "1.5" }, /between 0 and 1/],
    ["a fractional count", { minContributionEvents: "2.5" }, /whole number/],
    ["a negative count", { minClassSampleSize: "-1" }, /whole number/],
    [
      "a zero where the schema requires positive",
      { minAttemptsForDifficulty: "0" },
      /greater than 0/,
    ],
    ["a non-number", { classAverageBelow: "abc" }, /must be a number/],
  ])("refuses %s with a message naming the field", (_label, draft, pattern) => {
    const result = thresholdDraftToSettings(draft)

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toMatch(pattern)
  })

  it("names the offending field, so the message is actionable", () => {
    const result = thresholdDraftToSettings({ extremeGroupFraction: "2" })

    expect(result.ok === false && result.message).toContain("Extreme-group fraction")
  })

  it("round-trips a stored settings object without changing it", () => {
    // Opening and saving the panel untouched must be the identity.
    const stored = {
      intervention: { classAverageBelow: 42, minContributionEvents: 0 },
      itemAnalysis: { extremeGroupFraction: 0.3 },
    }
    const result = thresholdDraftToSettings(toThresholdDraft(stored))

    expect(result).toEqual({ ok: true, settings: stored })
  })
})

describe("settingsSummary", () => {
  it("says the defaults are in force when nothing is overridden", () => {
    expect(settingsSummary(PAYLOAD)).toMatch(/code defaults/)
  })

  it("counts the overrides, and singularises", () => {
    const one = { ...PAYLOAD, settings: { intervention: { classAverageBelow: 40 } } }
    const two = {
      ...PAYLOAD,
      settings: { intervention: { classAverageBelow: 40, minContributionEvents: 2 } },
    }

    expect(settingsSummary(one)).toMatch(/1 threshold overridden/)
    expect(settingsSummary(two)).toMatch(/2 thresholds overridden/)
  })

  it("describes itself before the payload has loaded", () => {
    expect(settingsSummary(null)).toBe("When the analytics surfaces raise a flag.")
  })
})
