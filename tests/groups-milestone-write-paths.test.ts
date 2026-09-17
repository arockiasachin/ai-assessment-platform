import { afterAll, beforeEach, describe, expect, it } from "vitest"

import {
  createGroupForTeacher,
  createMilestoneForTeacher,
  deleteMilestoneForTeacher,
  updateMilestoneForTeacher,
} from "@/lib/groups"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createGroupsFixture, teacherSession } from "./fixtures/groups"

/**
 * The groups write paths TN-49 added or repaired.
 *
 * The milestone API accepted a description, weight and due date from the start, but the UI
 * sent only a title, and there was no edit or delete. These assert the service paths the new
 * UI calls, and the offering-wide placement guard that keeps a student out of two teams.
 */

describe("milestone write paths (TN-49)", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("persists the description, weight and due date a milestone is created with", async () => {
    const fixture = await createGroupsFixture(prisma, { studentCount: 2 })
    const teacher = teacherSession(fixture)
    const group = await createGroupForTeacher(teacher, {
      offeringId: fixture.offering.id,
      name: "Alpha",
      studentIds: fixture.students.map((student) => student.profileId),
    })

    const milestone = await createMilestoneForTeacher(teacher, {
      groupId: group.id,
      title: "Proposal draft",
      description: "Outline the method and the dataset",
      weight: 2,
      dueDate: "2026-10-01",
    })

    expect(milestone).toMatchObject({
      title: "Proposal draft",
      description: "Outline the method and the dataset",
      weight: 2,
    })
    expect(milestone.dueDate).not.toBeNull()
  })

  it("edits a milestone, and an explicit null clears an optional field", async () => {
    const fixture = await createGroupsFixture(prisma, { studentCount: 2 })
    const teacher = teacherSession(fixture)
    const group = await createGroupForTeacher(teacher, {
      offeringId: fixture.offering.id,
      name: "Alpha",
      studentIds: fixture.students.map((student) => student.profileId),
    })
    const milestone = await createMilestoneForTeacher(teacher, {
      groupId: group.id,
      title: "Draft",
      description: "Initial description",
      dueDate: "2026-10-01",
    })

    const updated = await updateMilestoneForTeacher(teacher, milestone.id, {
      title: "Proposal draft",
      description: null,
      weight: 3,
    })

    expect(updated).toMatchObject({ title: "Proposal draft", description: null, weight: 3 })
    expect(updated.dueDate).not.toBeNull()
  })

  it("deletes a milestone and records the deletion", async () => {
    const fixture = await createGroupsFixture(prisma, { studentCount: 2 })
    const teacher = teacherSession(fixture)
    const group = await createGroupForTeacher(teacher, {
      offeringId: fixture.offering.id,
      name: "Alpha",
      studentIds: fixture.students.map((student) => student.profileId),
    })
    const milestone = await createMilestoneForTeacher(teacher, {
      groupId: group.id,
      title: "Draft",
    })

    await deleteMilestoneForTeacher(teacher, milestone.id)

    await expect(prisma.milestone.count({ where: { id: milestone.id } })).resolves.toBe(0)
    await expect(
      prisma.auditLog.count({ where: { action: "milestone.deleted", entityId: milestone.id } }),
    ).resolves.toBe(1)
  })

  it("refuses to place a student who is already on a team in the offering", async () => {
    const fixture = await createGroupsFixture(prisma, { studentCount: 2 })
    const teacher = teacherSession(fixture)
    const [first, second] = fixture.students

    await createGroupForTeacher(teacher, {
      offeringId: fixture.offering.id,
      name: "Alpha",
      studentIds: [first.profileId],
    })

    // The same student cannot also join a second team: the page would render them as both
    // "placed" and "unassigned" (TN-49). The structural fix is a DB constraint; this guard
    // is what the write path can enforce today.
    await expect(
      createGroupForTeacher(teacher, {
        offeringId: fixture.offering.id,
        name: "Beta",
        studentIds: [first.profileId, second.profileId],
      }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it("allows a student into a new team once the old team is archived", async () => {
    const fixture = await createGroupsFixture(prisma, { studentCount: 1 })
    const teacher = teacherSession(fixture)
    const [only] = fixture.students

    const alpha = await createGroupForTeacher(teacher, {
      offeringId: fixture.offering.id,
      name: "Alpha",
      studentIds: [only.profileId],
    })
    await prisma.group.update({ where: { id: alpha.id }, data: { status: "ARCHIVED" } })

    const beta = await createGroupForTeacher(teacher, {
      offeringId: fixture.offering.id,
      name: "Beta",
      studentIds: [only.profileId],
    })
    expect(beta.memberCount).toBe(1)
  })
})
