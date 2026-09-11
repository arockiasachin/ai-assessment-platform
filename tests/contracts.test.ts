import { describe, expect, it } from "vitest"

import {
  SEED_CONFIRMATION_TOKEN,
  aiGradeSuggestionInputSchema,
  loginRequestSchema,
  reviewDecisionSchema,
  seedRequestSchema,
} from "@/lib/contracts"

describe("API contract schemas", () => {
  it("requires a username and password on login", () => {
    expect(loginRequestSchema.safeParse({ email: "", password: "x" }).success).toBe(false)
    expect(loginRequestSchema.safeParse({ email: "admin", password: "" }).success).toBe(false)
    expect(loginRequestSchema.safeParse({ email: "admin", password: "secret" }).success).toBe(true)
  })

  it("requires the full explainability envelope on an AI suggestion", () => {
    const valid = {
      assessmentId: "a1",
      studentId: "s1",
      suggestedPoints: 7,
      rationale: "Matches the rubric descriptor for thesis clarity.",
      evidence: "The opening paragraph states the claim directly.",
      confidence: 0.82,
      model: "mock-1",
      promptVersion: "v1",
      latencyMs: 42,
    }
    expect(aiGradeSuggestionInputSchema.safeParse(valid).success).toBe(true)

    for (const field of [
      "rationale",
      "confidence",
      "model",
      "promptVersion",
      "latencyMs",
    ] as const) {
      const clone: Record<string, unknown> = { ...valid }
      delete clone[field]
      expect(
        aiGradeSuggestionInputSchema.safeParse(clone).success,
        `expected missing ${field} to fail`,
      ).toBe(false)
    }

    expect(aiGradeSuggestionInputSchema.safeParse({ ...valid, confidence: 1.5 }).success).toBe(
      false,
    )
  })

  it("requires points and a reason to override and never accepts a bare publish", () => {
    expect(reviewDecisionSchema.safeParse({ action: "accept" }).success).toBe(true)
    expect(reviewDecisionSchema.safeParse({ action: "override", points: 4 }).success).toBe(false)
    expect(
      reviewDecisionSchema.safeParse({ action: "override", points: 4, reason: "" }).success,
    ).toBe(false)
    expect(
      reviewDecisionSchema.safeParse({ action: "override", points: 4, reason: "Half credit." })
        .success,
    ).toBe(true)
    expect(reviewDecisionSchema.safeParse({ action: "publish" }).success).toBe(false)
  })

  it("requires the explicit confirmation token to reseed", () => {
    expect(seedRequestSchema.safeParse({}).success).toBe(false)
    expect(seedRequestSchema.safeParse({ confirm: "yes" }).success).toBe(false)
    expect(seedRequestSchema.safeParse({ confirm: SEED_CONFIRMATION_TOKEN }).success).toBe(true)
  })
})
