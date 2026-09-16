import "server-only"

import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

import { loadOwnedOffering } from "./authz"
import { resolveRegimeForCourse, type GradingNotice, type RegimeDecision } from "./grading-bands"

/**
 * The grading regime for one offering, resolved from real data.
 *
 * `resolveRegimeForCourse` is pure and takes the three inputs it needs; this module is the
 * server-side half that gathers them — the course's category, the enrolment count, and the
 * students' **published grand totals** — and returns the decision (with its notice) ready
 * for a page to render.
 *
 * ## Why the totals are published `Grade` rows
 *
 * A relative band is `mean ± kσ` over the cohort's grand totals, so the totals must be the
 * same numbers the course is graded on: published, past-due marks combined by the course's
 * grading policy. Reading attempts instead would band a different population from the one
 * the grade sheet describes — the divergence this whole area has already produced twice.
 *
 * A student with **no published total is excluded**, not counted as zero: zero-filling drives
 * the mean and σ to numbers that describe nobody (see `docs/plans/wave-3.md` §8, U5).
 *
 * ## Scope
 *
 * Uses the same ownership check as every other analytics read, so a teacher can only resolve
 * a regime for an offering they teach.
 */

export type OfferingGradingRegime = {
  offeringId: string
  courseCode: string
  courseName: string
  /** `null` when the course's category has not been set. */
  category: string | null
  enrolledCount: number
  publishedCount: number
  decision: RegimeDecision
  /** The notice to render, or `null` when relative bands are in use. */
  notice: GradingNotice | null
}

/** Grand totals are percentages, so each published mark contributes `points / maxPoints`. */
function percentageOf(points: unknown, maxPoints: unknown): number | null {
  const p = Number(points)
  const m = Number(maxPoints)
  if (!Number.isFinite(p) || !Number.isFinite(m) || m <= 0) return null
  return Math.round((p / m) * 10000) / 100
}

/**
 * Resolve the regime for an offering the caller teaches.
 *
 * @throws {AnalyticsError} 403 when the caller does not own the offering, 404 when it does
 *   not exist.
 */
export async function getOfferingGradingRegime(
  user: AuthUser,
  offeringId: string,
): Promise<OfferingGradingRegime> {
  const offering = await loadOwnedOffering(user, offeringId)

  const [courseCategory, enrolledCount, grades] = await Promise.all([
    prisma.courseOffering
      .findUniqueOrThrow({
        where: { id: offering.id },
        select: { course: { select: { category: true } } },
      })
      .then((row) => row.course.category),
    prisma.enrollment.count({ where: { offeringId: offering.id, status: "active" } }),
    prisma.grade.findMany({
      where: {
        assessment: { offeringId: offering.id },
        publishedAt: { not: null },
      },
      select: { studentId: true, points: true, maxPoints: true },
    }),
  ])

  // One total per student: a student can have several published grades, and the grand total
  // is the mean of their published percentages — the unweighted form the grading policy
  // uses, matching `lib/teacher-roster.ts`.
  const byStudent = new Map<string, number[]>()
  for (const grade of grades) {
    const pct = percentageOf(grade.points, grade.maxPoints)
    if (pct === null) continue
    const list = byStudent.get(grade.studentId)
    if (list) list.push(pct)
    else byStudent.set(grade.studentId, [pct])
  }

  const publishedTotals = [...byStudent.values()].map(
    (percentages) => percentages.reduce((sum, value) => sum + value, 0) / percentages.length,
  )

  const decision = resolveRegimeForCourse({
    category: courseCategory,
    enrolledCount,
    publishedTotals,
  })

  return {
    offeringId: offering.id,
    courseCode: offering.courseCode,
    courseName: offering.courseName,
    category: courseCategory,
    enrolledCount,
    publishedCount: publishedTotals.length,
    decision,
    notice: decision.regime === "absolute" ? decision.notice : null,
  }
}
