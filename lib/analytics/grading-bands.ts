/**
 * VIT's relative-grading bands.
 *
 * The institution grades relatively: a letter is a position within the class's own
 * distribution, not a fixed percentage. Source: VIT Vellore's Academic Regulations
 * (§9.5, Table-5), among the FAT process manual — recorded in full in
 * `docs/plans/wave-2.md` §5.1.
 *
 * ```
 * S  ≥ mean + 1.5σ   (and ≥ 90% in absolute terms)
 * A  mean + 0.5σ … mean + 1.5σ
 * B  mean − 0.5σ … mean + 0.5σ      ← the class average is this band's midpoint
 * C  mean − 1.0σ … mean − 0.5σ
 * D  mean − 1.5σ … mean − 1.0σ
 * E  mean − 2.0σ … mean − 1.5σ
 * F  < mean − 2.0σ, floored at 50
 * ```
 *
 * **This is deliberately separate from `letterGrade` in `lib/gradebook.ts`**, which
 * uses fixed absolute bands (`A ≥ 90, B ≥ 80, …`) and feeds the exported final grade.
 * The two are genuinely different scales — and they can disagree:
 *
 * - the bands here are **seven** letters (`S`…`F`), the absolute scale is five (`A`…`F`);
 * - a class averaging 82 with σ 6 puts the `F` floor at 70, so a student on 65 fails
 *   relatively while the absolute scale calls 65 a `D`.
 *
 * Nothing in this module decides which scale owns the exported grade. That is an open
 * decision (`docs/plans/wave-3.md` §3, D1), and this module exists so the relative
 * bands can be computed and tested before it is taken. Where the two are shown
 * together, the UI must say which is which.
 *
 * ## Two rules that are easy to get wrong
 *
 * **Round up first.** The regulations require each student's grand total to be rounded
 * **up to the next integer before** the mean and σ are computed. Applying the rounding
 * afterwards changes the boundaries, because the cohort statistics themselves are
 * computed from the rounded values.
 *
 * **The `F` floor is part of the rule.** `mean − 2σ` can fall below 50 for a
 * high-averaging class; when it does, 50 is used. Without the floor a strong cohort
 * would be told its weakest members failed when the institution would pass them.
 */

/** The seven letters, best first. Order is load-bearing — see `relativeLetter`. */
export const RELATIVE_LETTERS = ["S", "A", "B", "C", "D", "E", "F"] as const

export type RelativeLetter = (typeof RELATIVE_LETTERS)[number]

/**
 * Each band's lower bound as an offset in σ from the mean.
 *
 * Stored as data rather than as branches so the boundaries can be inspected and
 * diffed against the regulation, and so a change is a one-line edit rather than a
 * rewrite of a chain of `if`s.
 */
export const BAND_LOWER_OFFSETS: Record<RelativeLetter, number> = {
  S: 1.5,
  A: 0.5,
  B: -0.5,
  C: -1.0,
  D: -1.5,
  E: -2.0,
  // `F` has no offset: its ceiling is `E`'s floor, and its floor is the pass boundary.
  F: Number.NEGATIVE_INFINITY,
}

/**
 * The cap on the relative pass boundary: `min(mean − 2σ, 50)`.
 *
 * Named for what it is. An earlier version called it a *floor* and applied `max`,
 * which is the exact inverse of the regulation and strictly harsher than it — see
 * `passBoundary` in `./statistics`. The boundary is **capped** at 50, never floored
 * to it: a hard paper lowers the bar, and a generous one still passes anyone above 50.
 *
 * The same 50 is the absolute regime's pass mark, for a theory class of ≤ 10 and for
 * every lab, project, soft-skills and NGCR course.
 */
export const RELATIVE_PASS_CAP = 50

export type GradeBandRange = {
  letter: RelativeLetter
  /** Lower bound, inclusive-or-exclusive per `boundsInclusive`. */
  min: number
  /** Upper bound, or `null` for the open-ended top band. */
  max: number | null
}

export type BandOptions = {
  /**
   * Whether a student exactly on a boundary falls into the **upper** band.
   *
   * Defaults to `true`, which reads the regulation's bands as half-open
   * `[min, max)` — so a student exactly at `mean + 0.5σ` gets `A` rather than `B`.
   * Expressing it as an option rather than hard-coding it is deliberate: the
   * inclusivity is the one detail this module cannot settle from the recorded text,
   * and it is being verified against the primary source. Flipping this must not
   * require rewriting the arithmetic.
   */
  upperInclusive?: boolean
}

