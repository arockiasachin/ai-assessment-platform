import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { markKey } from "@/lib/gradebook"
import { getGradebookPayloadForSessionUser } from "@/lib/gradebook-db"
import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * Object-level authorization regression for the gradebook payload.
 *
 * The student branch used to serialize every classmate's identity and every
 * classmate's mark to the browser, so a student could read the whole cohort's
 * grades from `/api/gradebook`. Students must receive only their own rows plus
 * a server-computed class average; teachers keep the cohort view they need.
 */
describe("gradebook payload object-level authorization", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  async function seedCohort() {
    const fixture = await createSpineFixture(prisma)
    const ownId = fixture.student.studentProfile!.id

    await prisma.enrollment.create({
      data: { studentId: ownId, offeringId: fixture.offering.id, status: "active" },
    })

    const classmate = await prisma.user.create({
      data: {
        email: "classmate@spine.test",
        passwordHash: "test-only-not-a-real-hash",
        role: "STUDENT",
        studentProfile: {
          create: { fullName: "Chris Classmate", registerNumber: "REG-TEST-CLASSMATE" },
        },
      },
      include: { studentProfile: true },
    })
    const classmateId = classmate.studentProfile!.id

    await prisma.enrollment.create({
      data: { studentId: classmateId, offeringId: fixture.offering.id, status: "active" },
    })

    await prisma.assessmentGrade.create({
      data: { assessmentId: fixture.assessment.id, studentId: ownId, marksObtained: 15 },
    })
    await prisma.assessmentGrade.create({
      data: { assessmentId: fixture.assessment.id, studentId: classmateId, marksObtained: 5 },
    })

    return { fixture, ownId, classmateId }
  }

  it("sends a student only their own identity and marks, never a classmate's", async () => {
    const { fixture, ownId, classmateId } = await seedCohort()

    const payload = await getGradebookPayloadForSessionUser({
      id: fixture.student.id,
      email: fixture.student.email,
      role: "student",
    })

    // Identity: exactly the session student.
    expect(payload.selectedStudentId).toBe(ownId)
    expect(payload.students.map((student) => student.id)).toEqual([ownId])

    // Marks: exactly the session student's own mark.
    expect(Object.keys(payload.marks)).toEqual([markKey(ownId, fixture.assessment.id)])
    expect(payload.marks[markKey(ownId, fixture.assessment.id)]).toBe(15)

    // The class signal is an aggregate only: (15 + 5) / 2 / 20 = 50%.
    expect(payload.classAverages[fixture.assessment.id]).toBeCloseTo(50)

    // The classmate's identity and grade must not be present anywhere.
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain("classmate@spine.test")
    expect(serialized).not.toContain(classmateId)
    expect(serialized).not.toContain(markKey(classmateId, fixture.assessment.id))
  })

  it("still gives a teacher the full cohort they are authorized to see", async () => {
    const { fixture, ownId, classmateId } = await seedCohort()

    const payload = await getGradebookPayloadForSessionUser({
      id: fixture.teacher.id,
      email: fixture.teacher.email,
      role: "teacher",
    })

    expect(payload.students.map((student) => student.id).sort()).toEqual(
      [ownId, classmateId].sort(),
    )
    expect(payload.marks[markKey(ownId, fixture.assessment.id)]).toBe(15)
    expect(payload.marks[markKey(classmateId, fixture.assessment.id)]).toBe(5)
  })
})
