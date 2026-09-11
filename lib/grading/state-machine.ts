import type { GradeReviewStatus } from "@/lib/generated/prisma/enums"

/**
 * The grade review state machine.
 *
 * `GradeReviewStatus` values (from the frozen schema) and their meaning here:
 *
 * - `PENDING`       — AI suggestions exist, no human decision yet. Nothing published.
 * - `NEEDS_REVIEW`  — a human flagged the submission for closer review. Nothing published.
 * - `AUTO_ACCEPTED` — a human accepted the AI suggestion *as-is*. Published.
 * - `OVERRIDDEN`    — a human replaced the AI score with their own. Published.
 * - `REJECTED`      — a human rejected the suggestion. Nothing published.
 *
 * `AUTO_ACCEPTED` deliberately does **not** mean "the machine accepted it": the
 * product rule is that a teacher approves every grade, so only the `accept` and
 * `override` human actions publish, and both are recorded in `AuditLog`.
 */

export type ReviewAction = "accept" | "override" | "reject" | "flag" | "reopen"

const TRANSITIONS: Record<GradeReviewStatus, readonly GradeReviewStatus[]> = {
  PENDING: ["AUTO_ACCEPTED", "NEEDS_REVIEW", "OVERRIDDEN", "REJECTED"],
  NEEDS_REVIEW: ["AUTO_ACCEPTED", "OVERRIDDEN", "REJECTED"],
  // Published states may only be re-overridden (a corrected published score).
  AUTO_ACCEPTED: ["OVERRIDDEN"],
  OVERRIDDEN: ["OVERRIDDEN"],
  // A rejected suggestion can be re-opened if the model is re-run.
  REJECTED: ["PENDING"],
}

export const REVIEW_ACTION_TARGET: Record<ReviewAction, GradeReviewStatus> = {
  accept: "AUTO_ACCEPTED",
  override: "OVERRIDDEN",
  reject: "REJECTED",
  flag: "NEEDS_REVIEW",
  reopen: "PENDING",
}

/** Statuses under which a grade row is published and visible. */
export const PUBLISHING_STATUSES: readonly GradeReviewStatus[] = ["AUTO_ACCEPTED", "OVERRIDDEN"]

export class IllegalGradeReviewTransitionError extends Error {
  constructor(
    readonly from: GradeReviewStatus,
    readonly to: GradeReviewStatus,
  ) {
    super(`Illegal grade review transition: ${from} -> ${to}.`)
    this.name = "IllegalGradeReviewTransitionError"
  }
}

export function canTransition(from: GradeReviewStatus, to: GradeReviewStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

/** Map a human action to the resulting status, rejecting illegal transitions. */
export function resolveTransition(
  from: GradeReviewStatus,
  action: ReviewAction,
): GradeReviewStatus {
  const to = REVIEW_ACTION_TARGET[action]
  if (!canTransition(from, to)) {
    throw new IllegalGradeReviewTransitionError(from, to)
  }
  return to
}

export function publishesGrade(status: GradeReviewStatus): boolean {
  return PUBLISHING_STATUSES.includes(status)
}

export function isPublishingAction(action: ReviewAction): boolean {
  return action === "accept" || action === "override"
}
