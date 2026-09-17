import type {
  AnalyticsAssessmentSummary,
  AtRiskStudentValue,
  CohortTrendValue,
} from "@/lib/contracts/analytics"
import type { AssessmentType } from "@/lib/generated/prisma/enums"
import { formatPercent } from "@/lib/format"
import type { ReviewQueueItem } from "@/lib/rubric-grading/contracts"
import type { TeacherDeadlineItem } from "@/lib/teacher-planner"

/**
 * Pure view logic for the teacher dashboard.
 *
 * The page fetches, the client component renders, and everything that decides what a
 * number *is* lives here — the same split as `lib/planner-view.ts` and
 * `lib/observability-view.ts`, and for the same reason: this repo has no jsdom, so
 * anything left inside a component has no test.
 *
 * ## What the mockup drew that is deliberately absent
 *
 * The mockup dashboard carried four KPI sparklines, a week-over-week `delta` on two
 * tiles, a term target on the cohort chart, and a `weightPercent` column. None of
 * them can be derived from stored data, so none of them are ported:
 *
 * - the sparklines need a six-week history of each KPI. Nothing stores snapshots, so
 *   a trend line could only be invented (`docs/plans/mockup-to-backend.md` §8);
 * - the `delta` needs last week's value of the same KPI. There is no last week;
 * - the cohort chart's target is not a column and is not in `CohortTrend`. The chart
 *   is the weekly series, and the section reports `markedCount` instead;
 * - `weightPercent` has no backing column anywhere in the schema
 *   (`docs/plans/wave-3.md`).
 *
 * A dropped figure is correct; a fabricated one is a defect.
 *
 * The `ReviewQueueItem` shape is the other half of that rule: it has no assessment
 * `type`, so the mockup's "kind" sub-line under a student's name is dropped rather
 * than guessed from the title.
 */

export type TeacherKpiId = "enrolled" | "cohort-average" | "awaiting-review" | "at-risk"

export type TeacherDashboardKpi = {
  id: TeacherKpiId
  label: string
  value: string
  hint: string
  accent: "primary" | "success" | "warning" | "destructive"
}

/**
 * The cohort mean, weighted by how many students each assessment marked.
 *
 * `averages` are the per-assessment means the analytics overview already computes.
 * Weighting by `attemptCount` keeps a quiz with two attempts from moving the tile as
 * much as one with forty, which an unweighted mean would do.
 *
 * Deliberately **not** `gradingRegime.mean`: that field is the mean the *relative
 * banding* decision was made on. It is absent under absolute banding (the common
 * case) and describes published grand totals rather than assessed work, so using it
 * would blank the tile for most offerings and silently change population when the
 * banding did.
 *
 * Returns `null` — an em dash, never `0` — when nothing has been marked.
 */
export function cohortAverageFromAssessments(
  assessments: readonly { average: number | null; attemptCount: number }[],
): number | null {
  let weighted = 0
  let weight = 0
  for (const assessment of assessments) {
    if (assessment.average === null || assessment.attemptCount <= 0) continue
    weighted += assessment.average * assessment.attemptCount
    weight += assessment.attemptCount
  }
  if (weight === 0) return null
  return weighted / weight
}

/**
 * The teacher's review queue narrowed to one offering.
 *
 * `listReviewQueueForTeacher` is scoped to the teacher, not to an offering, and its
 * filter only takes an `assessmentId`. The dashboard is offering-scoped like the
 * mockup's, so the caller passes the offering's assessment ids from the analytics
 * overview and this drops everything else. Without it the attention table and the
 * "Awaiting review" tile would describe a different population from the other three
 * tiles.
 */
export function reviewQueueForOffering(
  items: readonly ReviewQueueItem[],
  assessmentIds: readonly string[],
): ReviewQueueItem[] {
  const ids = new Set(assessmentIds)
  return items.filter((item) => ids.has(item.assessment.id))
}

/**
 * The weakest suggestion's confidence, or `null` when there are none.
 *
 * The queue exists because at least one criterion fell below the confidence floor, so
 * the minimum is the number that explains why the row is here. An average could sit
 * comfortably above the floor while one criterion is far below it, which would make
 * the column read as reassurance the row does not warrant.
 */
export function lowestConfidence(suggestions: readonly { confidence: number }[]): number | null {
  if (suggestions.length === 0) return null
  let lowest = Infinity
  for (const suggestion of suggestions) {
    if (suggestion.confidence < lowest) lowest = suggestion.confidence
  }
  return Number.isFinite(lowest) ? lowest : null
}

export type AttentionRows = {
  /** The rows the table renders, highest priority first. */
  rows: ReviewQueueItem[]
  /** How many rows matched the offering, before the display limit. */
  total: number
}

/**
 * The attention table's rows.
 *
 * `limit` exists because the mockup showed the five highest-priority items and said
 * so. The reader returns the queue newest-updated first, and this preserves that
 * order rather than inventing a priority score the data does not have.
 */
export function attentionForOffering(
  items: readonly ReviewQueueItem[],
  assessmentIds: readonly string[],
  limit = 5,
): AttentionRows {
  const scoped = reviewQueueForOffering(items, assessmentIds)
  return { rows: scoped.slice(0, limit), total: scoped.length }
}

export type AtRiskCounts = {
  /** Judged, and short of the course's pass line. */
  belowBoundary: number
  /**
   * Enrolled, but with no released mark — **not judged**. Counted separately because
   * folding them into `belowBoundary` would flag them on evidence that does not exist.
   */
  noPublishedWork: number
  /** Both groups: what the tile shows. */
  total: number
}

