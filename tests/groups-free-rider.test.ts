import { describe, expect, it } from "vitest"

import type { MemberAdjustment } from "@/lib/groups/adjustment"
import { detectFreeRiders } from "@/lib/groups/free-rider"
import { analyzeCohortProgress, summarizeMilestones } from "@/lib/groups/milestones"
import type { PeerEvaluationDimensionKey } from "@/lib/groups/dimensions"

const DIMENSION_ZERO: Record<PeerEvaluationDimensionKey, number> = {
  contributing: 1,
  interacting: 1,
  keepingOnTrack: 1,
  expectingQuality: 1,
  knowledgeSkillsAbilities: 1,
}

function adjustment(
  studentId: string,
  receivedAverage: number,
  ratingCount: number,
): MemberAdjustment {
  return {
    studentId,
    receivedAverage,
    teamAverage: null,
    adjustmentFactor: 1,
    dimensionFactors: { ...DIMENSION_ZERO },
    ratingCount,
    includesSelf: false,
    insufficientRatings: false,
  }
}

describe("detectFreeRiders", () => {
  it("flags a member whose peer ratings are well below the team norm", () => {
    const signals = detectFreeRiders({
      memberIds: ["A", "B", "C", "D"],
      adjustments: [
        adjustment("A", 4.5, 3),
        adjustment("B", 4.5, 3),
        adjustment("C", 4.5, 3),
        adjustment("D", 2, 3),
      ],
    })
    const low = signals.find((signal) => signal.studentId === "D")
    expect(low?.ratingSignal).toBe(true)
    expect(low?.flagged).toBe(true)
    expect(low?.severity).toBe("at-risk")
    expect(low?.evidenceOnly).toBe(false)
    expect(low?.reasons.some((reason) => reason.includes("below the team norm"))).toBe(true)
    expect(signals.find((signal) => signal.studentId === "A")?.flagged).toBe(false)
  })

  it("never flags on contribution data alone (contribution is evidence only)", () => {
    const signals = detectFreeRiders({
      memberIds: ["A", "B", "C"],
      adjustments: [adjustment("A", 4, 2), adjustment("B", 4, 2), adjustment("C", 4, 2)],
      contributions: [
        { studentId: "A", type: "COMMIT", weight: 5, occurredAt: new Date() },
        { studentId: "A", type: "COMMIT", weight: 5, occurredAt: new Date() },
        { studentId: "B", type: "COMMIT", weight: 5, occurredAt: new Date() },
        { studentId: "B", type: "COMMIT", weight: 5, occurredAt: new Date() },
      ],
    })
    const idle = signals.find((signal) => signal.studentId === "C")
    expect(idle?.contributionSignal).toBe(true)
    expect(idle?.flagged).toBe(false)
    expect(idle?.evidenceOnly).toBe(true)
    expect(idle?.severity).toBe("none")
    expect(idle?.reasons.some((reason) => reason.includes("Evidence only"))).toBe(true)
  })

  it("tracks survey completion", () => {
    const signals = detectFreeRiders({
      memberIds: ["A", "B", "C"],
      adjustments: [adjustment("A", 4, 2), adjustment("B", 4, 2), adjustment("C", 4, 2)],
      expectedEvaluationsPerMember: 3,
      submittedEvaluations: [{ evaluatorId: "A" }, { evaluatorId: "A" }, { evaluatorId: "B" }],
    })
    const a = signals.find((signal) => signal.studentId === "A")
    expect(a?.submittedEvaluations).toBe(2)
    expect(a?.completionRate).toBeCloseTo(2 / 3)
    expect(a?.surveyIncomplete).toBe(true)
    expect(signals.find((signal) => signal.studentId === "C")?.surveyIncomplete).toBe(true)
  })

  it("requires a minimum number of raters before a rating signal can fire", () => {
    const signals = detectFreeRiders({
      memberIds: ["A", "B"],
      adjustments: [adjustment("A", 5, 2), adjustment("B", 1, 1)],
      thresholds: { minRaters: 2 },
    })
    expect(signals.find((signal) => signal.studentId === "B")?.flagged).toBe(false)
  })
})

describe("summarizeMilestones", () => {
  const now = new Date("2026-09-11T00:00:00.000Z")

  it("weights completion and detects overdue work", () => {
    const progress = summarizeMilestones(
      [
        { status: "COMPLETED", weight: 3, dueDate: "2026-09-01", completedAt: "2026-08-30" },
        { status: "IN_PROGRESS", weight: 1, dueDate: "2026-10-01", completedAt: null },
        { status: "PLANNED", weight: 1, dueDate: "2026-09-01", completedAt: null },
      ],
      now,
    )
    expect(progress.total).toBe(3)
    expect(progress.completed).toBe(1)
    expect(progress.weightedCompletion).toBeCloseTo(3 / 5)
    expect(progress.overdue).toBe(1)
    expect(progress.behind).toBe(true)
  })

  it("reports a team with no overdue milestones as on track", () => {
    const progress = summarizeMilestones(
      [
        { status: "COMPLETED", weight: 1, dueDate: "2026-09-01", completedAt: "2026-09-01" },
        { status: "IN_PROGRESS", weight: 1, dueDate: "2026-10-01", completedAt: null },
      ],
      now,
    )
    expect(progress.overdue).toBe(0)
    expect(progress.behind).toBe(false)
    expect(progress.weightedCompletion).toBeCloseTo(0.5)
  })

  it("flags a group that is materially behind the cohort", () => {
    const completed = {
      status: "COMPLETED",
      weight: 1,
      dueDate: "2026-09-01",
      completedAt: "2026-09-01",
    }
    const open = { status: "IN_PROGRESS", weight: 1, dueDate: "2026-10-01", completedAt: null }
    const groups = analyzeCohortProgress(
      [
        { groupId: "g1", milestones: [completed, completed, completed] },
        { groupId: "g2", milestones: [completed, completed, completed] },
        { groupId: "g3", milestones: [open, open, open] },
      ],
      now,
    )
    expect(groups.find((group) => group.groupId === "g3")?.behind).toBe(true)
    expect(groups.find((group) => group.groupId === "g3")?.lopsided).toBe(true)
    expect(groups.find((group) => group.groupId === "g1")?.behind).toBe(false)
  })
})
