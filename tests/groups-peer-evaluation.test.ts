import { afterAll, beforeEach, describe, expect, it } from "vitest"

import type { AuthUser } from "@/lib/session"
import type { PeerEvaluationRatings } from "@/lib/groups/dimensions"
import {
  createGroupForTeacher,
  createMilestoneForTeacher,
  formTeamsForTeacher,
  getOfferingAnalysisForTeacher,
  getPeerEvaluationWorkspaceForStudent,
  listGroupsForTeacher,
  recordContributionEventsForTeacher,
  submitPeerEvaluationsForStudent,
  updateMilestoneForTeacher,
} from "@/lib/groups"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import {
  createGroupWithMembers,
  createGroupsFixture,
  studentSession,
  teacherSession,
  type GroupsStudent,
} from "./fixtures/groups"

function ratingsFor(value: number): PeerEvaluationRatings {
  return {
    contributing: value,
    interacting: value,
    keepingOnTrack: value,
    expectingQuality: value,
    knowledgeSkillsAbilities: value,
  }
}

async function submitGroupEvaluations(
  students: GroupsStudent[],
  groupId: string,
  raterIndices: number[],
  scoreFor: (raterIndex: number, evaluateeIndex: number) => number,
) {
  for (const raterIndex of raterIndices) {
    const evaluations = students.map((target, evaluateeIndex) => ({
      evaluateeId: target.profileId,
      ratings: ratingsFor(scoreFor(raterIndex, evaluateeIndex)),
    }))
    await submitPeerEvaluationsForStudent(studentSession(students[raterIndex]), {
      groupId,
      evaluations,
      submit: true,
    })
  }
}

async function createOtherTeacher(): Promise<AuthUser> {
  const user = await prisma.user.create({
    data: {
      email: "other-groups-teacher@test.local",
      passwordHash: "test-only-not-a-real-hash",
      role: "TEACHER",
      staffProfile: { create: { fullName: "Olive Other", empId: "EMP-GROUPS-OTHER" } },
    },
  })
  return { id: user.id, email: user.email, role: "teacher" }
}

