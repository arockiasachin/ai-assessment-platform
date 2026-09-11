import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { getOfferingAnalysisForTeacher } from "@/lib/groups/service"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createGroupsFixture, teacherSession } from "./fixtures/groups"

/**
 * Regression coverage for bug-fix run 2: soft-removed group members
 * (`GroupMember.leftAt != null`) were still fed into the instructor analysis, so
 * a former member received an adjustment factor and a suggested individual
 * grade, and their historical ratings skewed the team norm used for everyone
 * else. A removed member must leave the scored roster; their rows stay for audit.
 */
describe("groups analysis excludes soft-removed members", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("drops a removed member from memberIds, factors and suggestions", async () => {
    const fixture = await createGroupsFixture(prisma, { studentCount: 3 })
    const [a, b, c] = fixture.students
    const group = await prisma.group.create({
      data: {
        offeringId: fixture.offering.id,
        name: "Roster",
        members: {
          create: [
            { studentId: a.profileId },
            { studentId: b.profileId },
            { studentId: c.profileId },
          ],
        },
      },
    })

    await prisma.groupMember.update({
      where: { groupId_studentId: { groupId: group.id, studentId: c.profileId } },
      data: { leftAt: new Date() },
    })

    const result = await getOfferingAnalysisForTeacher(teacherSession(fixture), {
      offeringId: fixture.offering.id,
      groupGrade: 80,
    })
    const entry = result.groups.find((row) => row.analysis.groupId === group.id)
    expect(entry).toBeDefined()

    expect([...entry!.analysis.memberIds].sort()).toEqual(
      [a.profileId, b.profileId].sort((x, y) => x.localeCompare(y)),
    )
    expect(entry!.analysis.memberIds).not.toContain(c.profileId)
    expect(entry!.analysis.withoutSelf.map((row) => row.studentId)).not.toContain(c.profileId)
    expect(entry!.analysis.withSelf.map((row) => row.studentId)).not.toContain(c.profileId)
    expect(entry!.analysis.freeRiders.map((row) => row.studentId)).not.toContain(c.profileId)
    expect(entry!.suggestedIndividualGrades?.map((row) => row.studentId)).not.toContain(c.profileId)
  })
})
