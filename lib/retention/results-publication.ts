import { prisma } from "@/lib/prisma"
import { retentionCutoff } from "@/lib/retention/policy"
import type { AuthUser } from "@/lib/session"

/**
 * Results publication — the retention anchor.
 *
 * Publishing an offering's results is the explicit teacher action that starts
 * the retention clock. The timestamp is set exactly once and never moved:
 * re-publishing an already-published offering is reported as
 * `already-published` and leaves the anchor untouched. That is deliberate — a
 * later timestamp would extend how long student work is retained, and an
 * earlier one would shorten it; neither is a decision a repeat click may make.
 *
 * The endpoint is ownership-scoped: a teacher can only publish results for an
 * offering they own, and a foreign or nonexistent offering reports `not-found`.
 */

export type PublishOfferingResultsResult =
  | {
      kind: "published" | "already-published"
      offeringId: string
      resultsPublishedAt: Date
      /** `resultsPublishedAt + 15 days`; the earliest purge-eligible instant. */
      retentionCutoff: Date
    }
  | { kind: "staff-profile-missing" }
  | { kind: "not-found" }

export async function publishOfferingResults(
  actor: AuthUser,
  offeringId: string,
): Promise<PublishOfferingResultsResult> {
  const staff = await prisma.staffProfile.findUnique({
    where: { userId: actor.id },
    select: { id: true },
  })
  if (!staff) return { kind: "staff-profile-missing" }

  const now = new Date()

  const outcome = await prisma.$transaction(async (tx) => {
    const offering = await tx.courseOffering.findFirst({
      where: { id: offeringId, teacherId: staff.id },
      select: { id: true, resultsPublishedAt: true },
    })
    if (!offering) return { kind: "not-found" as const }

    if (offering.resultsPublishedAt) {
      return {
        kind: "already-published" as const,
        offeringId: offering.id,
        resultsPublishedAt: offering.resultsPublishedAt,
      }
    }

    // Conditional write keeps a concurrent double-publish from moving the
    // anchor: only a row that is still unpublished is stamped.
    const written = await tx.courseOffering.updateMany({
      where: { id: offering.id, resultsPublishedAt: null },
      data: { resultsPublishedAt: now },
    })

    if (written.count === 0) {
      const current = await tx.courseOffering.findUniqueOrThrow({
        where: { id: offering.id },
        select: { resultsPublishedAt: true },
      })
      return {
        kind: "already-published" as const,
        offeringId: offering.id,
        resultsPublishedAt: current.resultsPublishedAt ?? now,
      }
    }

    await tx.auditLog.create({
      data: {
        entityType: "CourseOffering",
        entityId: offering.id,
        action: "course_offering.results_published",
        actorId: actor.id,
        actorRole: actor.role,
        after: { resultsPublishedAt: now.toISOString() },
      },
    })

    return { kind: "published" as const, offeringId: offering.id, resultsPublishedAt: now }
  })

  if (outcome.kind === "not-found") return outcome
  return {
    ...outcome,
    retentionCutoff: retentionCutoff(outcome.resultsPublishedAt),
  }
}
