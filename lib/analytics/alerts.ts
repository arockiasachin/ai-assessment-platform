/**
 * Intervention alerts for the owning teacher.
 *
 * Thresholds are configurable per request (the frozen schema has no
 * offering-level settings column, so the API accepts overrides and falls back
 * to `DEFAULT_INTERVENTION_THRESHOLDS`). Each rule fires on a strict boundary
 * and is silent exactly at the boundary, which the tests pin down:
 *
 * - class average fires when `average < classAverageBelow` (equal does not fire);
 * - contribution imbalance fires when `share >= contributionShareAtLeast`;
 * - pending reviews fire when `pendingCount >= pendingReviewsAtLeast`.
 *
 * Every alert carries the numbers it was derived from in `evidence`, so the UI
 * never has to re-derive or guess why it fired.
 */

export type InterventionThresholds = {
  /** Fire when an assessment's cohort average is strictly below this. */
  classAverageBelow: number
  /** Do not alert on a class average computed from fewer finalized attempts. */
  minClassSampleSize: number
  /** Fire when one member's share of weighted contribution is at least this. */
  contributionShareAtLeast: number
  /** A member needs at least this many events before an imbalance can fire. */
  minContributionEvents: number
  /** Fire when the offering's pending/needs-review queue reaches this size. */
  pendingReviewsAtLeast: number
}

export const DEFAULT_INTERVENTION_THRESHOLDS: InterventionThresholds = {
  classAverageBelow: 60,
  minClassSampleSize: 5,
  contributionShareAtLeast: 0.6,
  minContributionEvents: 3,
  pendingReviewsAtLeast: 1,
}

export type InterventionAlertType =
  "class-average-below-threshold" | "contribution-imbalance" | "pending-reviews"

export type InterventionAlertSeverity = "info" | "warning" | "critical"

export type InterventionAlert = {
  type: InterventionAlertType
  severity: InterventionAlertSeverity
  title: string
  message: string
  evidence: Record<string, unknown>
  relatedIds: {
    offeringId: string | null
    assessmentId: string | null
    groupId: string | null
    studentId: string | null
  }
}

export type ClassAverageAlertInput = {
  offeringId: string
  assessmentId: string
  assessmentTitle: string
  average: number | null
  sampleSize: number
}

export type ContributionMemberInput = {
  studentId: string
  fullName: string
  /** Summed contribution weight for this member. */
  weight: number
  /** Number of contribution events attributed to this member. */
  eventCount: number
}

export type ContributionImbalanceInput = {
  offeringId: string
  groupId: string
  groupName: string
  members: readonly ContributionMemberInput[]
}

export type PendingReviewsAlertInput = {
  offeringId: string
  pendingCount: number
}

function severityForClassAverage(average: number, threshold: number): InterventionAlertSeverity {
  // More than 15 points under the threshold is an emergency, not a warning.
  return average <= threshold - 15 ? "critical" : "warning"
}

export function evaluateClassAverageAlert(
  input: ClassAverageAlertInput,
  thresholds: InterventionThresholds = DEFAULT_INTERVENTION_THRESHOLDS,
): InterventionAlert | null {
  if (input.average === null) return null
  if (input.sampleSize < thresholds.minClassSampleSize) return null
  if (!(input.average < thresholds.classAverageBelow)) return null

  return {
    type: "class-average-below-threshold",
    severity: severityForClassAverage(input.average, thresholds.classAverageBelow),
    title: `Class average below ${thresholds.classAverageBelow}% on "${input.assessmentTitle}"`,
    message: `The cohort average is ${input.average.toFixed(1)}% across ${input.sampleSize} finalized attempt(s), below the configured ${thresholds.classAverageBelow}% floor.`,
    evidence: {
      average: input.average,
      sampleSize: input.sampleSize,
      threshold: thresholds.classAverageBelow,
    },
    relatedIds: {
      offeringId: input.offeringId,
      assessmentId: input.assessmentId,
      groupId: null,
      studentId: null,
    },
  }
}

export function detectContributionImbalance(
  input: ContributionImbalanceInput,
  thresholds: InterventionThresholds = DEFAULT_INTERVENTION_THRESHOLDS,
): InterventionAlert | null {
  if (input.members.length < 2) return null
  const totalWeight = input.members.reduce(
    (sum, member) => sum + (Number.isFinite(member.weight) ? member.weight : 0),
    0,
  )
  if (totalWeight <= 0) return null

  const [top] = [...input.members].sort((left, right) => {
    if (right.weight !== left.weight) return right.weight - left.weight
    return left.studentId.localeCompare(right.studentId)
  })
  if (!top || top.eventCount < thresholds.minContributionEvents) return null

  const share = top.weight / totalWeight
  if (!(share >= thresholds.contributionShareAtLeast)) return null

  return {
    type: "contribution-imbalance",
    severity: share >= 0.8 ? "critical" : "warning",
    title: `Uneven contribution in "${input.groupName}"`,
    message: `${top.fullName} accounts for ${(share * 100).toFixed(0)}% of the group's recorded contribution weight. Contribution is secondary evidence, not a grade.`,
    evidence: {
      studentId: top.studentId,
      fullName: top.fullName,
      memberWeight: top.weight,
      totalWeight,
      share,
      memberCount: input.members.length,
      threshold: thresholds.contributionShareAtLeast,
    },
    relatedIds: {
      offeringId: input.offeringId,
      assessmentId: null,
      groupId: input.groupId,
      studentId: top.studentId,
    },
  }
}

export function evaluatePendingReviewsAlert(
  input: PendingReviewsAlertInput,
  thresholds: InterventionThresholds = DEFAULT_INTERVENTION_THRESHOLDS,
): InterventionAlert | null {
  if (input.pendingCount <= 0) return null
  if (!(input.pendingCount >= thresholds.pendingReviewsAtLeast)) return null

  return {
    type: "pending-reviews",
    severity: input.pendingCount >= 10 ? "critical" : "warning",
    title: "Review queue needs attention",
    message: `${input.pendingCount} submission(s) are pending or need review.`,
    evidence: {
      pendingCount: input.pendingCount,
      threshold: thresholds.pendingReviewsAtLeast,
    },
    relatedIds: {
      offeringId: input.offeringId,
      assessmentId: null,
      groupId: null,
      studentId: null,
    },
  }
}

export type InterventionAlertInput = {
  classAverages?: readonly ClassAverageAlertInput[]
  contributionGroups?: readonly ContributionImbalanceInput[]
  pendingReviews?: PendingReviewsAlertInput
}

const SEVERITY_ORDER: Record<InterventionAlertSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
}

/** Compose every rule, dropping the ones that do not fire, most severe first. */
export function evaluateInterventionAlerts(
  input: InterventionAlertInput,
  overrides: Partial<InterventionThresholds> = {},
): InterventionAlert[] {
  const thresholds = { ...DEFAULT_INTERVENTION_THRESHOLDS, ...overrides }
  const alerts: InterventionAlert[] = []

  for (const classAverage of input.classAverages ?? []) {
    const alert = evaluateClassAverageAlert(classAverage, thresholds)
    if (alert) alerts.push(alert)
  }
  for (const group of input.contributionGroups ?? []) {
    const alert = detectContributionImbalance(group, thresholds)
    if (alert) alerts.push(alert)
  }
  if (input.pendingReviews) {
    const alert = evaluatePendingReviewsAlert(input.pendingReviews, thresholds)
    if (alert) alerts.push(alert)
  }

  return alerts.sort((left, right) => {
    const bySeverity = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
    if (bySeverity !== 0) return bySeverity
    return left.type.localeCompare(right.type)
  })
}
