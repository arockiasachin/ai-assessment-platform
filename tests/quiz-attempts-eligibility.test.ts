import { describe, expect, it } from "vitest"

import {
  DEFAULT_MAX_ATTEMPTS,
  evaluateAttemptEligibility,
  isLateSubmission,
  resolveMaxAttempts,
} from "@/lib/quiz-attempts/eligibility"

/**
 * Pure attempt/deadline policy. No database: the service layer calls this before
 * writing, so these cases pin down exactly when a write is allowed.
 */

const due = new Date("2026-10-01T08:00:00.000Z")

describe("resolveMaxAttempts", () => {
  it("defaults to 3 and honours a positive integer override", () => {
    expect(resolveMaxAttempts(undefined)).toBe(DEFAULT_MAX_ATTEMPTS)
    expect(resolveMaxAttempts("")).toBe(DEFAULT_MAX_ATTEMPTS)
    expect(resolveMaxAttempts("5")).toBe(5)
  })

  it("ignores malformed or non-positive overrides so the cap can never be disabled", () => {
    expect(resolveMaxAttempts("0")).toBe(DEFAULT_MAX_ATTEMPTS)
    expect(resolveMaxAttempts("-2")).toBe(DEFAULT_MAX_ATTEMPTS)
    expect(resolveMaxAttempts("not-a-number")).toBe(DEFAULT_MAX_ATTEMPTS)
  })
})

describe("evaluateAttemptEligibility", () => {
  it("allows a new attempt before the deadline while under the cap", () => {
    const result = evaluateAttemptEligibility({
      existingAttemptCount: 0,
      maxAttempts: 3,
      now: new Date("2026-09-20T00:00:00.000Z"),
      dueDate: due,
    })
    expect(result).toMatchObject({
      allowed: true,
      code: null,
      used: 0,
      remaining: 3,
      maxAttempts: 3,
    })
  })

  it("blocks with the cap code once the limit is reached", () => {
    const result = evaluateAttemptEligibility({
      existingAttemptCount: 3,
      maxAttempts: 3,
      now: new Date("2026-09-20T00:00:00.000Z"),
      dueDate: due,
    })
    expect(result.allowed).toBe(false)
    expect(result.code).toBe("cap")
    expect(result.remaining).toBe(0)
  })

  it("blocks with the deadline code after the due date even when attempts remain", () => {
    const result = evaluateAttemptEligibility({
      existingAttemptCount: 1,
      maxAttempts: 3,
      now: new Date("2026-10-02T00:00:00.000Z"),
      dueDate: due,
    })
    expect(result.allowed).toBe(false)
    expect(result.code).toBe("deadline")
    expect(result.remaining).toBe(2)
  })
})

describe("isLateSubmission", () => {
  it("is true only after the due date", () => {
    expect(isLateSubmission(new Date("2026-09-30T00:00:00.000Z"), due)).toBe(false)
    expect(isLateSubmission(new Date("2026-10-01T08:00:00.000Z"), due)).toBe(false)
    expect(isLateSubmission(new Date("2026-10-01T08:00:00.001Z"), due)).toBe(true)
  })
})