/**
 * The absolute percentage each letter starts at, for a given cohort.
 *
 * `mean` and `sd` are the cohort's, **computed from the rounded grand totals**
 * (see `ceilGrandTotals`). A null `sd` or an empty cohort has no bands — a single
 * student has no distribution to be ranked within — so this returns `null` rather
 * than a fabricated boundary.
 */
export function gradeBandRanges(
  mean: number | null,
  sd: number | null,
  options: BandOptions = {},
): GradeBandRange[] | null {
  if (mean === null || sd === null) return null

  const upperInclusive = options.upperInclusive ?? true
  // A zero σ would collapse every band onto the mean. That is arithmetically
  // correct (every student scored the same) but makes the bands useless, so it is
  // reported rather than silently producing seven identical boundaries.
  if (sd === 0) return null

  const ranges: GradeBandRange[] = RELATIVE_LETTERS.map((letter) => {
    const offset = BAND_LOWER_OFFSETS[letter]
    // `F`'s own lower bound is the bottom of the scale; the pass line is the **`E`/`F`
    // boundary**, so it belongs to `E`. Applying it to `F` as well would collapse `F`
    // to an empty range and make every failing mark unclassifiable.
    //
    // `Math.min`, not `Math.max`: the boundary is **capped** at 50, not floored to it.
    // A hard paper lowers the pass line below 50, and a generous one still passes
    // anyone above 50 even though the F band starts higher.
    const min = offset === Number.NEGATIVE_INFINITY ? 0 : mean + offset * sd
    return {
      letter,
      min: letter === "E" ? Math.min(min, RELATIVE_PASS_CAP) : min,
      max: null,
    }
  })

  // Bands run best-first (`S`…`F`), so each band's **upper** bound is the lower bound
  // of the band *above* it — not the next one in the array. `S` is open above.
  //
  // Getting this direction wrong is not a near-miss: pairing each band with the next
  // band's floor gives `S` a minimum above its own maximum, so the range is empty and
  // every student falls through to the fallback.
  for (let index = 1; index < ranges.length; index += 1) {
    ranges[index].max = ranges[index - 1].min
  }

  // The `S` band's own ceiling is 100, because a threshold is a percentage.
  const sBand = ranges[0]
  if (sBand.min > 100) {
    // The regulation's fallback: when the computed `S` boundary exceeds 100, the top
    // few of the class are awarded `S` instead — a rank rule, not a percentage one.
    // This module cannot apply it (it has no roster), so it returns `null` rather
    // than a boundary no student could reach, and
    // `sBandNeedsRankRule` lets a caller detect the case.
    return null
  }

  return ranges
}

/**
 * Whether the computed `S` boundary exceeds 100, which switches the regulation to a
 * rank-based rule (the top few of the class) that needs the roster, not the bands.
 *
 * Split out so a caller can detect the case and apply the rank rule rather than
 * silently reporting a grade the institution would not award.
 */
export function sBandNeedsRankRule(mean: number | null, sd: number | null): boolean {
  if (mean === null || sd === null || sd === 0) return false
  return mean + BAND_LOWER_OFFSETS.S * sd > 100
}

/**
 * The letter for one student's percentage within a computed cohort.
 *
 * Returns `null` when the bands cannot be computed, so a caller renders nothing
 * rather than a defaulted letter. **A defaulted letter is the worst outcome here** —
 * it would look like a grade.
 */
export function relativeLetter(
  percentage: number,
  ranges: readonly GradeBandRange[] | null,
  options: BandOptions = {},
): RelativeLetter | null {
  if (!ranges || ranges.length === 0) return null

  const upperInclusive = options.upperInclusive ?? true

  for (const range of ranges) {
    const meetsMin = upperInclusive ? percentage >= range.min : percentage > range.min
    // `S` is open above (`max === null`), so meeting its floor is sufficient.
    if (range.max === null) {
      if (meetsMin) return range.letter
      continue
    }
    const meetsMax = upperInclusive ? percentage < range.max : percentage <= range.max
    if (meetsMin && meetsMax) return range.letter
  }

  return null
}

/**
 * Round each student's grand total **up** to the next integer, as the regulations
 * require, before any cohort statistic is computed.
 *
 * Exported so the rule has one implementation: the mean and σ that feed the bands must
 * come from *these* values, not from the raw percentages, or the boundaries move.
 */
export function ceilGrandTotals(percentages: readonly number[]): number[] {
  return percentages.map((percentage) => Math.ceil(percentage))
}
