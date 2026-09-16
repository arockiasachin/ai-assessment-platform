import "server-only"

import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

import { loadOwnedOffering } from "./authz"
import { buildWeeklySeries, type DatedMark, type WeeklySeries } from "./weekly-series"

/**
 * The cohort's score trend, bucketed by teaching week.
 *
 * ## The two choices U1 and U2 left open, now made
 *
 * **U1 — which timestamp dates a mark: `Assessment.dueDate`.** It is the only anchor that
 * exists for all four assessment types; `QuizAttempt.submittedAt` and `Grade.publishedAt` are
 * quiz-only and published-only, so either would silently drop three of the four demo
 * assessments from the chart and leave it looking complete.
 *
 * **U2 — a week's value is that week's own assessments**, not a running mean. A running mean's
 * final point always equals the cohort mean, so the chart's last point would duplicate the
 * "cohort mean" tile above it and neither could ever disagree with the other.
 *
 * ## Only published, past-due marks
 *
 * The same inclusion rule as everywhere else (`isMarkIncludedInMean`): a mark enters once its
 * assessment is past due and the mark is released. A week whose assessment is still open stays
 * `null`, so a weekly point does not move while students can still submit.
 *
 * ## No term dates means no series
 *
 * `startsOn`/`endsOn` are nullable and B2 requires this: without them there is no honest axis,
 * so the reader returns `null` and the page renders nothing with an explanation rather than
 * guessing a start date and putting real marks in the wrong week.
 */

export type CohortTrend = {
  offeringId: string
  /** `null` when the offering has no term window, so there is no axis to bucket against. */
  series: WeeklySeries | null
  /** Marks that fell inside the term. Out-of-term marks are dropped by the builder. */
  markedCount: number
}

export async function getCohortTrendForTeacher(
  user: AuthUser,
  offeringId: string,
): Promise<CohortTrend> {
  const offering = await loadOwnedOffering(user, offeringId)
  return buildTrendForOffering(offering.id)
}

/** The trend for an offering already known to be authorized. See `buildRosterForOffering`. */
export async function buildTrendForOffering(offeringId: string): Promise<CohortTrend> {
  const [term, grades] = await Promise.all([
    prisma.courseOffering.findUniqueOrThrow({
      where: { id: offeringId },
      select: { startsOn: true, endsOn: true },
    }),
    prisma.grade.findMany({
      where: {
        assessment: { offeringId },
        publishedAt: { not: null },
      },
      select: {
        points: true,
        maxPoints: true,
        assessment: { select: { dueDate: true } },
      },
    }),
  ])

  const marks: DatedMark[] = grades.flatMap((grade) => {
    const points = Number(grade.points)
    const max = Number(grade.maxPoints)
    if (!Number.isFinite(points) || !Number.isFinite(max) || max <= 0) return []
    return [{ at: grade.assessment.dueDate, percentage: (points / max) * 100 }]
  })

  return {
    offeringId,
    series: buildWeeklySeries(marks, { startsOn: term.startsOn, endsOn: term.endsOn }),
    markedCount: marks.length,
  }
}
