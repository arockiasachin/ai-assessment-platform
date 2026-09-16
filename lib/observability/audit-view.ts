import { prisma } from "@/lib/prisma"

import { ObservabilityError } from "./errors"

/**
 * Read-only view over the grade-pipeline `AuditLog`.
 *
 * `lib/grading` writes one `AuditLog` row per transition (`grade_review.*`,
 * `ai_suggestion.recorded`, `grade.ai_draft_*`, `grade.published`). Those rows
 * are keyed by the entity they touched and carry no offering id, so scoping to
 * an offering means: resolve the offering's assessments, collect the entity ids
 * that belong to them, and only then read the audit rows.
 *
 * That two-step is what keeps a teacher from seeing another teacher's pipeline:
 * ownership of the offering is verified first, and the entity-id allow-list is
 * built exclusively from that offering's assessments.
 */

export const GRADE_PIPELINE_ENTITY_TYPES = ["AIGradeSuggestion", "Grade", "GradeReview"] as const

export type GradeActivityQuery = {
  offeringId: string
  limit: number
}

export type GradeActivityItem = {
  id: string
  action: string
  entityType: string
  entityId: string
  entityLabel: string
  assessmentId: string | null
  actorId: string | null
  actorRole: string | null
  /**
   * The actor's display name, or `null` when it cannot be resolved.
   *
   * `AuditLog` stores only an id and a role so the log survives user deletion, which
   * means the name is a *lookup*, not a stored fact — a deleted actor resolves to
   * `null` and the page renders an em dash rather than inventing a name.
   */
  actorName: string | null
  createdAt: string
  /** `metadata` when present, else `after`; never the raw `before` snapshot. */
  summary: unknown
}

export type GradeActivity = {
  offeringId: string
  items: GradeActivityItem[]
  truncated: boolean
}

const ENTITY_LABELS: Record<string, string> = {
  AIGradeSuggestion: "AI suggestion",
  Grade: "Grade",
  GradeReview: "Review",
}

function entityLabel(entityType: string): string {
  return ENTITY_LABELS[entityType] ?? entityType
}

/**
 * The offering's ownership check plus the assessments it owns, in one place.
 *
 * Both readers on this surface need the same two steps — verify the caller owns
 * the offering, then collect the assessment ids that define its scope — so the rule
 * lives here rather than being written out twice. Scoping by assessment ids is what
 * keeps a teacher from seeing another teacher's pipeline: ownership of the offering
 * is verified first, and the id allow-list is built exclusively from that offering.
 *
 * @throws {ObservabilityError} 403 when the caller does not own the offering,
 *   404 when it does not exist.
 */
export async function resolveOwnedOffering(
  userId: string,
  offeringId: string,
): Promise<{ offeringId: string; assessmentIds: string[] }> {
  const staff = await prisma.staffProfile.findUnique({
    where: { userId },
    select: { id: true },
  })
  if (!staff) throw new ObservabilityError(403, "Forbidden")

  const offering = await prisma.courseOffering.findUnique({
    where: { id: offeringId },
    select: { id: true, teacherId: true },
  })
  if (!offering) throw new ObservabilityError(404, "Offering not found.")
  if (offering.teacherId !== staff.id) throw new ObservabilityError(403, "Forbidden")

  const assessments = await prisma.assessment.findMany({
    where: { offeringId: offering.id },
    select: { id: true },
  })

  return { offeringId: offering.id, assessmentIds: assessments.map((row) => row.id) }
}

/**
 * Resolve actor names for a set of audit rows in one query.
 *
 * `AuditLog.actorId` is a `User` id, and a name lives on whichever profile that user
 * has — so this is a single batched lookup, not a query per row. An actor that no
 * longer exists (the log deliberately survives user deletion) resolves to `null`
 * rather than an empty string, so the page can render an em dash.
 */
async function attachActorNames(items: GradeActivityItem[]): Promise<GradeActivityItem[]> {
  const actorIds = [...new Set(items.map((item) => item.actorId).filter((id) => id !== null))]
  if (actorIds.length === 0) return items

  const users = await prisma.user.findMany({
    where: { id: { in: actorIds } },
    select: {
      id: true,
      staffProfile: { select: { fullName: true } },
      studentProfile: { select: { fullName: true } },
    },
  })

  const nameByUserId = new Map(
    users.map((user) => [
      user.id,
      user.staffProfile?.fullName ?? user.studentProfile?.fullName ?? null,
    ]),
  )

  return items.map((item) => ({
    ...item,
    actorName: item.actorId === null ? null : (nameByUserId.get(item.actorId) ?? null),
  }))
}

/**
 * Recent grade-pipeline activity for one offering, newest first.
 *
 * @throws {ObservabilityError} 403 when the caller does not own the offering,
 *   404 when it does not exist.
 */
export async function getRecentGradeActivityForTeacher(
  authUser: { id: string },
  query: GradeActivityQuery,
): Promise<GradeActivity> {
  const { offeringId, assessmentIds } = await resolveOwnedOffering(authUser.id, query.offeringId)

  if (assessmentIds.length === 0) {
    return { offeringId, items: [], truncated: false }
  }

  const [suggestions, grades, reviews] = await Promise.all([
    prisma.aIGradeSuggestion.findMany({
      where: { assessmentId: { in: assessmentIds } },
      select: { id: true, assessmentId: true },
    }),
    prisma.grade.findMany({
      where: { assessmentId: { in: assessmentIds } },
      select: { id: true, assessmentId: true },
    }),
    prisma.gradeReview.findMany({
      where: { assessmentId: { in: assessmentIds } },
      select: { id: true, assessmentId: true },
    }),
  ])

  const assessmentByEntity = new Map<string, string>()
  const entityIds: string[] = []
  const register = (entityType: string, rows: { id: string; assessmentId: string }[]) => {
    for (const row of rows) {
      assessmentByEntity.set(`${entityType}:${row.id}`, row.assessmentId)
      entityIds.push(row.id)
    }
  }
  register("AIGradeSuggestion", suggestions)
  register("Grade", grades)
  register("GradeReview", reviews)

  if (entityIds.length === 0) {
    return { offeringId, items: [], truncated: false }
  }

  const rows = await prisma.auditLog.findMany({
    where: {
      entityType: { in: [...GRADE_PIPELINE_ENTITY_TYPES] },
      entityId: { in: entityIds },
    },
    orderBy: { createdAt: "desc" },
    take: query.limit + 1,
  })

  const truncated = rows.length > query.limit
  const items = await attachActorNames(
    rows.slice(0, query.limit).map<GradeActivityItem>((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      entityLabel: entityLabel(row.entityType),
      assessmentId: assessmentByEntity.get(`${row.entityType}:${row.entityId}`) ?? null,
      actorId: row.actorId,
      actorRole: row.actorRole,
      actorName: null,
      createdAt: row.createdAt.toISOString(),
      summary: row.metadata ?? row.after ?? null,
    })),
  )

  return { offeringId, items, truncated }
}
