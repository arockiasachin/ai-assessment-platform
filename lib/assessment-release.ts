import "server-only"

import { writeAuditLog } from "@/lib/grading/audit"
import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"
import { resolveTeacherStaffId, teacherOwnsAssessment } from "@/lib/teacher-staff"

/**
 * Assessment release — making an assessment visible to students.
 *
 * This is the third of three publish-ish facts in the schema, and the reason the
 * column is `releasedAt` rather than `publishedAt`:
 *
 * | Fact                             | Granularity  | Meaning                            |
 * | -------------------------------- | ------------ | ---------------------------------- |
 * | `Assessment.releasedAt` (here)   | assessment   | students can see it                |
 * | `CourseOffering.resultsPublishedAt` | whole cohort | retention anchor; starts the purge clock |
 * | `Grade.publishedAt`              | one student  | that student's mark is out         |
 *
 * Setting the wrong one is not a type error, so the naming carries the weight.
 *
 * **Setting the timestamp is idempotent, and that is deliberate.** A repeat click
 * reports `already-released` and leaves the original instant untouched: moving it
 * later would extend how long students could see an assessment that had already
 * appeared, and moving it earlier would claim they saw it before they could. A
 * repeat click may not make either decision. The conditional write makes that true
 * under concurrency too, exactly as `results-publication.ts` does for the anchor.
 *
 * **Releasing writes no student-visible state beyond the timestamp.** It does not
 * grade, notify, or publish marks — `Grade.publishedAt` is a separate, human,
 * per-student action.
 */

export type ReleaseAssessmentResult =
  | {
      kind: "released" | "already-released"
      assessmentId: string
      releasedAt: Date
    }
  | { kind: "staff-profile-missing" }
  | { kind: "not-found" }

/**
 * Release an assessment to its students.
 *
 * A foreign assessment and a nonexistent one are reported identically as
 * `not-found`, so the endpoint never confirms that another teacher's assessment
 * exists. This differs on purpose from `loadOwnedAssessment` in
 * `lib/code-eval/authz.ts`, which separates 404 from 403 — that helper runs after
 * a caller has already been scoped, whereas this is a bare id from a URL.
 */
export async function releaseAssessment(
  actor: AuthUser,
  assessmentId: string,
): Promise<ReleaseAssessmentResult> {
  const staffId = await resolveTeacherStaffId(actor.id)
  if (!staffId) return { kind: "staff-profile-missing" }

  const now = new Date()

  return prisma.$transaction(async (tx) => {
    const assessment = await tx.assessment.findUnique({
      where: { id: assessmentId },
      select: {
        id: true,
        releasedAt: true,
        createdById: true,
        offering: { select: { teacherId: true } },
      },
    })

    if (!assessment || !teacherOwnsAssessment(assessment, staffId)) {
      return { kind: "not-found" as const }
    }

    if (assessment.releasedAt) {
      return {
        kind: "already-released" as const,
        assessmentId: assessment.id,
        releasedAt: assessment.releasedAt,
      }
    }

    // Only a row that is still unreleased is stamped, so two concurrent releases
    // cannot disagree about the instant.
    const written = await tx.assessment.updateMany({
      where: { id: assessment.id, releasedAt: null },
      data: { releasedAt: now },
    })

    if (written.count === 0) {
      const current = await tx.assessment.findUniqueOrThrow({
        where: { id: assessment.id },
        select: { releasedAt: true },
      })
      return {
        kind: "already-released" as const,
        assessmentId: assessment.id,
        releasedAt: current.releasedAt ?? now,
      }
    }

    // Inside the transaction, so the audit row cannot be lost while the release
    // persists. `writeAuditLog` is the house convention for publish-like actions.
    await writeAuditLog(tx, {
      entityType: "Assessment",
      entityId: assessment.id,
      action: "assessment.released",
      actor: { id: actor.id, role: actor.role },
      after: { releasedAt: now.toISOString() },
    })

    return { kind: "released" as const, assessmentId: assessment.id, releasedAt: now }
  })
}
