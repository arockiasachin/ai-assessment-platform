/**
 * The weekly series behind the score-trend chart.
 *
 * B2 resolved what a "teaching week" is: one of a semester's **15 instructional
 * weeks**, defined by the institution's own regulations rather than invented here.
 * So a bucket is a calendar week counted from the offering's `startsOn`, and the
 * series is as long as the term — six points was the mockup's illustration, not the
 * rule.
 *
 * Two behaviours are deliberate and worth stating, because both are places a chart
 * usually lies:
 *
 * - **A week with no assessed work is `null`, not `0`.** Zero would draw a point at
 *   the bottom of the chart and read as "the class scored nothing", when the truth
 *   is "nothing was assessed". The mockup already renders a `null` at W3 for exactly
 *   this reason, so the design agrees.
 * - **No term dates means no series at all.** `CourseOffering.startsOn`/`endsOn` are
 *   nullable. Without them there is no honest axis to bucket against, so this returns
 *   `null` and the caller renders nothing with an explanation — rather than guessing
 *   a start date or defaulting the length, either of which would put real marks in
 *   the wrong week.
 *
 * Pure: no database, no clock. The caller supplies dated marks and the term window.
 */

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export type DatedMark = {
  /** ISO timestamp or `Date` — the moment the work was assessed. */
  at: Date
  /** Percentage in `[0, 100]`. */
  percentage: number
}

export type WeeklyPoint = {
  /** 1-based week number within the term. */
  week: number
  /** Mean percentage for the week, or `null` when nothing was assessed in it. */
  average: number | null
  /** How many marks fell in the week. Zero for a `null` average. */
  count: number
}

export type WeeklySeries = {
  /** Always equals `points.length`; carried so a caller need not re-derive it. */
  weeks: number
  points: WeeklyPoint[]
  startsOn: string
  endsOn: string
}

export type WeeklySeriesOptions = {
  /**
   * Cap on the number of weeks to emit.
   *
   * Guards against a mis-set `endsOn` (a term of several years would allocate an
   * enormous array and a chart with thousands of categories). Defaults to a
   * generous 60 — four times a 15-week semester — so a legitimate long term still
   * works while an absurd one is bounded rather than fatal.
   */
  maxWeeks?: number
}

const DEFAULT_MAX_WEEKS = 60

/**
 * The week index a mark belongs to, 1-based from `startsOn`.
 *
 * Uses `Math.floor` on the elapsed whole weeks, so a mark exactly on `startsOn` is
 * week 1 and a mark at the very end of week 1 is still week 1. A mark *before*
 * `startsOn` yields a value below 1, which `buildWeeklySeries` drops rather than
 * folding into week 1 — work assessed before the term began does not belong on the
 * term's chart.
 */
export function weekIndexOf(at: Date, startsOn: Date): number {
  return Math.floor((at.getTime() - startsOn.getTime()) / WEEK_MS) + 1
}

/** Whole weeks between two instants, rounded — so a 15-week term reports 15. */
export function termWeeks(startsOn: Date, endsOn: Date): number {
  return Math.max(1, Math.round((endsOn.getTime() - startsOn.getTime()) / WEEK_MS))
}

/**
 * Bucket dated marks into one point per week of the term.
 *
 * Returns `null` when the term window is unavailable or unusable (either date
 * missing, or `endsOn` not after `startsOn`), because a series needs an axis and
 * there is not one.
 */
export function buildWeeklySeries(
  marks: readonly DatedMark[],
  term: { startsOn: Date | null; endsOn: Date | null },
  options: WeeklySeriesOptions = {},
): WeeklySeries | null {
  const { startsOn, endsOn } = term
  if (!startsOn || !endsOn) return null
  if (endsOn.getTime() <= startsOn.getTime()) return null

  const maxWeeks = Math.max(1, Math.trunc(options.maxWeeks ?? DEFAULT_MAX_WEEKS))
  const weeks = Math.min(termWeeks(startsOn, endsOn), maxWeeks)

  const totals = new Array<number>(weeks + 1).fill(0)
  const counts = new Array<number>(weeks + 1).fill(0)

  for (const mark of marks) {
    const week = weekIndexOf(mark.at, startsOn)
    // Out of term: before it started, or past the clamped length.
    if (week < 1 || week > weeks) continue
    totals[week] += mark.percentage
    counts[week] += 1
  }

  const points: WeeklyPoint[] = []
  for (let week = 1; week <= weeks; week += 1) {
    points.push({
      week,
      count: counts[week],
      // `null`, never `0`, for a week with no assessed work.
      average: counts[week] === 0 ? null : Math.round((totals[week] / counts[week]) * 100) / 100,
    })
  }

  return {
    weeks,
    points,
    startsOn: startsOn.toISOString(),
    endsOn: endsOn.toISOString(),
  }
}
