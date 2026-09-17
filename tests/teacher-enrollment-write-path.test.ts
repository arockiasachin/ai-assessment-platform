import { afterAll, beforeEach, describe, expect, it } from "vitest"

import {
  addStudentToOffering,
  getRosterContextForTeacher,
  listRosterForTeacher,
  moveStudentBetweenOfferings,
  removeStudentFromOffering,
  RosterError,
} from "@/lib/teacher-roster"
import type { AuthUser } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * The teacher roster's enrolment write path (TN-9).
 *
 * Before this, the only enrolment route in the repo was student-facing, so a teacher could not
 * fix a misplaced or dropped enrolment. These tests cover the three operations and the two rules
 * that make them safe: only the teacher's own offerings, and never past `studentLimit`.
 */

function teacherSession(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "teacher" }
}

async function createStudent(register: string) {
  const user = await prisma.user.create({
    data: {
      email: `${register}@enrol.test`,
      passwordHash: "test-only-not-a-real-hash",
      role: "STUDENT",
      studentProfile: { create: { fullName: register, registerNumber: register } },
    },
    include: { studentProfile: true },
  })
  return user.studentProfile!
}

async function secondOfferingFor(fixture: Awaited<ReturnType<typeof createSpineFixture>>) {
  const classroom = await prisma.classRoom.create({
    data: { code: "CLASS-ENROL-2", name: "Enrol Class 2", academicYear: 2026 },
  })
  return prisma.courseOffering.create({
    data: {
      courseId: fixture.course.id,
      classId: classroom.id,
      teacherId: fixture.teacher.staffProfile!.id,
      term: "Term-Two",
      academicYear: 2026,
    },
  })
}

