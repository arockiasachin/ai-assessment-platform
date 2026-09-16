import { prisma } from "@/lib/prisma"

import { resolveOwnedOffering } from "./audit-view"

/**
 * The teacher's grading **decisions**: every mark they changed rather than accepted.
 *
 * This is the calibration surface. `Grade` already records `source`,
 * `overrideReason`, `publishedAt` and `approvedBy`, so a teacher can see *what* they
 * changed, *why*, and *who* signed it off — which is the data a
 * grading-agreement report would eventually be computed from.
 *
 * **Restricted to `TEACHER_OVERRIDE`.** An `AI_SUGGESTED` grade is an untouched
 * suggestion, so listing it here would make the table say "decisions" while showing
 * non-decisions. That is also what the design drew: the mockup filters its fixture
 * on exactly this source.
 *
 * Scope comes from the caller's **owned offerings**, resolved the same way the audit
 * view does it (verify ownership, then collect the offering's assessment ids), so
 * this cannot read another teacher's grades. `resolveOwnedOffering` is shared with
 * `audit-view.ts` rather than re-implemented — it is an authorization rule, and an
 * authorization rule with two implementations is a hole waiting to diverge.
 *
 * There is no pagination. A table of overrides for one offering is bounded by the
 * number of marks a human changed, which is small next to the audit log; the `take`
 * is a safety bound, and `truncated` says when it bit.
 */

const DEFAULT_LIMIT = 50

export type GradingDecisionItem = {
  id: string
  studentName: string
  assessmentTitle: string
  points: number
  maxPoints: number
  /** Null when `maxPoints` is zero, which the schema does not forbid. */
  percent: number | null
  /** Always `TEACHER_OVERRIDE` today; kept explicit so the source is never assumed. */
  source: string
  /** Why the mark differs from the suggestion. Null for a manual mark with no note. */
  overrideReason: string | null
  /** Who published it. Null when the grade is not published or the profile is gone. */
  approvedBy: string | null
  /** ISO, or null when the mark is withheld from the student. */
  publishedAt: string | null
}

export type GradingDecisions = {
  offeringId: string
  items: GradingDecisionItem[]
  truncated: boolean
}

/** The subset of a `grade.findMany` row the projection reads. */
export type GradingDecisionQueryRow = {
  id: string
  points: unknown
  maxPoints: unknown
  percentage: number | null
  source: string
  overrideReason: string | null
  publishedAt: Date | null
  student: { fullName: string }
  assessment: { title: string }
  approvedBy: { fullName: string } | null
}

/**
 * Pure projection, so the read path has a test that needs no database.
 *
 * Two conversions worth naming. `points`/`maxPoints` are Prisma `Decimal`, which do
 * not survive a Server→Client boundary, so they become numbers here. And `percent` is
 * computed from the real marks when the stored `percentage` is null, rather than
 * trusting a column that may not have been written — but it stays `null` when
 * `maxPoints` is zero, because dividing by zero would otherwise render `Infinity`.
 */
export function toGradingDecisionItem(row: GradingDecisionQueryRow): GradingDecisionItem {
  const points = Number(row.points)
  const maxPoints = Number(row.maxPoints)

  return {
    id: row.id,
    studentName: row.student.fullName,
    assessmentTitle: row.assessment.title,
    points,
    maxPoints,
    percent:
      row.percentage ?? (maxPoints > 0 ? Math.round((points / maxPoints) * 1000) / 10 : null),
    source: row.source,
    overrideReason: row.overrideReason,
    approvedBy: row.approvedBy?.fullName ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
  }
}

/**
 * Every mark a teacher overrode on one offering, most recently updated first.
 *
 * @throws {ObservabilityError} 403 when the caller does not own the offering,
 *   404 when it does not exist.
 */
export async function listGradingDecisionsForTeacher(
  authUser: { id: string },
  offeringId: string,
  options: { limit?: number } = {},
): Promise<GradingDecisions> {
  const limit = Math.min(200, Math.max(1, Math.trunc(options.limit ?? DEFAULT_LIMIT)))

  // Shared with the audit view so the ownership rule cannot drift between the two
  // readers on this page.
  const resolved = await resolveOwnedOffering(authUser.id, offeringId)

  if (resolved.assessmentIds.length === 0) {
    return { offeringId: resolved.offeringId, items: [], truncated: false }
  }

  const rows = await prisma.grade.findMany({
    where: {
      assessmentId: { in: resolved.assessmentIds },
      source: "TEACHER_OVERRIDE",
    },
    orderBy: { updatedAt: "desc" },
    take: limit + 1,
    select: {
      id: true,
      points: true,
      maxPoints: true,
      percentage: true,
      source: true,
      overrideReason: true,
      publishedAt: true,
      student: { select: { fullName: true } },
      assessment: { select: { title: true } },
      approvedBy: { select: { fullName: true } },
    },
  })

  const truncated = rows.length > limit

  return {
    offeringId: resolved.offeringId,
    items: rows.slice(0, limit).map(toGradingDecisionItem),
    truncated,
  }
}
