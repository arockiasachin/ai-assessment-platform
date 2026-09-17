import { afterAll, beforeEach, describe, expect, it } from "vitest"

import {
  createGroupForTeacher,
  getOfferingAnalysisForTeacher,
  groupsForAssessmentWhere,
  listGroupProjectAssessmentsForTeacher,
  listGroupsForTeacher,
  updateGroupForTeacher,
} from "@/lib/groups"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createGroupsFixture, teacherSession } from "./fixtures/groups"

/**
 * The schema half of TN-49: a `Group` is linked to the `GROUP_PROJECT` assessment it exists
 * for.
 *
 * The interesting assertions are not that the column can hold an id, but that (a) the link is
 * enforced — only an owned `GROUP_PROJECT` of the same offering may be attached, and (b) the
 * chosen delete behaviour is `RESTRICT`: deleting an assessment with linked teams is refused
 * rather than silently unscoping them (`SetNull`) or destroying the teams and their evidence
 * (`Cascade`).
 */

async function createProjectAssessment(
  fixture: Awaited<ReturnType<typeof createGroupsFixture>>,
  overrides: { offeringId?: string; title?: string; type?: "GROUP_PROJECT" | "QUIZ" } = {},
) {
  return prisma.assessment.create({
    data: {
      offeringId: overrides.offeringId ?? fixture.offering.id,
      courseId: fixture.course.id,
      classId: fixture.classroom.id,
      title: overrides.title ?? "Linear models group project",
      type: overrides.type ?? "GROUP_PROJECT",
      dueDate: new Date("2026-12-01T08:00:00.000Z"),
      maxMarks: 20,
      createdById: fixture.teacher.staffProfile!.id,
    },
  })
}

