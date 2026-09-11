import type { Prisma } from "@/lib/generated/prisma/client"
import { writeAuditLog, type AuditActor } from "@/lib/grading/audit"
import { publishesGrade, resolveTransition } from "@/lib/grading/state-machine"
import { prisma } from "@/lib/prisma"
import type { GradeReviewResponse } from "@/lib/contracts/grading"

import { RubricGradingError } from "./errors"
import { serializeReview } from "./serialize"

/**
 * Move a submission to `NEEDS_REVIEW` after the model flagged it.
 *
 * The transition runs in the same transaction as its `AuditLog` row, and it
 * respects the state machine: a submission whose grade is already published is
 * never moved, because published grades are immutable and can only change
 * through a human `override`. The reasons are appended to `decisionsJson` so the
 * review queue can show why the model asked for a human.
 */

function appendFlagEntry(
  existing: Prisma.JsonValue,
  reasons: readonly string[],
): Prisma.InputJsonValue {
  const list = Array.isArray(existing) ? existing : []
  const entry = {
    kind: "ai_flag",
    reasons: [...reasons],
    at: new Date().toISOString(),
  }
  return [...list, entry] as unknown as Prisma.InputJsonValue
}

export type FlagReviewInput = {
  assessmentId: string
  studentId: string
  reasons: readonly string[]
  actor: AuditActor
}

export async function flagReviewForAi(input: FlagReviewInput): Promise<GradeReviewResponse> {
  return prisma.$transaction(async (tx) => {
    const review = await tx.gradeReview.findUnique({
      where: {
        assessmentId_studentId: {
          assessmentId: input.assessmentId,
          studentId: input.studentId,
        },
      },
    })
    if (!review) throw new RubricGradingError(404, "Grade review not found.")

    if (publishesGrade(review.status)) {
      // The grade is already human-approved. A later model flag is recorded but
      // must not change the review status or the published grade.
      await writeAuditLog(tx, {
        entityType: "GradeReview",
        entityId: review.id,
        action: "grade_review.ai_flag_skipped_published",
        actor: input.actor,
        after: { status: review.status },
        metadata: { reasons: [...input.reasons] },
      })
      return serializeReview(review)
    }

    const nextStatus =
      review.status === "NEEDS_REVIEW" ? review.status : resolveTransition(review.status, "flag")

    const updated = await tx.gradeReview.update({
      where: { id: review.id },
      data: {
        status: nextStatus,
        decisionsJson: appendFlagEntry(review.decisionsJson, input.reasons),
      },
    })

    await writeAuditLog(tx, {
      entityType: "GradeReview",
      entityId: review.id,
      action: "grade_review.ai_flagged",
      actor: input.actor,
      before: { status: review.status },
      after: { status: nextStatus },
      metadata: { reasons: [...input.reasons] },
    })

    return serializeReview(updated)
  })
}
