import type { CourseCategory as PrismaCourseCategory } from "@/lib/generated/prisma/enums"

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
 * F  < mean − 2.0σ, **capped** at 50 (see `passBoundary`)
 * ```
 *
 * Note the last line: the pass line is `min(mean − 2σ, 50)`, so on a hard paper the
 * `E`/`F` boundary drops below 50 and on a generous one it stays at 50. The research
 * that corrected this is recorded in `docs/plans/wave-3.md` §7.6.
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
 *
 * **Takes no `BandOptions`, deliberately.** `upperInclusive` decides which side of a boundary a
 * mark lands on, which is a property of the *comparison*, not of the boundary list — so it belongs
 * to `relativeLetter` and `absoluteLetter`, which do the comparing. This function only computes
 * where the edges are; accepting the option here would be a parameter that cannot change its
 * output. It previously did accept one and read it into an unused local.
 */
export function gradeBandRanges(mean: number | null, sd: number | null): GradeBandRange[] | null {
  if (mean === null || sd === null) return null

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

// ---------------------------------------------------------------------------
// The absolute regime (Table-6)
// ---------------------------------------------------------------------------

/**
 * VIT runs **two** grading regimes, and which one applies is institutional rather
 * than a faculty choice:
 *
 * | Regime       | Applies to                                                                                              |
 * | ------------ | ------------------------------------------------------------------------------------------------------- |
 * | **Relative** | theory, and the theory component of lab-embedded theory courses, when class strength **> 10**            |
 * | **Absolute** | the same courses when class strength is **≤ 10**, **and always** — "irrespective of the class strength" — for laboratory, soft-skills, extra-curricular, NGCR and **project** courses |
 *
 * Verbatim: *"If the class strength is less than or equal to 10 in a theory or lab
 * embedded theory course absolute grading shall be adopted instead of the class-wise
 * relative grading."*
 *
 * The two regimes share the **letter set** (`S`…`F`, plus `N`/`W`/`U`/`P` which carry
 * no points) but not the band widths: relative uses σ multiples, absolute uses fixed
 * mark ranges. So a platform that knows only the course's marks cannot know which
 * regime produced a letter — which is why `resolveGradingRegime` takes the course
 * category and the headcount rather than inferring from data.
 */

/**
 * What a course is, for the purpose of choosing a regime.
 *
 * Re-exported from the Prisma enum rather than declared again, because two definitions of
 * the same vocabulary drift. It is a **type-only** import, which is erased at build time, so
 * this module stays pure and safe to load in a client component.
 */
export type CourseCategory = PrismaCourseCategory

export type GradingRegime = "relative" | "absolute"

/** Class strength at or below which a theory course is graded absolutely. */
export const RELATIVE_GRADING_MIN_STRENGTH = 11

/**
 * Which regime a course uses.
 *
 * Note the test is `<= RELATIVE_GRADING_MIN_STRENGTH - 1`, i.e. **10 or fewer is
 * absolute** — the regulation says "less than or equal to 10", so exactly 10 is
 * absolute and 11 is relative. Off-by-one here would put a 10-student class on σ
 * bands it never had, and the two regimes disagree about the pass line.
 */
export function resolveGradingRegime(
  category: CourseCategory,
  classStrength: number,
): GradingRegime {
  // These are absolute regardless of size, per the regulation's own words.
  if (
    category === "LABORATORY" ||
    category === "PROJECT" ||
    category === "SOFT_SKILLS" ||
    category === "EXTRA_CURRICULAR" ||
    category === "NGCR"
  ) {
    return "absolute"
  }

  return classStrength < RELATIVE_GRADING_MIN_STRENGTH ? "absolute" : "relative"
}

/**
 * Table-6's fixed bounds. Lower-inclusive, upper-exclusive, matching the relative
 * bands' convention so the two can share a lookup.
 *
 * The absolute `D`/`E` split is the one the platform has never had: **`D` is 55–60 and
 * `E` is 50–55**. `letterGrade` in `lib/gradebook.ts` has no `E` at all and passes at
 * 60, so it is wrong under this table — see the note on the export defect in
 * `docs/plans/wave-3.md` §7.6.
 */
export const ABSOLUTE_BANDS: readonly GradeBandRange[] = [
  { letter: "S", min: 90, max: null },
  { letter: "A", min: 80, max: 90 },
  { letter: "B", min: 70, max: 80 },
  { letter: "C", min: 60, max: 70 },
  { letter: "D", min: 55, max: 60 },
  { letter: "E", min: 50, max: 55 },
  { letter: "F", min: 0, max: 50 },
]

/** The absolute pass mark. `E` is the lowest passing grade. */
export const ABSOLUTE_PASS_MARK = 50

/**
 * The letter under the absolute regime.
 *
 * Returns `null` only for a non-finite mark, so a caller renders nothing rather than
 * a defaulted grade. Unlike the relative bands this never withholds a letter for
 * small samples: an absolute band is a function of one student's mark and needs no
 * cohort, which is exactly why the regulation falls back to it for small classes.
 */
export function absoluteLetter(mark: number, options: BandOptions = {}): RelativeLetter | null {
  if (!Number.isFinite(mark)) return null

  const upperInclusive = options.upperInclusive ?? true

  for (const band of ABSOLUTE_BANDS) {
    const meetsMin = upperInclusive ? mark >= band.min : mark > band.min
    if (band.max === null) {
      if (meetsMin) return band.letter
      continue
    }
    const meetsMax = upperInclusive ? mark < band.max : mark <= band.max
    if (meetsMin && meetsMax) return band.letter
  }

  return null
}

// ---------------------------------------------------------------------------
// Which regime to actually use, and why
// ---------------------------------------------------------------------------

/**
 * A notice to render when the platform falls back to absolute grading.
 *
 * Attached to every fallback so the UI never silently substitutes one regime for
 * another. A relative-graded class shown absolute bands, with no explanation, would look
 * like a correct grade that happens to be wrong — the failure mode this whole area has
 * now produced twice.
 */
export type GradingNotice = {
  tone: "info" | "warning"
  title: string
  detail: string
  /** Present when the fallback is waiting for data, so the UI can show progress. */
  progress?: { available: number; required: number }
}

export type RegimeDecision =
  | {
      regime: "relative"
      /** The class's published grand totals, which the σ bands are computed from. */
      mean: number
      standardDeviation: number
      markedCount: number
    }
  | {
      regime: "absolute"
      reason: "category-unset" | "small-class" | "non-theory-course" | "awaiting-base-metrics"
      notice: GradingNotice
    }

/**
 * The minimum number of students with a **published grand total** before relative grading
 * is used.
 *
 * Deliberately the same number as `RELATIVE_GRADING_MIN_STRENGTH`: VIT's own threshold is
 * a statement about how many students a banding needs, and applying it to the *marked*
 * cohort rather than only the enrolled one is the same rule read honestly. A class of 40
 * with 4 published totals has σ computed from 4 students — and σ over 4 is not a base.
 */
export const RELATIVE_MIN_MARKED_STUDENTS = RELATIVE_GRADING_MIN_STRENGTH

export type RegimeInput = {
  /**
   * The course's category, or `null` when it has not been set.
   *
   * **Null is not `THEORY`.** The platform cannot infer a course's kind from its data, and
   * guessing `THEORY` would silently put a laboratory course on relative bands — the exact
   * failure this field exists to prevent. An unset category falls back to absolute with a
   * notice asking for it, which is the same treatment as missing base metrics: withhold and
   * explain rather than assume.
   */
  category: CourseCategory | null
  /** Students enrolled in the offering. */
  enrolledCount: number
  /** Published grand totals — one per student who has been marked. */
  publishedTotals: readonly number[]
}

/**
 * Decide the regime **and** produce the notice when the answer is "absolute".
 *
 * Five ways a course lands on absolute, and they are not equivalent to a user:
 *
 * | Reason | What it means |
 * | ------ | ------------- |
 * | `category-unset` | nobody has said what kind of course this is, so no rule can be applied |
 * | `non-theory-course` | the regulation says absolute, always, whatever the size |
 * | `small-class` | ≤ 10 students, so VIT grades absolutely instead of relatively |
 * | `awaiting-base-metrics` | the class qualifies for relative, but too few marks are published to compute a mean and σ yet, or σ is 0 |
 *
 * The last is the one this function exists for. Relative grading needs the cohort's own
 * mean and σ; until enough students have published totals there is nothing to compute
 * them from, and **falling back to absolute with a visible notice is better than
 * publishing bands derived from four marks.** The relative view is withheld rather than
 * approximated.
 *
 * Order is deliberate: facts about the *course* are checked before facts about its *data*.
 * A 6-student lab is permanently absolute, so telling it "awaiting metrics" would imply it
 * might switch later — and it never will. `category-unset` comes first of all, because
 * without a category no later rule can be evaluated at all.
 */
export function resolveRegimeForCourse(input: RegimeInput): RegimeDecision {
  const { category, enrolledCount, publishedTotals } = input

  if (category === null) {
    return {
      regime: "absolute",
      reason: "category-unset",
      notice: {
        tone: "warning",
        title: "Absolute bands — course category not set",
        detail:
          "VIT grades theory courses relatively and laboratory, project and NGCR courses absolutely, so the course's category decides which bands apply. It has not been set, so absolute bands are shown meanwhile.",
      },
    }
  }

  // Checked next, because it is a permanent fact about the course. Telling a 6-student
  // lab that it is "awaiting metrics" would be misleading — it will never use relative
  // grading.
  if (isCategoricallyAbsolute(category)) {
    return {
      regime: "absolute",
      reason: "non-theory-course",
      notice: {
        tone: "info",
        title: "Graded on absolute bands",
        detail:
          "VIT grades laboratory, project, soft-skills, extra-curricular and NGCR courses absolutely, whatever the class size.",
      },
    }
  }

  if (enrolledCount < RELATIVE_GRADING_MIN_STRENGTH) {
    return {
      regime: "absolute",
      reason: "small-class",
      notice: {
        tone: "info",
        title: `Absolute bands (class of ${enrolledCount})`,
        detail: `VIT uses relative grading only above ${RELATIVE_GRADING_MIN_STRENGTH - 1} students. At ${enrolledCount}, absolute bands apply and the pass mark is ${RELATIVE_PASS_CAP}.`,
      },
    }
  }

  if (publishedTotals.length < RELATIVE_MIN_MARKED_STUDENTS) {
    return {
      regime: "absolute",
      reason: "awaiting-base-metrics",
      notice: {
        tone: "warning",
        title: "Absolute bands until the class mean and σ can be computed",
        detail: `Relative grading needs at least ${RELATIVE_MIN_MARKED_STUDENTS} published totals to compute the class mean and standard deviation. ${publishedTotals.length} ${publishedTotals.length === 1 ? "is" : "are"} published so far, so absolute bands are shown meanwhile.`,
        progress: {
          available: publishedTotals.length,
          required: RELATIVE_MIN_MARKED_STUDENTS,
        },
      },
    }
  }

  const average = publishedTotals.reduce((sum, value) => sum + value, 0) / publishedTotals.length
  const variance =
    publishedTotals.reduce((sum, value) => sum + (value - average) ** 2, 0) / publishedTotals.length
  const deviation = Math.sqrt(variance)

  // A flat cohort: every published total identical, so σ is 0 and every band would
  // collapse onto the mean. `gradeBandRanges` returns `null` for that case, which would
  // leave the caller holding a "relative" regime with no bands to render — so the fallback
  // belongs here, where the reason can be explained.
  if (deviation === 0) {
    return {
      regime: "absolute",
      reason: "awaiting-base-metrics",
      notice: {
        tone: "warning",
        title: "Absolute bands — the class has no spread yet",
        detail: `Every published total is ${Math.round(average * 100) / 100}, so the standard deviation is 0 and the relative bands would all fall on the same mark. Absolute bands are shown until the marks spread out.`,
        progress: { available: publishedTotals.length, required: RELATIVE_MIN_MARKED_STUDENTS },
      },
    }
  }

  return {
    regime: "relative",
    mean: Math.round(average * 100) / 100,
    standardDeviation: Math.round(deviation * 100) / 100,
    markedCount: publishedTotals.length,
  }
}

/** Whether the course's category is absolute regardless of headcount. */
export function isCategoricallyAbsolute(category: CourseCategory): boolean {
  return (
    category === "LABORATORY" ||
    category === "PROJECT" ||
    category === "SOFT_SKILLS" ||
    category === "EXTRA_CURRICULAR" ||
    category === "NGCR"
  )
}
