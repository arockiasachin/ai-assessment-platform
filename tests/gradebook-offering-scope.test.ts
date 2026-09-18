import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { getGradebookPayloadForSessionUser } from "@/lib/gradebook-db"
import { scopeGradebookToOffering } from "@/lib/gradebook-view"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * TN-47, data half: the teacher gradebook payload used to be the union of every student and
 * every assessment across every offering the teacher owns, with nothing saying which student
 * belonged to which offering. The marks grid therefore rendered a cross-product and most cells
 * were refused by the write path. The payload now annotates each student with the offerings
 * they are enrolled in, so `scopeGradebookToOffering` can narrow both axes to one class.
 */
describe("gradebook payload offering annotation", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  async function seedTwoOfferings() {
    const fixture = await createSpineFixture(prisma)
    const staffId = fixture.teacher.staffProfile!.id
    const studentAId = fixture.student.studentProfile!.id

    await prisma.enrollment.create({
      data: { studentId: studentAId, offeringId: fixture.offering.id, status: "active" },
    })

    const secondOffering = await prisma.courseOffering.create({
      data: {
        courseId: fixture.course.id,
        classId: fixture.classroom.id,
        teacherId: staffId,
        term: "Term-Second",
        academicYear: 2026,
      },
    })
    const secondAssessment = await prisma.assessment.create({
      data: {
        offeringId: secondOffering.id,
        courseId: fixture.course.id,
        classId: fixture.classroom.id,
        title: "Second Offering Quiz",
        type: "QUIZ",
        dueDate: new Date("2026-11-01T08:00:00.000Z"),
        maxMarks: 10,
        createdById: staffId,
        releasedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    })

    const studentB = await prisma.user.create({
      data: {
        email: "second-offering-student@spine.test",
        passwordHash: "test-only-not-a-real-hash",
        role: "STUDENT",
        studentProfile: {
          create: { fullName: "Bea Second", registerNumber: "REG-TEST-SECOND" },
        },
      },
      include: { studentProfile: true },
    })
    const studentBId = studentB.studentProfile!.id
    await prisma.enrollment.create({
      data: { studentId: studentBId, offeringId: secondOffering.id, status: "active" },
    })

    const teacherSession = {
      id: fixture.teacher.id,
      email: fixture.teacher.email,
      role: "teacher" as const,
    }
    return {
      fixture,
      staffId,
      studentAId,
      studentBId,
      secondOffering,
      secondAssessment,
      teacherSession,
    }
  }

  it("annotates each student with the offering(s) they are enrolled in", async () => {
    const { fixture, studentAId, studentBId, secondOffering, teacherSession } =
      await seedTwoOfferings()

    const payload = await getGradebookPayloadForSessionUser(teacherSession)

    const studentA = payload.students.find((s) => s.id === studentAId)
    const studentB = payload.students.find((s) => s.id === studentBId)
    expect(studentA?.offeringIds).toEqual([fixture.offering.id])
    expect(studentB?.offeringIds).toEqual([secondOffering.id])
  })

  it("scopes the payload to one offering so the grid is a writable rectangle", async () => {
    const { fixture, studentAId, studentBId, secondAssessment, teacherSession } =
      await seedTwoOfferings()

    const payload = await getGradebookPayloadForSessionUser(teacherSession)
    // The unscoped payload is the defect: two offerings' students and assessments together.
    expect(payload.students.length).toBe(2)
    expect(payload.assessments.length).toBe(2)

    const scope = scopeGradebookToOffering(
      payload.students,
      payload.assessments,
      fixture.offering.id,
    )
    expect(scope.students.map((s) => s.id)).toEqual([studentAId])
    expect(scope.assessments.map((a) => a.id)).toEqual([fixture.assessment.id])
    // The other class's assessment column is gone, which is what removes the unwritable cells.
    expect(scope.assessments.map((a) => a.id)).not.toContain(secondAssessment.id)
    expect(scope.students.map((s) => s.id)).not.toContain(studentBId)
  })

  it("keeps a student enrolled in both offerings in both scopes", async () => {
    const { fixture, studentAId, secondOffering, teacherSession } = await seedTwoOfferings()
    await prisma.enrollment.create({
      data: { studentId: studentAId, offeringId: secondOffering.id, status: "active" },
    })

    const payload = await getGradebookPayloadForSessionUser(teacherSession)
    const studentA = payload.students.find((s) => s.id === studentAId)
    expect(studentA?.offeringIds?.sort()).toEqual([fixture.offering.id, secondOffering.id].sort())

    const scope = scopeGradebookToOffering(payload.students, payload.assessments, secondOffering.id)
    expect(scope.students.map((s) => s.id)).toContain(studentAId)
  })
})
