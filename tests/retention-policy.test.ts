import { describe, expect, it } from "vitest"

import {
  RESULT_RETENTION_WINDOW_DAYS,
  RESULT_RETENTION_WINDOW_MS,
  decideRetention,
  isRetentionEligible,
  retentionCutoff,
} from "@/lib/retention/policy"

/**
 * Pure unit tests for the retention decision. No database, no clock: every case
 * passes an explicit `now`, so the boundary is exact.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = new Date("2026-09-12T00:00:00.000Z")

function publishedAgo(ms: number): Date {
  return new Date(NOW.getTime() - ms)
}

describe("retention policy", () => {
  it("exposes a 15-day window", () => {
    expect(RESULT_RETENTION_WINDOW_DAYS).toBe(15)
    expect(RESULT_RETENTION_WINDOW_MS).toBe(15 * DAY_MS)
  })

  it("never purges an offering whose results are unpublished", () => {
    const decision = decideRetention({ resultsPublishedAt: null }, NOW)
    expect(decision.eligible).toBe(false)
    expect(decision).toMatchObject({ reason: "unpublished" })
    expect(isRetentionEligible({ resultsPublishedAt: null }, NOW)).toBe(false)
  })

  it("does not purge before the window elapses", () => {
    expect(decideRetention({ resultsPublishedAt: NOW }, NOW)).toMatchObject({
      eligible: false,
      reason: "within-window",
    })
    // 14 days and 23 hours after publication: still in the window.
    expect(
      decideRetention({ resultsPublishedAt: publishedAgo(14 * DAY_MS + 23 * 60 * 60 * 1000) }, NOW),
    ).toMatchObject({ eligible: false, reason: "within-window" })
  })

  it("is eligible at exactly 15 days, inclusive", () => {
    const decision = decideRetention({ resultsPublishedAt: publishedAgo(15 * DAY_MS) }, NOW)
    expect(decision.eligible).toBe(true)
    expect(decision).toMatchObject({ reason: "window-elapsed" })
    // One millisecond before the boundary is still not eligible.
    expect(
      decideRetention({ resultsPublishedAt: publishedAgo(15 * DAY_MS - 1) }, NOW).eligible,
    ).toBe(false)
    // One millisecond after is.
    expect(
      decideRetention({ resultsPublishedAt: publishedAgo(15 * DAY_MS + 1) }, NOW).eligible,
    ).toBe(true)
  })

  it("treats an unusable anchor as not eligible rather than guessing", () => {
    expect(decideRetention({ resultsPublishedAt: new Date(Number.NaN) }, NOW)).toMatchObject({
      eligible: false,
      reason: "invalid-anchor",
    })
    expect(decideRetention({ resultsPublishedAt: NOW }, new Date(Number.NaN))).toMatchObject({
      eligible: false,
      reason: "invalid-anchor",
    })
  })

  it("honours a caller-supplied window for tests but defaults to 15 days", () => {
    const anchor = publishedAgo(10 * DAY_MS)
    expect(isRetentionEligible({ resultsPublishedAt: anchor }, NOW)).toBe(false)
    expect(isRetentionEligible({ resultsPublishedAt: anchor }, NOW, 5 * DAY_MS)).toBe(true)
  })

  it("computes the cutoff as publication plus the window", () => {
    const published = new Date("2026-08-28T12:00:00.000Z")
    expect(retentionCutoff(published).toISOString()).toBe("2026-09-12T12:00:00.000Z")
    expect(retentionCutoff(published, DAY_MS).toISOString()).toBe("2026-08-29T12:00:00.000Z")
  })
})
