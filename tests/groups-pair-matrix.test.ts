import { afterAll, beforeEach, describe, expect, it } from "vitest"

import {
  createGroupForTeacher,
  getOfferingAnalysisForTeacher,
  getPeerEvaluationWorkspaceForStudent,
  serializeGroupAnalysis,
  submitPeerEvaluationsForStudent,
} from "@/lib/groups"
import type { PeerEvaluationRatings } from "@/lib/groups/dimensions"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import {
  createGroupsFixture,
  studentSession,
  teacherSession,
  type GroupsStudent,
} from "./fixtures/groups"

/**
 * D6 — a teacher may see the evaluator↔evaluatee pair matrix
 * (`docs/plans/wave-1.md` §4).
 *
 * The confidentiality boundaries this file pins:
 *
 *  - the teacher payload names both sides of every rating, per dimension;
 *  - a draft contributes a status but no values and no timestamp;
 *  - the student's `received` aggregate stays identity-free — it must never carry
 *    a rater id, a rater name, or the pair matrix itself.
 */

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
  raterIndex: number,
  value: number,
  submit: boolean,
) {
  await submitPeerEvaluationsForStudent(studentSession(students[raterIndex]), {
    groupId,
    evaluations: students.map((target) => ({
      evaluateeId: target.profileId,
      ratings: ratingsFor(value),
    })),
    submit,
  })
}

describe("teacher peer-evaluation pair matrix (D6)", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("names both sides of every submitted rating and hides draft values", async () => {
    const fixture = await createGroupsFixture(prisma, { studentCount: 4 })
    const teacher = teacherSession(fixture)
    const [rater0, , rater2, rater3] = fixture.students
    const group = await createGroupForTeacher(teacher, {
      offeringId: fixture.offering.id,
      name: "Alpha",
      studentIds: fixture.students.map((student) => student.profileId),
    })

    await submitGroupEvaluations(fixture.students, group.id, 0, 5, true)
    await submitGroupEvaluations(fixture.students, group.id, 1, 3, true)
    await submitGroupEvaluations(fixture.students, group.id, 2, 4, false)

    const envelope = await getOfferingAnalysisForTeacher(teacher, {
      offeringId: fixture.offering.id,
    })
    const entry = envelope.groups.find((row) => row.analysis.groupId === group.id)!
    const pairs = entry.peerEvaluationPairs

    // Three raters wrote four rows each (every member, including themselves).
    expect(pairs).toHaveLength(12)
    // The analysis still counts only the eight submitted rows.
    expect(entry.analysis.submittedEvaluationCount).toBe(8)
    expect(pairs.filter((pair) => pair.evaluatorId === rater3.profileId)).toHaveLength(0)

    // A submitted pair carries values, names and a timestamp.
    const submittedPair = pairs.find(
      (pair) => pair.evaluatorId === rater0.profileId && pair.evaluateeId === rater0.profileId,
    )!
    expect(submittedPair.status).toBe("SUBMITTED")
    expect(submittedPair.evaluatorName).toBe(rater0.fullName)
    expect(submittedPair.evaluateeName).toBe(rater0.fullName)
    expect(submittedPair.ratings?.contributing).toBe(5)
    expect(submittedPair.ratings?.knowledgeSkillsAbilities).toBe(5)
    expect(submittedPair.submittedAt).not.toBeNull()

    // A draft is visible as a pair (who has not finished) but leaks no values.
    const draftPair = pairs.find(
      (pair) => pair.evaluatorId === rater2.profileId && pair.evaluateeId === rater3.profileId,
    )!
    expect(draftPair.status).toBe("DRAFT")
    expect(draftPair.ratings).toBeNull()
    expect(draftPair.submittedAt).toBeNull()
    expect(draftPair.evaluatorName).toBe(rater2.fullName)
    expect(draftPair.evaluateeName).toBe(rater3.fullName)

    const names = new Set(fixture.students.map((student) => student.fullName))
    for (const pair of pairs) {
      expect(names.has(pair.evaluatorName)).toBe(true)
      expect(names.has(pair.evaluateeName)).toBe(true)
    }

    // The API projection carries the same matrix forward.
    const serialized = serializeGroupAnalysis(
      entry.analysis,
      entry.contributionEvidence,
      entry.suggestedIndividualGrades,
      entry.peerEvaluationPairs,
    )
    expect(serialized.peerEvaluationPairs).toHaveLength(12)
  })

  it("keeps the student payload free of rater identity and of the matrix", async () => {
    const fixture = await createGroupsFixture(prisma, { studentCount: 4 })
    const teacher = teacherSession(fixture)
    const group = await createGroupForTeacher(teacher, {
      offeringId: fixture.offering.id,
      name: "Alpha",
      studentIds: fixture.students.map((student) => student.profileId),
    })
    for (const raterIndex of [0, 1, 2]) {
      await submitGroupEvaluations(fixture.students, group.id, raterIndex, 4, true)
    }

    const workspace = await getPeerEvaluationWorkspaceForStudent(
      studentSession(fixture.students[0]),
    )
    const entry = workspace.find((row) => row.groupId === group.id)!
    expect(Object.keys(entry)).not.toContain("peerEvaluationPairs")

    const received = JSON.stringify(entry.received)
    for (const other of fixture.students.slice(1)) {
      expect(received).not.toContain(other.profileId)
      expect(received).not.toContain(other.fullName)
    }
    expect(received).not.toContain("evaluator")
    expect(received).not.toContain("comments")
  })
})
