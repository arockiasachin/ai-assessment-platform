import { z } from "zod"

import { CriterionParseError, RubricGradingError } from "./errors"
import { roundPoints } from "./validation"

/**
 * Turns one model response into a scored criterion.
 *
 * The contract is strict on purpose: every criterion score must carry a
 * rationale, a quoted evidence span, and a confidence, and the score can never
 * exceed the criterion's point ceiling. A response that cannot be parsed is an
 * error, never a silently invented score.
 */

export const criterionEvaluationSchema = z.object({
  score: z.number().finite().nonnegative(),
  rationale: z.string().trim().min(1, "A rationale is required."),
  evidence: z.string().trim().min(1, "A quoted evidence span is required."),
  confidence: z.number().finite().min(0).max(1),
})
export type CriterionEvaluation = z.infer<typeof criterionEvaluationSchema>

export type ParseCriterionOptions = {
  criterionLabel: string
  maxPoints: number
  /** The student's submitted text, used to verify the evidence is a real quote. */
  submissionText: string
}

export type ParsedCriterionEvaluation = {
  score: number
  rationale: string
  evidence: string
  confidence: number
  /** True when the model tried to score above the criterion ceiling and we clamped. */
  clampedToCeiling: boolean
  /** True when `evidence` appears verbatim in the submission. */
  evidenceVerified: boolean
}

/** Strip a fenced code block if the model wrapped its JSON in one. */
function stripFence(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return fenced?.[1]?.trim() ?? raw.trim()
}

/**
 * Best-effort JSON extraction: the whole response, a fenced block, or the
 * outermost `{...}` span. Anything else fails closed.
 */
export function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim()
  if (!trimmed) throw new CriterionParseError("The model returned an empty response.")

  const candidates: string[] = []
  const unfenced = stripFence(trimmed)
  candidates.push(unfenced)
  const first = unfenced.indexOf("{")
  const last = unfenced.lastIndexOf("}")
  if (first >= 0 && last > first) candidates.push(unfenced.slice(first, last + 1))

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      // Try the next candidate.
    }
  }

  throw new CriterionParseError("The model response did not contain a JSON object.")
}

export function normalizeForEvidence(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/^[\s'"`]+|[\s'"`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

export function parseCriterionEvaluation(
  rawText: string,
  options: ParseCriterionOptions,
): ParsedCriterionEvaluation {
  const json = extractJsonObject(rawText)
  const parsed = criterionEvaluationSchema.safeParse(json)
  if (!parsed.success) {
    throw new CriterionParseError(
      `Criterion "${options.criterionLabel}" response must include a numeric score, a rationale, quoted evidence, and a confidence between 0 and 1.`,
    )
  }

  const data = parsed.data
  const clampedToCeiling = data.score > options.maxPoints + Number.EPSILON
  const score = roundPoints(Math.min(data.score, options.maxPoints))
  const evidence = data.evidence.trim()
  const evidenceVerified =
    evidence.length > 0 &&
    normalizeForEvidence(options.submissionText).includes(normalizeForEvidence(evidence))

  return {
    score,
    rationale: data.rationale.trim(),
    evidence,
    confidence: data.confidence,
    clampedToCeiling,
    evidenceVerified,
  }
}

/** Narrow helper so callers can turn any failure into a 502 response safely. */
export function isCriterionParseError(error: unknown): error is CriterionParseError {
  return error instanceof RubricGradingError && error.name === "CriterionParseError"
}