describe("groups peer evaluation pipeline", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("forms teams with the maximin objective and persists the formation provenance", async () => {
    const fixture = await createGroupsFixture(prisma)
    const teacher = teacherSession(fixture)
    const byId = new Map(fixture.students.map((student) => [student.profileId, student]))

    const outcome = await formTeamsForTeacher(teacher, {
      offeringId: fixture.offering.id,
      criteria: [
        { id: "gpa", label: "GPA balance", kind: "numeric-balance", weight: 1, attribute: "gpa" },
      ],
      students: fixture.students.map((student, index) => ({
        studentId: student.profileId,
        attributes: { gpa: index + 1 },
      })),
      teamCount: 2,
      persist: true,
    })

    expect(outcome.formation.teams).toHaveLength(2)
    expect(outcome.formation.objective).toBeCloseTo(1, 5)
    expect(outcome.persistedGroupIds).toHaveLength(2)

    const groups = await listGroupsForTeacher(teacher, fixture.offering.id)
    expect(groups).toHaveLength(2)
    for (const group of groups) {
      expect(group.members.length).toBeGreaterThan(0)
    }

    const stored = await prisma.group.findMany({
      where: { offeringId: fixture.offering.id },
      include: { members: true },
    })
    const metadata = stored[0].metadata as { formation?: { objective?: number } }
    expect(metadata.formation?.objective).toBeCloseTo(1, 5)
    const memberIds = stored.flatMap((group) => group.members.map((member) => member.studentId))
    expect(new Set(memberIds).size).toBe(fixture.students.length)
    expect(memberIds.every((id) => byId.has(id))).toBe(true)
  })

  it("keeps received ratings confidential and withholds small samples", async () => {
    const fixture = await createGroupsFixture(prisma, { studentCount: 5 })
    const teacher = teacherSession(fixture)
    const four = fixture.students.slice(0, 4)
    const outsider = fixture.students[4]
    const group = await createGroupWithMembers(
      prisma,
      fixture.offering.id,
      "Alpha",
      four.map((student) => student.profileId),
    )
    const otherGroup = await createGroupWithMembers(prisma, fixture.offering.id, "Beta", [
      outsider.profileId,
    ])

    // Rater 0 rates everyone a 5; the other three rate rater 0 a 2.
    const scoreFor = (raterIndex: number, evaluateeIndex: number) =>
      raterIndex !== 0 && evaluateeIndex === 0 ? 2 : 5

    // Only the first two students submit, so the low member has one rater.
    await submitGroupEvaluations(four, group.id, [0, 1], scoreFor)
    const partial = await getPeerEvaluationWorkspaceForStudent(studentSession(four[0]))
    const partialGroup = partial.find((entry) => entry.groupId === group.id)!
    expect(partialGroup.received.withheld).toBe(true)
    if (partialGroup.received.withheld) {
      expect(partialGroup.received.ratingCount).toBe(1)
      expect(partialGroup.received.minRatersRequired).toBe(3)
    }

    await submitGroupEvaluations(four, group.id, [2, 3], scoreFor)

    const workspace = await getPeerEvaluationWorkspaceForStudent(studentSession(four[0]))
    const entry = workspace.find((value) => value.groupId === group.id)!
    expect(entry.received.withheld).toBe(false)
    if (!entry.received.withheld) {
      expect(entry.received.ratingCount).toBe(3)
      expect(entry.received.dimensionAverages.contributing).toBeCloseTo(2)
      expect(entry.received.overallAverage).toBeCloseTo(2)
    }

    // The received block carries no rater identity and no received comment.
    const serializedReceived = JSON.stringify(entry.received)
    for (const peer of four.slice(1)) {
      expect(serializedReceived).not.toContain(peer.profileId)
      expect(serializedReceived).not.toContain(peer.fullName)
    }
    expect(serializedReceived).not.toContain("evaluator")
    expect(serializedReceived).not.toContain("comments")

    // A student outside the group cannot see it, and sees only their own group.
    const outsiderWorkspace = await getPeerEvaluationWorkspaceForStudent(studentSession(outsider))
    expect(outsiderWorkspace.map((value) => value.groupId)).toEqual([otherGroup.id])
    await expect(
      submitPeerEvaluationsForStudent(studentSession(outsider), {
        groupId: group.id,
        evaluations: [
          {
            evaluateeId: outsider.profileId,
            ratings: ratingsFor(4),
          },
        ],
      }),
    ).rejects.toMatchObject({ status: 403 })

    // Ratings cast for a non-member are rejected outright.
    await expect(
      submitPeerEvaluationsForStudent(studentSession(four[0]), {
        groupId: group.id,
        evaluations: four
          .map((student) => ({ evaluateeId: student.profileId, ratings: ratingsFor(4) }))
          .concat([{ evaluateeId: outsider.profileId, ratings: ratingsFor(4) }]),
      }),
    ).rejects.toMatchObject({ status: 400 })

    // The adjustment factors are persisted on the roster.
    const members = await prisma.groupMember.findMany({ where: { groupId: group.id } })
    const low = members.find((member) => member.studentId === four[0].profileId)
    expect(low?.adjustmentFactor).not.toBeNull()
    expect(low?.selfAdjustmentFactor).not.toBeNull()
    expect(low?.adjustmentFactor ?? 1).toBeLessThan(1)

    expect(teacher).toBeDefined()
  })

  it("presents contribution as evidence and never as the sole grade basis", async () => {
    const fixture = await createGroupsFixture(prisma)
    const teacher = teacherSession(fixture)
    const group = await createGroupWithMembers(
      prisma,
      fixture.offering.id,
      "Alpha",
      fixture.students.map((student) => student.profileId),
    )
    // Everyone rates everyone identically: peer adjustment factors are all 1.
    await submitGroupEvaluations(fixture.students, group.id, [0, 1, 2, 3], () => 4)

    const [active, idle] = fixture.students
    await recordContributionEventsForTeacher(teacher, {
      groupId: group.id,
      events: [active.profileId, active.profileId, active.profileId].map(() => ({
        studentId: active.profileId,
        type: "COMMIT" as const,
        weight: 4,
        occurredAt: new Date().toISOString(),
        summary: "commit",
      })),
    })
    // `idle` records nothing at all.

    const analysisEnvelope = await getOfferingAnalysisForTeacher(teacher, {
      offeringId: fixture.offering.id,
      groupGrade: 100,
    })
    const entry = analysisEnvelope.groups.find((value) => value.analysis.groupId === group.id)!
    expect(entry.contributionEvidence.gradeBasis).toBe(false)
    expect(entry.contributionEvidence.evidenceOnly).toBe(true)
    expect(entry.contributionEvidence.notice).toMatch(/must never be the sole basis/i)

    const idleSignal = entry.analysis.freeRiders.find(
      (signal) => signal.studentId === idle.profileId,
    )!
    expect(idleSignal.contributionSignal).toBe(true)
    expect(idleSignal.flagged).toBe(false)
    expect(idleSignal.evidenceOnly).toBe(true)
    expect(idleSignal.reasons.some((reason) => reason.includes("Evidence only"))).toBe(true)

    // The suggested individual grade ignores contribution entirely.
    const idleSuggestion = entry.suggestedIndividualGrades!.find(
      (suggestion) => suggestion.studentId === idle.profileId,
    )!
    expect(idleSuggestion.factor).toBeCloseTo(1, 6)
    expect(idleSuggestion.individualGrade).toBeCloseTo(100, 2)
    const activeSuggestion = entry.suggestedIndividualGrades!.find(
      (suggestion) => suggestion.studentId === active.profileId,
    )!
    expect(activeSuggestion.individualGrade).toBeCloseTo(idleSuggestion.individualGrade, 2)
  })

  it("timestamps milestone completion and surfaces overdue teams", async () => {
    const fixture = await createGroupsFixture(prisma)
    const teacher = teacherSession(fixture)
    const group = await createGroupWithMembers(
      prisma,
      fixture.offering.id,
      "Alpha",
      fixture.students.map((student) => student.profileId),
    )
    const onTrack = await createMilestoneForTeacher(teacher, {
      groupId: group.id,
      title: "Proposal",
      dueDate: "2026-12-01",
    })
    const overdue = await createMilestoneForTeacher(teacher, {
      groupId: group.id,
      title: "Late deliverable",
      dueDate: "2026-01-01",
    })

    const completed = await updateMilestoneForTeacher(teacher, onTrack.id, { status: "COMPLETED" })
    expect(completed.status).toBe("COMPLETED")
    expect(completed.completedAt).not.toBeNull()

    const reopened = await updateMilestoneForTeacher(teacher, onTrack.id, { status: "IN_PROGRESS" })
    expect(reopened.completedAt).toBeNull()

    const analysis = await getOfferingAnalysisForTeacher(teacher, {
      offeringId: fixture.offering.id,
    })
    const entry = analysis.groups.find((value) => value.analysis.groupId === group.id)!
    expect(entry.analysis.milestoneProgress.overdue).toBe(1)
    expect(entry.analysis.milestoneProgress.behind).toBe(true)
    expect(overdue.status).toBe("PLANNED")
  })

  it("keeps instructors scoped to their own offerings and students out of teacher APIs", async () => {
    const fixture = await createGroupsFixture(prisma)
    const teacher = teacherSession(fixture)
    await createGroupForTeacher(teacher, {
      offeringId: fixture.offering.id,
      name: "Alpha",
      studentIds: fixture.students.map((student) => student.profileId),
    })

    const otherTeacher = await createOtherTeacher()
    await expect(listGroupsForTeacher(otherTeacher, fixture.offering.id)).rejects.toMatchObject({
      status: 403,
    })
    await expect(
      getOfferingAnalysisForTeacher(otherTeacher, { offeringId: fixture.offering.id }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      createGroupForTeacher(otherTeacher, {
        offeringId: fixture.offering.id,
        name: "Intruder",
        studentIds: [fixture.students[0].profileId],
      }),
    ).rejects.toMatchObject({ status: 403 })

    await expect(listGroupsForTeacher(studentSession(fixture.students[0]))).rejects.toMatchObject({
      status: 403,
    })
  })
})
