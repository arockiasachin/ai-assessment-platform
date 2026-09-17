import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { listRetakeQueueForTeacher } from "@/lib/teacher-retake-requests"
import type { AuthUser } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * The teacher's cross-assessment retake queue (TN-51).
 *
 * Students could already file requests and the per-assessment teacher endpoints already decided
 * them; only a caller was missing. These tests pin the read that caller uses: ownership scoping,
 * names on the row, and pending first.
 */

function teacherSession(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "teacher" }
}

async function createStudent(register: string) {
  const user = await prisma.user.create({
    data: {
      email: `${register}@retake.test`,
      passwordHash: "test-only-not-a-real-hash",
      role: "STUDENT",
      studentProfile: { create: { fullName: register, registerNumber: register } },
    },
    include: { studentProfile: true },
  })
  return user.studentProfile!
}

describe("teacher retake queue", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("returns requests on owned assessments, pending first, with names", async () => {
    const f = await createSpineFixture(prisma)
    const actor = teacherSession(f.teacher)
    const approvedStudent = await createStudent("RETAKE-A")
    const pendingStudent = await createStudent("RETAKE-B")

    await prisma.retakeRequest.create({
      data: {
        assessmentId: f.assessment.id,
        studentId: approvedStudent.id,
        status: "APPROVED",
        decidedById: f.teacher.staffProfile!.id,
        decidedAt: new Date(),
      },
    })
    await prisma.retakeRequest.create({
      data: {
        assessmentId: f.assessment.id,
        studentId: pendingStudent.id,
        status: "PENDING",
        requestNote: "I was ill",
      },
    })

    const rows = await listRetakeQueueForTeacher(actor)
    expect(rows).toHaveLength(2)
    expect(rows[0].status).toBe("PENDING")
    expect(rows[0].studentName).toBe("RETAKE-B")
    expect(rows[0].assessmentTitle).toBe(f.assessment.title)
    expect(rows[0].requestNote).toBe("I was ill")
    expect(rows[1].decidedBy).toBe(f.teacher.staffProfile!.fullName)
  })

  it("does not leak another teacher's requests", async () => {
    const f = await createSpineFixture(prisma)
    const actor = teacherSession(f.teacher)
    const student = await createStudent("RETAKE-C")
    await prisma.retakeRequest.create({
      data: { assessmentId: f.assessment.id, studentId: student.id, status: "PENDING" },
    })

    const other = await prisma.user.create({
      data: {
        email: "other-retake-teacher@test.local",
        passwordHash: "test-only-not-a-real-hash",
        role: "TEACHER",
        staffProfile: { create: { fullName: "Olive Teacher", empId: "EMP-RETAKE-OTHER" } },
      },
      include: { staffProfile: true },
    })

    expect(await listRetakeQueueForTeacher(teacherSession(other))).toEqual([])
    expect(await listRetakeQueueForTeacher(actor)).toHaveLength(1)
  })
})