describe("group ↔ GROUP_PROJECT assessment link (TN-49)", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("single-sources the group filter in one pure, import-free predicate", () => {
    const first = groupsForAssessmentWhere("assessment-1")
    expect(first).toEqual({ assessmentId: "assessment-1" })

    // A fresh object per call, so one caller spreading or mutating it cannot change the next.
    const second = groupsForAssessmentWhere("assessment-1")
    expect(second).not.toBe(first)
    second.assessmentId = "mutated"
    expect(groupsForAssessmentWhere("assessment-1")).toEqual({ assessmentId: "assessment-1" })
  })

  it("links a newly created team to its project assessment and reads it back", async () => {
    const fixture = await createGroupsFixture(prisma, { studentCount: 2 })
    const teacher = teacherSession(fixture)
    const assessment = await createProjectAssessment(fixture)

    const group = await createGroupForTeacher(teacher, {
      offeringId: fixture.offering.id,
      name: "Alpha",
      assessmentId: assessment.id,
      studentIds: fixture.students.map((student) => student.profileId),
    })

    expect(group.assessmentId).toBe(assessment.id)
    expect(group.assessmentTitle).toBe("Linear models group project")

    // The column is a real foreign key, not an opaque string: the row is queryable by it.
    const stored = await prisma.group.findUniqueOrThrow({
      where: { id: group.id },
      select: { assessmentId: true },
    })
    expect(stored.assessmentId).toBe(assessment.id)

    // The write is attributable in the audit trail too.
    await expect(
      prisma.auditLog.count({
        where: { entityType: "Group", entityId: group.id, action: "group.created" },
      }),
    ).resolves.toBe(1)
  })

  it("narrows a teacher's group list to one assessment's teams", async () => {
    const fixture = await createGroupsFixture(prisma, { studentCount: 2 })
    const teacher = teacherSession(fixture)
    const [first, second] = fixture.students
    const project = await createProjectAssessment(fixture)

    const linked = await createGroupForTeacher(teacher, {
      offeringId: fixture.offering.id,
      name: "Linked",
      assessmentId: project.id,
      studentIds: [first.profileId],
    })
    await createGroupForTeacher(teacher, {
      offeringId: fixture.offering.id,
      name: "Unlinked",
      studentIds: [second.profileId],
    })

    const all = await listGroupsForTeacher(teacher, fixture.offering.id)
    expect(all.map((group) => group.name).sort()).toEqual(["Linked", "Unlinked"])

    const scoped = await listGroupsForTeacher(teacher, fixture.offering.id, project.id)
    expect(scoped.map((group) => group.id)).toEqual([linked.id])
    expect(scoped[0].assessmentTitle).toBe("Linear models group project")
  })

  it("lists the offering's project assessments so the link can be made in the UI", async () => {
    const fixture = await createGroupsFixture(prisma, { studentCount: 1 })
    const teacher = teacherSession(fixture)
    await createProjectAssessment(fixture, { title: "Project A" })
    await createProjectAssessment(fixture, { title: "A quiz, not a project", type: "QUIZ" })

    const options = await listGroupProjectAssessmentsForTeacher(teacher, fixture.offering.id)
    expect(options.map((option) => option.title)).toEqual(["Project A"])
  })

  it("clears the link on an explicit null, and re-links on update", async () => {
    const fixture = await createGroupsFixture(prisma, { studentCount: 1 })
    const teacher = teacherSession(fixture)
    const project = await createProjectAssessment(fixture)
    const group = await createGroupForTeacher(teacher, {
      offeringId: fixture.offering.id,
      name: "Alpha",
      assessmentId: project.id,
      studentIds: [fixture.students[0].profileId],
    })

    const cleared = await updateGroupForTeacher(teacher, group.id, { assessmentId: null })
    expect(cleared.assessmentId).toBeNull()
    expect(cleared.assessmentTitle).toBeNull()

    const relinked = await updateGroupForTeacher(teacher, group.id, { assessmentId: project.id })
    expect(relinked.assessmentId).toBe(project.id)
    expect(relinked.assessmentTitle).toBe(project.title)
  })

  it("refuses a link to a non-project assessment of the same offering", async () => {
    const fixture = await createGroupsFixture(prisma, { studentCount: 1 })
    const teacher = teacherSession(fixture)
    const quiz = await createProjectAssessment(fixture, { type: "QUIZ", title: "A quiz" })

    await expect(
      createGroupForTeacher(teacher, {
        offeringId: fixture.offering.id,
        name: "Alpha",
        assessmentId: quiz.id,
        studentIds: [fixture.students[0].profileId],
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it("refuses a link to a project assessment of a different offering", async () => {
    const fixture = await createGroupsFixture(prisma, { studentCount: 1 })
    const teacher = teacherSession(fixture)
    const otherOffering = await prisma.courseOffering.create({
      data: {
        courseId: fixture.course.id,
        classId: fixture.classroom.id,
        teacherId: fixture.teacher.staffProfile!.id,
        term: "Other-Term",
        academicYear: 2026,
      },
    })
    const foreignProject = await createProjectAssessment(fixture, { offeringId: otherOffering.id })

    await expect(
      createGroupForTeacher(teacher, {
        offeringId: fixture.offering.id,
        name: "Alpha",
        assessmentId: foreignProject.id,
        studentIds: [fixture.students[0].profileId],
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it("scopes the offering analysis to one project assessment's teams", async () => {
    const fixture = await createGroupsFixture(prisma, { studentCount: 2 })
    const teacher = teacherSession(fixture)
    const [first, second] = fixture.students
    const project = await createProjectAssessment(fixture)

    const linked = await createGroupForTeacher(teacher, {
      offeringId: fixture.offering.id,
      name: "Linked",
      assessmentId: project.id,
      studentIds: [first.profileId],
    })
    await createGroupForTeacher(teacher, {
      offeringId: fixture.offering.id,
      name: "Unlinked",
      studentIds: [second.profileId],
    })

    const whole = await getOfferingAnalysisForTeacher(teacher, {
      offeringId: fixture.offering.id,
    })
    expect(whole.groups).toHaveLength(2)

    const scoped = await getOfferingAnalysisForTeacher(teacher, {
      offeringId: fixture.offering.id,
      assessmentId: project.id,
    })
    expect(scoped.groups.map((entry) => entry.analysis.groupId)).toEqual([linked.id])
  })

  it("refuses to delete an assessment that still has linked teams (RESTRICT)", async () => {
    const fixture = await createGroupsFixture(prisma, { studentCount: 1 })
    const teacher = teacherSession(fixture)
    const project = await createProjectAssessment(fixture)
    const group = await createGroupForTeacher(teacher, {
      offeringId: fixture.offering.id,
      name: "Alpha",
      assessmentId: project.id,
      studentIds: [fixture.students[0].profileId],
    })

    // `onDelete: RESTRICT`: the assessment cannot be removed while a team is linked. The
    // alternative (`SetNull`) would silently turn the team into an unscoped one, and
    // `Cascade` would destroy the team and its peer evaluations with the assessment.
    await expect(prisma.assessment.delete({ where: { id: project.id } })).rejects.toThrow()

    const survivor = await prisma.group.findUniqueOrThrow({
      where: { id: group.id },
      select: { assessmentId: true },
    })
    expect(survivor.assessmentId).toBe(project.id)

    // Deleting the assessment is still possible once the team is explicitly unlinked.
    await updateGroupForTeacher(teacher, group.id, { assessmentId: null })
    await expect(prisma.assessment.delete({ where: { id: project.id } })).resolves.toMatchObject({
      id: project.id,
    })
  })
})
