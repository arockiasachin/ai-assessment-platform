import { describe, expect, it } from "vitest"

import {
  extractJsonObject,
  normalizeForEvidence,
  parseCriterionEvaluation,
} from "@/lib/rubric-grading/parsing"
import { CriterionParseError } from "@/lib/rubric-grading/errors"

/**
 * Per-criterion parsing. The model must hand back a score, a rationale, a
 * quoted evidence span, and a confidence; anything else is an error, never an
 * invented score.
 */

const SUBMISSION =
  "The author argues that remote work raises productivity because it removes commutes. Studies show a 13% gain."

function response(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    score: 4,
    rationale: "Clear, supported claim.",
    evidence: "remote work raises productivity because it removes commutes",
    confidence: 0.82,
    ...overrides,
  })
}

describe("parseCriterionEvaluation", () => {
  it("parses a valid criterion response", () => {
    const parsed = parseCriterionEvaluation(response(), {
      criterionLabel: "Argument",
      maxPoints: 5,
      submissionText: SUBMISSION,
    })

    expect(parsed.score).toBe(4)
    expect(parsed.rationale).toBe("Clear, supported claim.")
    expect(parsed.confidence).toBe(0.82)
    expect(parsed.clampedToCeiling).toBe(false)
    expect(parsed.evidenceVerified).toBe(true)
  })

  it("parses JSON wrapped in a fenced code block", () => {
    const fenced = "```json\n" + response({ score: 3 }) + "\n```"
    const parsed = parseCriterionEvaluation(fenced, {
      criterionLabel: "Argument",
      maxPoints: 5,
      submissionText: SUBMISSION,
    })
    expect(parsed.score).toBe(3)
  })

  it("clamps a score that exceeds the criterion ceiling", () => {
    const parsed = parseCriterionEvaluation(response({ score: 12 }), {
      criterionLabel: "Argument",
      maxPoints: 10,
      submissionText: SUBMISSION,
    })
    expect(parsed.score).toBe(10)
    expect(parsed.clampedToCeiling).toBe(true)
  })

  it("flags evidence that is not an exact quote from the submission", () => {
    const parsed = parseCriterionEvaluation(
      response({ evidence: "remote work improves output by reducing commuting" }),
      { criterionLabel: "Argument", maxPoints: 5, submissionText: SUBMISSION },
    )
    expect(parsed.evidenceVerified).toBe(false)
  })

  it("verifies evidence wrapped in typographic quotes", () => {
    const parsed = parseCriterionEvaluation(response({ evidence: "“Studies show a 13% gain”" }), {
      criterionLabel: "Evidence",
      maxPoints: 5,
      submissionText: SUBMISSION,
    })
    expect(parsed.evidenceVerified).toBe(true)
  })

  it("rejects a response with no rationale", () => {
    expect(() =>
      parseCriterionEvaluation(response({ rationale: "" }), {
        criterionLabel: "Argument",
        maxPoints: 5,
        submissionText: SUBMISSION,
      }),
    ).toThrowError(CriterionParseError)
  })

  it("rejects a confidence outside 0..1", () => {
    expect(() =>
      parseCriterionEvaluation(response({ confidence: 1.5 }), {
        criterionLabel: "Argument",
        maxPoints: 5,
        submissionText: SUBMISSION,
      }),
    ).toThrowError(CriterionParseError)
  })

  it("rejects a response that is not JSON", () => {
    expect(() =>
      parseCriterionEvaluation("I think this deserves a 4 out of 5.", {
        criterionLabel: "Argument",
        maxPoints: 5,
        submissionText: SUBMISSION,
      }),
    ).toThrowError(CriterionParseError)
    expect(() =>
      parseCriterionEvaluation("", {
        criterionLabel: "Argument",
        maxPoints: 5,
        submissionText: SUBMISSION,
      }),
    ).toThrowError(/empty response/)
  })
})

describe("evidence normalization", () => {
  it("normalizes whitespace, case, and surrounding quotes", () => {
    expect(normalizeForEvidence('  "Remote   Work"  ')).toBe("remote work")
  })

  it("extracts the outermost JSON object from surrounding prose", () => {
    const parsed = extractJsonObject('Here is the score: {"score": 1, "rationale": "r"} done.')
    expect(parsed).toMatchObject({ score: 1 })
  })
})