describe("teacher enrolment write path", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("adds a student, audits the write, and is idempotent on repeat", async () => {
    const f = await createSpineFixture(prisma)
    const actor = teacherSession(f.teacher)
    const student = await createStudent("ENROL-1")

    const first = await addStudentToOffering(actor, {
      offeringId: f.offering.id,
      studentId: student.id,
    })
    expect(first.status).toBe("active")
    expect(first.changed).toBe(true)

    const row = await prisma.enrollment.findUniqueOrThrow({
      where: { studentId_offeringId: { studentId: student.id, offeringId: f.offering.id } },
    })
    expect(row.status).toBe("active")

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "Enrollment", action: "enrollment.added" },
    })
    expect(audit.actorId).toBe(f.teacher.id)

    const again = await addStudentToOffering(actor, {
      offeringId: f.offering.id,
      studentId: student.id,
    })
    expect(again.changed).toBe(false)
    expect(await prisma.enrollment.count()).toBe(1)

    const roster = await listRosterForTeacher(actor)
    expect(roster.map((entry) => entry.studentId)).toContain(student.id)
  })

  it("removes a student without deleting the row, and re-adding restores them", async () => {
    const f = await createSpineFixture(prisma)
    const actor = teacherSession(f.teacher)
    const student = await createStudent("ENROL-2")
    await addStudentToOffering(actor, { offeringId: f.offering.id, studentId: student.id })

    const removed = await removeStudentFromOffering(actor, {
      offeringId: f.offering.id,
      studentId: student.id,
    })
    expect(removed.status).toBe("dropped")
    expect(removed.changed).toBe(true)

    const row = await prisma.enrollment.findUniqueOrThrow({
      where: { studentId_offeringId: { studentId: student.id, offeringId: f.offering.id } },
    })
    expect(row.status).toBe("dropped")
    // The row survives, so the student can still be re-added.
    expect(await listRosterForTeacher(actor)).toHaveLength(0)

    // A removed student stays in the context pool — otherwise the add action could not undo a
    // removal.
    const context = await getRosterContextForTeacher(actor)
    const option = context.students.find((entry) => entry.id === student.id)
    expect(option?.activeOfferingIds).toEqual([])
    expect(option?.knownOfferingIds).toContain(f.offering.id)

    await addStudentToOffering(actor, { offeringId: f.offering.id, studentId: student.id })
    expect(await listRosterForTeacher(actor)).toHaveLength(1)

    // Removing again is a no-op rather than an error.
    await removeStudentFromOffering(actor, { offeringId: f.offering.id, studentId: student.id })
    const second = await removeStudentFromOffering(actor, {
      offeringId: f.offering.id,
      studentId: student.id,
    })
    expect(second.changed).toBe(false)
  })

  it("moves a student between two owned offerings", async () => {
    const f = await createSpineFixture(prisma)
    const actor = teacherSession(f.teacher)
    const target = await secondOfferingFor(f)
    const student = await createStudent("ENROL-3")
    await addStudentToOffering(actor, { offeringId: f.offering.id, studentId: student.id })

    const moved = await moveStudentBetweenOfferings(actor, {
      studentId: student.id,
      fromOfferingId: f.offering.id,
      toOfferingId: target.id,
    })
    expect(moved.offeringId).toBe(target.id)
    expect(moved.changed).toBe(true)

    const [source, destination] = await Promise.all([
      prisma.enrollment.findUniqueOrThrow({
        where: { studentId_offeringId: { studentId: student.id, offeringId: f.offering.id } },
      }),
      prisma.enrollment.findUniqueOrThrow({
        where: { studentId_offeringId: { studentId: student.id, offeringId: target.id } },
      }),
    ])
    expect(source.status).toBe("dropped")
    expect(destination.status).toBe("active")

    // The roster is now exactly the target offering's one row.
    const roster = await listRosterForTeacher(actor)
    expect(roster).toHaveLength(1)
    expect(roster[0].offeringId).toBe(target.id)

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "enrollment.moved" },
    })
    expect(audit.entityId).toBe(`${target.id}:${student.id}`)
  })

  it("refuses to move a student who is not actively in the source offering", async () => {
    const f = await createSpineFixture(prisma)
    const actor = teacherSession(f.teacher)
    const target = await secondOfferingFor(f)
    const student = await createStudent("ENROL-4")

    await expect(
      moveStudentBetweenOfferings(actor, {
        studentId: student.id,
        fromOfferingId: f.offering.id,
        toOfferingId: target.id,
      }),
    ).rejects.toThrow("not actively enrolled")
  })

  it("refuses to exceed the offering's student limit", async () => {
    const f = await createSpineFixture(prisma)
    const actor = teacherSession(f.teacher)
    await prisma.courseOffering.update({
      where: { id: f.offering.id },
      data: { studentLimit: 1 },
    })
    const first = await createStudent("ENROL-5")
    const second = await createStudent("ENROL-6")
    await addStudentToOffering(actor, { offeringId: f.offering.id, studentId: first.id })

    await expect(
      addStudentToOffering(actor, { offeringId: f.offering.id, studentId: second.id }),
    ).rejects.toThrow("full")
    expect(await prisma.enrollment.count()).toBe(1)
  })

  it("refuses an offering the teacher does not teach, with the same 404", async () => {
    const f = await createSpineFixture(prisma)
    const other = await prisma.user.create({
      data: {
        email: "other-enrol-teacher@test.local",
        passwordHash: "test-only-not-a-real-hash",
        role: "TEACHER",
        staffProfile: { create: { fullName: "Olive Teacher", empId: "EMP-ENROL-OTHER" } },
      },
      include: { staffProfile: true },
    })
    const foreignOffering = await prisma.courseOffering.create({
      data: {
        courseId: f.course.id,
        classId: f.classroom.id,
        teacherId: other.staffProfile!.id,
        term: "Term-Other",
        academicYear: 2025,
      },
    })
    const actor = teacherSession(f.teacher)
    const student = await createStudent("ENROL-7")

    await expect(
      addStudentToOffering(actor, { offeringId: foreignOffering.id, studentId: student.id }),
    ).rejects.toMatchObject({ status: 404, message: "Offering not found or not taught by you." })
    expect(await prisma.enrollment.count()).toBe(0)
  })

  it("does not report a removed enrolment as an error when it never existed", async () => {
    const f = await createSpineFixture(prisma)
    const actor = teacherSession(f.teacher)
    const student = await createStudent("ENROL-8")
    await expect(
      removeStudentFromOffering(actor, { offeringId: f.offering.id, studentId: student.id }),
    ).rejects.toBeInstanceOf(RosterError)
  })
})