export function atRiskCounts(atRisk: readonly AtRiskStudentValue[]): AtRiskCounts {
  let belowBoundary = 0
  let noPublishedWork = 0
  for (const student of atRisk) {
    if (student.group === "below-boundary") belowBoundary += 1
    else noPublishedWork += 1
  }
  return { belowBoundary, noPublishedWork, total: atRisk.length }
}

export type AssessmentProgressRow = {
  id: string
  title: string
  /** Null when the deadline reader did not return this assessment — see below. */
  kind: AssessmentType | null
  dueDate: string
  averagePercent: number | null
  submitted: number | null
  graded: number | null
  released: boolean | null
}

/**
 * The assessment-progress table, joining the analytics summary to the deadline rows.
 *
 * Two readers own different halves of the same assessment: the analytics overview has
 * the mean and the attempt count but no submission/release facts, and the deadline
 * reader has submissions, published marks and `releasedAt` but no mean. Joining by id
 * is the only way to render the row the mockup drew without computing either half a
 * second time.
 *
 * The join is a **left** join from the overview, because the overview is the list
 * scoped to the offering being displayed. A missing deadline side stays `null` and
 * renders an em dash rather than a zero: "we did not read this" and "nothing was
 * submitted" are different facts. In practice every assessment on an owned offering
 * is returned by `listAssessmentDeadlinesForTeacher`, which uses the same ownership
 * rule — the null side is defensive.
 */
export function buildAssessmentProgressRows(
  assessments: readonly AnalyticsAssessmentSummary[],
  deadlines: readonly TeacherDeadlineItem[],
): AssessmentProgressRow[] {
  const deadlinesById = new Map(deadlines.map((deadline) => [deadline.id, deadline]))
  return assessments.map((assessment) => {
    const deadline = deadlinesById.get(assessment.id) ?? null
    return {
      id: assessment.id,
      title: assessment.title,
      kind: deadline?.kind ?? null,
      dueDate: assessment.dueDate,
      averagePercent: assessment.average,
      submitted: deadline?.submitted ?? null,
      graded: deadline?.graded ?? null,
      released: deadline?.released ?? null,
    }
  })
}

export type MarkingProgress = {
  /** Marks recorded on the assessment. */
  graded: number
  /**
   * The denominator a bar over the cohort can honestly use. Never smaller than
   * `graded`, so the bar can never exceed its own maximum.
   */
  markable: number
  valueText: string
  complete: boolean
}

/**
 * The "Marked" cell's bar (TN-2).
 *
 * `graded` is **not** a subset of `submitted`. A manual mark can exist for a student who
 * never submitted — the seed's DSA sets are exactly that: nine `Grade` rows and zero
 * `Submission` rows — so dividing `graded` by `submitted` produced "9 / 0 ... 100%", a
 * ratio that cannot exist. The honest denominator is the cohort the marks are drawn from,
 * `enrolled`, widened to `graded` (and `submitted`) so a mark recorded against a student
 * outside that count still renders a bar that fits.
 */
export function markingProgress(input: {
  graded: number
  submitted: number
  enrolled: number
}): MarkingProgress {
  const markable = Math.max(input.enrolled, input.graded, input.submitted)
  return {
    graded: input.graded,
    markable,
    valueText: `${input.graded} / ${markable}`,
    complete: markable > 0 && input.graded >= markable,
  }
}

/** Chart-ready points: one per teaching week, `null` where nothing was assessed. */
export function cohortTrendPoints(
  series: CohortTrendValue["series"],
): { label: string; value: number | null }[] {
  if (!series) return []
  return series.points.map((point) => ({ label: `W${point.week}`, value: point.average }))
}

/**
 * Whether the trend chart has anything to draw.
 *
 * A series can exist and be entirely `null` — the term window is known but nothing has
 * been released yet. Charting that draws an empty axis that looks like a rendering
 * failure; the section renders an `EmptyState` instead.
 */
export function hasTrendData(series: CohortTrendValue["series"]): boolean {
  return series !== null && series.points.some((point) => point.average !== null)
}

/**
 * The four KPI tiles, from real payloads.
 *
 * No sparkline and no delta on any of them: see the module docblock.
 */
export function teacherDashboardKpis(input: {
  /** e.g. `DEMO-MATH-101 · Grade 10 A · Semester 1` — the offering the page is scoped to. */
  offeringLabel: string
  enrolledCount: number
  assessments: readonly { average: number | null; attemptCount: number }[]
  awaitingReview: number
  atRisk: readonly AtRiskStudentValue[]
}): TeacherDashboardKpi[] {
  const cohortAverage = cohortAverageFromAssessments(input.assessments)
  const risk = atRiskCounts(input.atRisk)

  return [
    {
      id: "enrolled",
      label: "Enrolled",
      value: String(input.enrolledCount),
      hint: input.offeringLabel,
      accent: "primary",
    },
    {
      id: "cohort-average",
      label: "Cohort average",
      value: formatPercent(cohortAverage),
      hint:
        cohortAverage === null
          ? "No released marks yet"
          : "Mark-weighted mean of this offering's assessments",
      accent: "success",
    },
    {
      id: "awaiting-review",
      label: "Awaiting review",
      value: String(input.awaitingReview),
      hint: "AI suggestions pending or needing review",
      accent: "warning",
    },
    {
      id: "at-risk",
      label: "At risk",
      value: String(risk.total),
      hint: `${risk.belowBoundary} below the pass line · ${risk.noPublishedWork} with no published work`,
      accent: "destructive",
    },
  ]
}
