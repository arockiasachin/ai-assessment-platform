import { describe, expect, it } from "vitest"

import {
  DEFAULT_INTERVENTION_THRESHOLDS,
  detectContributionImbalance,
  evaluateClassAverageAlert,
  evaluateInterventionAlerts,
  evaluatePendingReviewsAlert,
} from "@/lib/analytics"

const classAverage = {
  offeringId: "offering-1",
  assessmentId: "assessment-1",
  assessmentTitle: "Midterm quiz",
  average: 59.9,
  sampleSize: 12,
}

describe("class-average alert", () => {
  it("fires below the threshold and reports the evidence", () => {
    const alert = evaluateClassAverageAlert(classAverage)
    expect(alert?.type).toBe("class-average-below-threshold")
    expect(alert?.evidence.average).toBeCloseTo(59.9)
    expect(alert?.evidence.threshold).toBe(60)
    expect(alert?.relatedIds.assessmentId).toBe("assessment-1")
  })

  it("does NOT fire when the average is exactly on the boundary", () => {
    expect(evaluateClassAverageAlert({ ...classAverage, average: 60 })).toBeNull()
  })

  it("does NOT fire when the average is above the threshold", () => {
    expect(evaluateClassAverageAlert({ ...classAverage, average: 60.1 })).toBeNull()
  })

  it("does NOT fire below the minimum sample size", () => {
    expect(evaluateClassAverageAlert({ ...classAverage, average: 10, sampleSize: 4 })).toBeNull()
  })

  it("honours a configurable threshold", () => {
    const thresholds = { ...DEFAULT_INTERVENTION_THRESHOLDS, classAverageBelow: 70 }
    expect(evaluateClassAverageAlert({ ...classAverage, average: 65 }, thresholds)).not.toBeNull()
    expect(evaluateClassAverageAlert({ ...classAverage, average: 70 }, thresholds)).toBeNull()
  })
})

describe("contribution-imbalance alert", () => {
  const group = {
    offeringId: "offering-1",
    groupId: "group-1",
    groupName: "Alpha",
    members: [
      { studentId: "s1", fullName: "One", weight: 10, eventCount: 4 },
      { studentId: "s2", fullName: "Two", weight: 2, eventCount: 2 },
      { studentId: "s3", fullName: "Three", weight: 2, eventCount: 2 },
    ],
  }

  it("fires when one member holds an outsized share", () => {
    const alert = detectContributionImbalance(group)
    expect(alert?.type).toBe("contribution-imbalance")
    expect(alert?.evidence.share).toBeCloseTo(10 / 14)
    expect(alert?.relatedIds.groupId).toBe("group-1")
    expect(alert?.relatedIds.studentId).toBe("s1")
    expect(alert?.message).toMatch(/not a grade/i)
  })

  it("fires exactly at the configured share boundary", () => {
    const atBoundary = {
      ...group,
      members: [
        { studentId: "s1", fullName: "One", weight: 6, eventCount: 4 },
        { studentId: "s2", fullName: "Two", weight: 2, eventCount: 2 },
        { studentId: "s3", fullName: "Three", weight: 2, eventCount: 2 },
      ],
    }
    expect(detectContributionImbalance(atBoundary)).not.toBeNull()
  })

  it("does NOT fire just outside the boundary", () => {
    const justUnder = {
      ...group,
      members: [
        { studentId: "s1", fullName: "One", weight: 5.9, eventCount: 4 },
        { studentId: "s2", fullName: "Two", weight: 2.05, eventCount: 2 },
        { studentId: "s3", fullName: "Three", weight: 2.05, eventCount: 2 },
      ],
    }
    expect(detectContributionImbalance(justUnder)).toBeNull()
  })

  it("does NOT fire when the top member has too few events", () => {
    const tiny = {
      ...group,
      members: [
        { studentId: "s1", fullName: "One", weight: 10, eventCount: 2 },
        { studentId: "s2", fullName: "Two", weight: 1, eventCount: 2 },
      ],
    }
    expect(detectContributionImbalance(tiny)).toBeNull()
  })

  it("does NOT fire for a single-member group or a zero total", () => {
    expect(detectContributionImbalance({ ...group, members: [group.members[0]] })).toBeNull()
    expect(
      detectContributionImbalance({
        ...group,
        members: group.members.map((member) => ({ ...member, weight: 0 })),
      }),
    ).toBeNull()
  })
})

describe("pending-reviews alert", () => {
  it("fires at the configured count and not one below", () => {
    const thresholds = { ...DEFAULT_INTERVENTION_THRESHOLDS, pendingReviewsAtLeast: 3 }
    expect(
      evaluatePendingReviewsAlert({ offeringId: "offering-1", pendingCount: 2 }, thresholds),
    ).toBeNull()
    expect(
      evaluatePendingReviewsAlert({ offeringId: "offering-1", pendingCount: 3 }, thresholds),
    ).not.toBeNull()
  })

  it("never fires on an empty queue", () => {
    expect(evaluatePendingReviewsAlert({ offeringId: "offering-1", pendingCount: 0 })).toBeNull()
  })
})

describe("composed interventions", () => {
  it("returns only firing alerts, most severe first", () => {
    const alerts = evaluateInterventionAlerts({
      classAverages: [
        { ...classAverage, average: 20, sampleSize: 20 }, // critical
        { ...classAverage, assessmentId: "a-2", average: 58, sampleSize: 20 }, // warning
        { ...classAverage, assessmentId: "a-3", average: 90, sampleSize: 20 }, // none
      ],
      pendingReviews: { offeringId: "offering-1", pendingCount: 1 },
    })
    expect(alerts.map((alert) => alert.severity)).toEqual(["critical", "warning", "warning"])
    expect(alerts.some((alert) => alert.relatedIds.assessmentId === "a-3")).toBe(false)
  })
})
