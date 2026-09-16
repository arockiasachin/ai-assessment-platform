/**
 * Giving generated quiz questions points that sum to the assessment's marks.
 *
 * ## The defect this exists to fix
 *
 * `lib/quiz-generation/generation.ts` persisted **every** generated question with `points: 1`,
 * with no relationship to the assessment's `maxMarks`. Scoring, meanwhile, divides the earned
 * total by a `maxScore` taken from `Assessment.maxMarks` (`lib/quiz-grading.ts` passes it
 * explicitly, and `QuizAttempt.maxScore` stores it).
 *
 * The two were therefore only consistent by coincidence — when a quiz happened to have exactly as
 * many questions as it had marks. A four-question quiz on a twenty-mark assessment had a ceiling of
 * four earned against a denominator of twenty, so **a perfect attempt scored 20%**. The demo
 * seed reproduced it exactly: the same student and assessment read 4/20 from the auto-scored
 * attempt and 20/20 from the manual `Grade`, and the two dashboards each showed one of them.
 *
 * ## An even split, not a proportional one — and why
 *
 * The first attempt at this scaled each question **proportionally**, on the reasoning that the edit
 * contract (`generatedQuestionEditRequestSchema`) accepts a per-question `points`, so an explicit
 * weighting might exist and should be preserved. Two things were wrong with that, both found by
 * writing the tests:
 *
 * 1. **It is actively wrong when questions are added.** A teacher can generate for the same
 *    assessment more than once, and after the first split the stored values are *derived* — a
 *    four-question set on 20 marks reads `5, 5, 5, 5`. Adding four more questions, which arrive
 *    carrying the default `1`, made proportional scaling treat the existing questions as five times
 *    weightier and devalue the new ones to `0.83` each. That is a reachable workflow, and it would
 *    silently mis-weight every quiz it touched.
 * 2. **A zero weight produces an unscoreable question.** A question worth `0` marks cannot be
 *    answered for credit, so it is not a state to converge on. The edit contract requires a
 *    *positive* value, so a zero or negative weight is corrupt input rather than intent.
 *
 * The underlying problem is that after the first split, a stored `points` value no longer tells you
 * whether it was authored or derived, so it cannot safely be scaled. An even split sidesteps that:
 * every question carries an equal share, which is the truth for anything this generator produces.
 *
 * **The trade-off, stated:** a per-question weight set through the edit contract would be
 * overwritten the next time questions are generated. Nothing writes that field today — there is no
 * UI for it — so the trade is unreachable in practice, whereas the mis-weighting above is not. When
 * a points editor is built, this has to be revisited: it will need to distinguish authored values
 * from derived ones (a flag, or storing the authored weight separately) rather than inferring intent
 * from a number.
 *
 * ## Why the whole set is recomputed, not just the new batch
 *
 * Each generation call adds to the existing set, so distributing within a batch would leave the sum
 * drifting past `maxMarks` with every addition. The invariant is maintained over the assessment's
 * questions as a whole.
 *
 * Recomputing does not rewrite history: an attempt stores its own `maxScore` and its per-response
 * `pointsAwarded`, and `attemptPercentage` prefers the stored value, so a percentage already
 * recorded keeps the denominator it was computed with.
 */

/** Points are `Decimal(6,2)`, so shares are rounded to two places and the remainder is assigned. */
const DECIMAL_PLACES = 2

function round2(value: number): number {
  const factor = 10 ** DECIMAL_PLACES
  return Math.round(value * factor) / factor
}

/**
 * Points for each question, scaled so they sum to `maxMarks`.
 *
 * Returns an empty array for an empty question set, and leaves the values untouched when
 * `maxMarks` is not a positive number — there is no meaningful scale to distribute, and inventing
 * one would be worse than leaving the defaults in place.
 *
 * The **last question absorbs the rounding remainder**, so the returned values sum to exactly
 * `maxMarks` rather than `maxMarks ± 0.01`. That matters because the sum is the number scoring
 * divides by; being a cent out would make a perfect attempt score 99.99% instead of 100%.
 */
export function distributePointsAcrossQuestions(
  currentPoints: readonly number[],
  maxMarks: number,
): number[] {
  if (currentPoints.length === 0) return []
  if (!Number.isFinite(maxMarks) || maxMarks <= 0) return [...currentPoints]

  // An even share each. `currentPoints` is read only for its length — see the module docblock for
  // why the stored values are deliberately not used as weights.
  const shares = currentPoints.map(() => round2(maxMarks / currentPoints.length))

  const assigned = shares.reduce((sum, share) => sum + share, 0)
  const lastIndex = shares.length - 1
  shares[lastIndex] = round2(shares[lastIndex] + (maxMarks - assigned))

  return shares
}

/**
 * Whether a set of points already sums to `maxMarks`, to the precision the column stores.
 *
 * Used to skip the writes entirely in the common case where nothing needs to change — which is
 * every generation after the first with an unchanged question count.
 */
export function pointsSumToMarks(points: readonly number[], maxMarks: number): boolean {
  if (points.length === 0) return true
  const total = points.reduce((sum, value) => sum + value, 0)
  return Math.abs(round2(total) - round2(maxMarks)) < 0.005
}
