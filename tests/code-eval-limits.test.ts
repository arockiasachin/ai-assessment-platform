import { describe, expect, it } from "vitest"

import { evaluateSubmissionEligibility } from "@/lib/code-eval/limits"

const dueDate = new Date("2026-10-01T00:00:00.000Z")
const before = new Date("2026-09-01T00:00:00.000Z")
const after = new Date("2026-10-02T00:00:00.000Z")

describe("evaluateSubmissionEligibility", () => {
  it("allows a submission before the deadline under the cap", () => {
    const result = evaluateSubmissionEligibility({
      existingRunCount: 2,
      maxSubmissions: 5,
      now: before,
      dueDate,
    })
    expect(result).toMatchObject({ allowed: true, reason: null, code: null, used: 2, remaining: 3 })
  })

  it("blocks once the submission cap is reached", () => {
    const result = evaluateSubmissionEligibility({
      existingRunCount: 5,
      maxSubmissions: 5,
      now: before,
      dueDate,
    })
    expect(result.allowed).toBe(false)
    expect(result.code).toBe("cap")
    expect(result.remaining).toBe(0)
  })

  it("blocks after the deadline even under the cap", () => {
    const result = evaluateSubmissionEligibility({
      existingRunCount: 1,
      maxSubmissions: 5,
      now: after,
      dueDate,
    })
    expect(result.allowed).toBe(false)
    expect(result.code).toBe("deadline")
  })

  it("blocks after the deadline when the cap is also reached, reporting the deadline first", () => {
    const result = evaluateSubmissionEligibility({
      existingRunCount: 5,
      maxSubmissions: 5,
      now: after,
      dueDate,
    })
    expect(result.code).toBe("deadline")
  })

  it("treats the exact deadline instant as still open", () => {
    const result = evaluateSubmissionEligibility({
      existingRunCount: 0,
      maxSubmissions: 1,
      now: dueDate,
      dueDate,
    })
    expect(result.allowed).toBe(true)
  })

  it("clamps nonsensical counts", () => {
    const result = evaluateSubmissionEligibility({
      existingRunCount: -3,
      maxSubmissions: 0,
      now: before,
      dueDate,
    })
    expect(result.used).toBe(0)
    expect(result.maxSubmissions).toBe(1)
    expect(result.allowed).toBe(true)
  })
})
