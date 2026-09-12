import { clamp01, textSimilarity } from "@/lib/text-similarity"

/**
 * Deterministic partial-credit scoring for free-text quiz answers.
 *
 * This is the reproducible half of the short-answer grading design: it is the
 * fallback when the semantic (LLM) grader is unavailable, and it is the only
 * scorer the offline `mock` provider defers to. It is pure and synchronous so
 * the threshold and clamping rules can be unit-tested without a model, a
 * database, or network access.
 *
 * The rule is intentionally simple and explainable:
 *
 *   similarity = textSimilarity(studentAnswer, referenceAnswer)   // [0, 1]
 *   eligible   = similarity >= threshold
 *   points     = eligible ? clamp(similarity * maxPoints, 0, maxPoints) : 0
 *
 * A similarity below the threshold scores zero rather than a token amount, so a
 * student who writes something unrelated to the reference answer gets nothing.
 * The score can never be negative or exceed the question's ceiling.
 */

/** Default similarity below which a text answer scores zero. */
export const DEFAULT_TEXT_SIMILARITY_THRESHOLD = 0.35

/** Env override, e.g. `QUIZ_TEXT_SIMILARITY_THRESHOLD=0.5`. */
export const TEXT_SIMILARITY_THRESHOLD_ENV = "QUIZ_TEXT_SIMILARITY_THRESHOLD"

/** Two-decimal rounding, matching `Decimal(6, 2)` point columns. */
export function roundPoints(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100) / 100
}

/**
 * Resolve the threshold from the environment. An unset, non-numeric, or
 * out-of-range value falls back to {@link DEFAULT_TEXT_SIMILARITY_THRESHOLD}
 * rather than silently disabling the gate.
 */
export function resolveTextSimilarityThreshold(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[TEXT_SIMILARITY_THRESHOLD_ENV]
  if (raw === undefined || raw.trim() === "") return DEFAULT_TEXT_SIMILARITY_THRESHOLD
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return DEFAULT_TEXT_SIMILARITY_THRESHOLD
  }
  return parsed
}

export type TextAnswerScoreInput = {
  answerText: string
  referenceAnswer: string
  maxPoints: number
  threshold: number
}

export type TextAnswerScore = {
  /** Raw lexical similarity in [0, 1], before the threshold gate. */
  similarity: number
  /** Whether the answer cleared the threshold. */
  eligible: boolean
  /** Awarded points, clamped to `[0, maxPoints]`; `0` below the threshold. */
  points: number
}

/** Deterministic partial-credit score for one free-text answer. */
export function scoreTextAnswer(input: TextAnswerScoreInput): TextAnswerScore {
  const maxPoints = Number.isFinite(input.maxPoints) && input.maxPoints > 0 ? input.maxPoints : 0
  const similarity = clamp01(textSimilarity(input.answerText ?? "", input.referenceAnswer ?? ""))
  const eligible = similarity >= input.threshold
  const points = eligible
    ? Math.max(0, Math.min(maxPoints, roundPoints(similarity * maxPoints)))
    : 0
  return { similarity, eligible, points }
}

/**
 * Distribute an integer number of cents across weights by largest remainder, so
 * the shares sum *exactly* to `totalCents`. Used to project both the question
 * ceilings and each question's awarded points onto the assessment `maxScore`
 * without a rounding drift that would disagree with the kernel's integer score.
 */
function distributeCents(totalCents: number, weights: readonly number[]): number[] {
  const result = new Array<number>(weights.length).fill(0)
  if (weights.length === 0 || totalCents <= 0) return result

  const sanitized = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 0))
  const totalWeight = sanitized.reduce((sum, weight) => sum + weight, 0)
  if (totalWeight <= 0) return result

  const remainders: { index: number; fraction: number }[] = []
  let used = 0
  for (let index = 0; index < sanitized.length; index += 1) {
    const quota = (sanitized[index] / totalWeight) * totalCents
    const base = Math.floor(quota)
    result[index] = base
    used += base
    remainders.push({ index, fraction: quota - base })
  }

  remainders.sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  let remaining = totalCents - used
  let cursor = 0
  while (remaining > 0 && remainders.length > 0) {
    result[remainders[cursor % remainders.length].index] += 1
    remaining -= 1
    cursor += 1
  }
  return result
}

export type ProjectPerQuestionInput = {
  /** Raw points each question earned (already clamped to its ceiling). */
  points: readonly number[]
  /** Each question's weight (`Question.points`). */
  weights: readonly number[]
  /** The assessment ceiling the kernel projected onto. */
  maxScore: number
  /** The kernel's integer total score; the awarded shares sum to this exactly. */
  targetScore: number
}

export type ProjectedQuestionPoints = {
  /** Projected points per question; the sum equals `targetScore`. */
  awarded: number[]
  /** Projected ceiling per question; the sum equals `maxScore`. */
  ceilings: number[]
}

/**
 * Project per-question weighted points onto the assessment ceiling, matching
 * the kernel's `earned / totalPoints × maxScore` rule but keeping the sum of
 * the per-question values exactly equal to the kernel's rounded total. This is
 * what lets each free-text answer carry its own `AIGradeSuggestion` (and thus
 * its own evidence) while the summed grade stays consistent.
 */
export function projectPerQuestion(input: ProjectPerQuestionInput): ProjectedQuestionPoints {
  const maxScoreCents = Math.round(
    (Number.isFinite(input.maxScore) && input.maxScore > 0 ? input.maxScore : 0) * 100,
  )
  const targetCents = Math.round(
    (Number.isFinite(input.targetScore) && input.targetScore > 0 ? input.targetScore : 0) * 100,
  )
  return {
    awarded: distributeCents(targetCents, input.points).map((cents) => cents / 100),
    ceilings: distributeCents(maxScoreCents, input.weights).map((cents) => cents / 100),
  }
}
