import { describe, expect, it } from "vitest"

import {
  decideRetake,
  describeRetakePolicy,
  resolveSittingCap,
  type RetakePolicy,
} from "@/lib/quiz-attempts/retake-policy"

/**
 * The retake policy, pure.
 *
 * The assertions concentrate on the distinctions that are easy to collapse and expensive to get
 * wrong: the first sitting is always allowed, `NONE` means "no retakes" rather than "no
 * assessment", and a retake count converts to a sitting count exactly once.
 */

const context = (overrides: Partial<Parameters<typeof decideRetake>[0]> = {}) => ({
  policy: "FIXED" as RetakePolicy,
  gradedAttemptsUsed: 1,
  hasApprovedRequest: false,
  hasPendingRequest: false,
  ...overrides,
})

describe("decideRetake — the first sitting", () => {
  it("is allowed under every policy", () => {
    // `NONE` means no *retakes*, not no assessment. Losing that would lock students out of work
    // they are entitled to sit.
    for (const policy of ["NONE", "FIXED", "APPROVAL"] as const) {
      expect(decideRetake(context({ policy, gradedAttemptsUsed: 0 })), policy).toEqual({
        allowed: true,
        kind: "first-sitting",
      })
    }
  })

  it("is allowed even on APPROVAL with no request at all", () => {
    expect(
      decideRetake(
        context({ policy: "APPROVAL", gradedAttemptsUsed: 0, hasPendingRequest: false }),
      ),
    ).toEqual({ allowed: true, kind: "first-sitting" })
  })
})

describe("decideRetake — NONE", () => {
  it("blocks a second sitting outright", () => {
    const decision = decideRetake(context({ policy: "NONE", gradedAttemptsUsed: 1 }))
    expect(decision).toMatchObject({ allowed: false, code: "cap" })
  })

  it("does not become allowed by an approved request", () => {
    // A `NONE` assessment could still have a stale approved row from before the policy changed.
    // The policy wins, or a repealed setting would keep granting sittings.
    expect(
      decideRetake(context({ policy: "NONE", gradedAttemptsUsed: 1, hasApprovedRequest: true })),
    ).toMatchObject({ allowed: false })
  })
})

describe("decideRetake — FIXED", () => {
  it("defers to the cap, so it allows and lets the caller enforce the limit", () => {
    // Deliberately not re-deriving the cap here: applying it in two places is where the two
    // could disagree.
    expect(decideRetake(context({ policy: "FIXED", gradedAttemptsUsed: 9 }))).toEqual({
      allowed: true,
      kind: "retake",
    })
  })
})

describe("decideRetake — APPROVAL", () => {
  it("allows a retake when a request is approved", () => {
    expect(decideRetake(context({ policy: "APPROVAL", hasApprovedRequest: true }))).toEqual({
      allowed: true,
      kind: "retake",
    })
  })

  it("reports a pending request as awaiting-approval, not as forbidden", () => {
    // Different facts and a different next action: "wait" versus "ask". A single `false` would
    // tell a student to ask again when they already have.
    const decision = decideRetake(context({ policy: "APPROVAL", hasPendingRequest: true }))
    expect(decision).toMatchObject({ allowed: false, code: "awaiting-approval" })
  })

  it("reports no request as approval-required", () => {
    const decision = decideRetake(context({ policy: "APPROVAL" }))
    expect(decision).toMatchObject({ allowed: false, code: "approval-required" })
  })

  it("prefers an approved request over a pending one", () => {
    expect(
      decideRetake(
        context({ policy: "APPROVAL", hasApprovedRequest: true, hasPendingRequest: true }),
      ),
    ).toMatchObject({ allowed: true })
  })
})

describe("resolveSittingCap", () => {
  it("is one sitting for NONE, whatever the other settings say", () => {
    expect(resolveSittingCap({ policy: "NONE", maxAttempts: 5, retakesAllowed: 3 })).toBe(1)
  })

  it("uses maxAttempts when retakesAllowed is unset", () => {
    // The behaviour every existing assessment already has, so gaining the column changes nothing.
    expect(resolveSittingCap({ policy: "FIXED", maxAttempts: 3, retakesAllowed: null })).toBe(3)
  })

  it("converts a retake count to a sitting count, adding the first sitting", () => {
    // "The teacher allows one retake" is two sittings. Calling it one would be a lie, and calling
    // it two in the UI without converting would be the opposite error.
    expect(resolveSittingCap({ policy: "FIXED", maxAttempts: 3, retakesAllowed: 1 })).toBe(2)
    expect(resolveSittingCap({ policy: "FIXED", maxAttempts: 3, retakesAllowed: 0 })).toBe(1)
    expect(resolveSittingCap({ policy: "FIXED", maxAttempts: 3, retakesAllowed: 5 })).toBe(6)
  })

  it("ignores a nonsensical retake count in favour of maxAttempts", () => {
    expect(resolveSittingCap({ policy: "FIXED", maxAttempts: 3, retakesAllowed: -1 })).toBe(3)
    expect(resolveSittingCap({ policy: "FIXED", maxAttempts: 3, retakesAllowed: Number.NaN })).toBe(
      3,
    )
  })
})

describe("describeRetakePolicy", () => {
  it("says what NONE and APPROVAL mean", () => {
    expect(describeRetakePolicy("NONE", 3, null)).toBe("One graded sitting. No retakes.")
    expect(describeRetakePolicy("APPROVAL", 3, null)).toBe("Retakes only on an approved request.")
  })

  it("states the total sittings and the retake count for FIXED", () => {
    expect(describeRetakePolicy("FIXED", 3, 1)).toBe(
      "2 graded sittings — the first, plus 1 retake.",
    )
    expect(describeRetakePolicy("FIXED", 3, 2)).toBe(
      "3 graded sittings — the first, plus 2 retakes.",
    )
  })

  it("reads as no-retakes when the conversion leaves none", () => {
    expect(describeRetakePolicy("FIXED", 3, 0)).toBe("One graded sitting. No retakes.")
  })
})
