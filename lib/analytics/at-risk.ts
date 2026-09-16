import "server-only"

import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

import { loadOwnedOffering } from "./authz"
import { ABSOLUTE_PASS_MARK, resolveRegimeForCourse, type GradingNotice } from "./grading-bands"
import { gatherRegimeInputs } from "./grading-regime"

/**
 * The at-risk roster: who is below the course's own pass line.
 *
 * ## What "at risk" means here, and why it depends on the regime
 *
 * VIT grades two ways. Under **absolute** bands a student fails below a fixed mark, so at-risk
 * is simply "below 50". Under **relative** bands the line is the cohort's own
 * `min(mean − 2σ, 50)`, so it depends on everyone else's marks. This reader resolves the
 * regime first and uses whichever line applies, which is the only way the roster and the grade
 * sheet cannot disagree.
 *
 * `at-risk-rules.ts` holds the pure parts so they can be tested without a database.
 *
 * ## The three groups, which are not interchangeable
 *
 * | Group | Meaning |
 * | ----- | ------- |
 * | `below-boundary` | judged, and short of the course's pass line |
 * | `no-published-work` | **not judged.** No released mark exists, so there is nothing to compare |
 * | (everyone else) | judged and above the line |
 *
 * The middle group is the one that matters. Folding an unmarked student into the at-risk list
 * would flag them on evidence that does not exist, and folding them into "fine" would hide
 * that they have done nothing. So they are reported **separately**, and the count of them is
 * on the roster — which is also how a teacher sees that marking is unfinished rather than
 * concluding the class is fine.
 *
 * ## Published marks only
 *
 * A `Grade` contributes only when `publishedAt` is set. An unreleased mark is not a fact a
 * teacher-facing alert may act on, and zero-filling the rest drives the boundary to a number
 * that describes nobody — see `docs/plans/wave-3.md` §8, U5.
 */

export type AtRiskGroup = "below-boundary" | "no-published-work"

export type AtRiskStudent = {
  studentId: string
  fullName: string
  registerNumber: string
  /** The student's grand total, or `null` in the `no-published-work` group. */
  grandTotal: number | null
  group: AtRiskGroup
}

export type AtRiskRoster = {
  offeringId: string
  /** The line a student must reach. `null` when the class is too small to judge. */
  boundary: number | null
  regime: "relative" | "absolute"
  notice: GradingNotice | null
  /** How many enrolled students have a published total. */
  publishedCount: number
  enrolledCount: number
  atRisk: AtRiskStudent[]
  /** Enrolled, with at least one published mark, and at or above the boundary. */
  aboveBoundaryCount: number
}

/**
 * The at-risk roster for an offering the caller teaches.
 *
 * @throws {AnalyticsError} 403 when the caller does not own the offering, 404 when it does
 *   not exist.
 */
export async function getAtRiskRosterForTeacher(
  user: AuthUser,
  offeringId: string,
): Promise<AtRiskRoster> {
  const offering = await loadOwnedOffering(user, offeringId)
  const inputs = await gatherRegimeInputs(offering.id)
  const decision = resolveRegimeForCourse(inputs)

  const students = await prisma.studentProfile.findMany({
    where: { enrollments: { some: { offeringId: offering.id, status: "active" } } },
    select: {
      id: true,
      fullName: true,
      registerNumber: true,
      finalGrades: {
        where: { assessment: { offeringId: offering.id }, publishedAt: { not: null } },
        select: { points: true, maxPoints: true },
      },
    },
  })

  const totals = students.map((student) => ({
    studentId: student.id,
    fullName: student.fullName,
    registerNumber: student.registerNumber,
    percentages: student.finalGrades
      .map((grade) => {
        const points = Number(grade.points)
        const max = Number(grade.maxPoints)
        return Number.isFinite(points) && Number.isFinite(max) && max > 0
          ? (points / max) * 100
          : null
      })
      .filter((value): value is number => value !== null),
  }))

  const { boundary, atRisk, aboveBoundaryCount } = buildAtRiskRoster(totals, decision)

  return {
    offeringId: offering.id,
    boundary,
    regime: decision.regime,
    notice: decision.regime === "absolute" ? decision.notice : null,
    publishedCount: inputs.publishedTotals.length,
    enrolledCount: inputs.enrolledCount,
    atRisk,
    aboveBoundaryCount,
  }
}

type StudentTotals = {
  studentId: string
  fullName: string
  registerNumber: string
  percentages: number[]
}

/**
 * Pure classification, so the grouping rules have a test that needs no database.
 *
 * The boundary comes from the already-resolved decision: absolute means a fixed pass mark,
 * relative means the cohort's `min(mean − 2σ, 50)`. Passing the decision in rather than
 * recomputing keeps this function from being able to disagree with the regime the page shows.
 */
export function buildAtRiskRoster(
  students: readonly StudentTotals[],
  decision: ReturnType<typeof resolveRegimeForCourse>,
): { boundary: number | null; atRisk: AtRiskStudent[]; aboveBoundaryCount: number } {
  const boundary = decision.regime === "relative" ? relativeBoundary(decision) : ABSOLUTE_PASS_MARK

  const atRisk: AtRiskStudent[] = []
  let aboveBoundaryCount = 0

  for (const student of students) {
    if (student.percentages.length === 0) {
      atRisk.push({
        studentId: student.studentId,
        fullName: student.fullName,
        registerNumber: student.registerNumber,
        grandTotal: null,
        group: "no-published-work",
      })
      continue
    }

    const grandTotal =
      student.percentages.reduce((sum, value) => sum + value, 0) / student.percentages.length

    if (grandTotal < boundary) {
      atRisk.push({
        studentId: student.studentId,
        fullName: student.fullName,
        registerNumber: student.registerNumber,
        grandTotal: Math.round(grandTotal * 100) / 100,
        group: "below-boundary",
      })
    } else {
      aboveBoundaryCount += 1
    }
  }

  // Worst first, then the unmarked group last: a teacher reads this list to act, and a
  // student with no work is a different action from a student who is close to the line.
  atRisk.sort((a, b) => {
    if (a.group !== b.group) return a.group === "below-boundary" ? -1 : 1
    return (a.grandTotal ?? 0) - (b.grandTotal ?? 0)
  })

  return { boundary, atRisk, aboveBoundaryCount }
}

/** The relative boundary from the resolved decision, floored at VIT's cap of 50. */
function relativeBoundary(decision: { mean: number; standardDeviation: number }): number {
  return Math.min(Math.round((decision.mean - 2 * decision.standardDeviation) * 100) / 100, 50)
}
