import { beforeAll, describe, expect, it } from "vitest"

import { listStudentAssessments } from "@/lib/student-assessments"
import type { AuthUser } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * The published-mark invariant for the student assessments payload.
 *
 * This guard existed only by reading before now, and `classAveragePercentage` is
 * a **class-wide** average — so if the query ever stops filtering unpublished
 * grades, one student's unreleased mark would move a number shown to a different
 * student. The read path had no test at all, which is how an earlier change to
 * that filter could land with nothing to catch a regression.
 *
 * The fixture is deliberately tiny: one published mark and two unpublished ones
 * on the same assessment. A published-only average is then a different number
 * from an all-rows average, so the test fails loudly if the filter is dropped
 * rather than passing by coincidence.
 */

const PUBLISHED = 20
const PEER_A = 10
const PEER_B = 5

let assessmentId: string
let offeringId: string
let viewerUserId: string
let peerAUserId: string

async function addStudent(index: number, registerNumber: string) {
  const user = await prisma.user.create({
    data: {
      email: `invariant-student-${index}@spine.test`,
      passwordHash: "test-only-not-a-real-hash",
      role: "STUDENT",
      studentProfile: { create: { fullName: `Invariant Student ${index}`, registerNumber } },
    },
    include: { studentProfile: true },
  })
  return user
}

beforeAll(async () => {
  await truncateAll()

  const fixture = await createSpineFixture(prisma)
  assessmentId = fixture.assessment.id
  offeringId = fixture.offering.id
  viewerUserId = fixture.student.id

  // Two extra students so there are peers whose marks can be unreleased.
  const peerA = await addStudent(2, "REG-INV-2")
  const peerB = await addStudent(3, "REG-INV-3")
  peerAUserId = peerA.id

  for (const studentId of [
    fixture.student.studentProfile!.id,
    peerA.studentProfile!.id,
    peerB.studentProfile!.id,
  ]) {
    await prisma.enrollment.create({
      data: { studentId, offeringId, status: "active" },
    })
  }

  await prisma.grade.createMany({
    data: [
      {
        assessmentId,
        studentId: fixture.student.studentProfile!.id,
        points: PUBLISHED,
        maxPoints: 20,
        publishedAt: new Date(),
      },
      { assessmentId, studentId: peerA.studentProfile!.id, points: PEER_A, maxPoints: 20 },
      { assessmentId, studentId: peerB.studentProfile!.id, points: PEER_B, maxPoints: 20 },
    ],
  })
})

function asUser(id: string): AuthUser {
  // `AuthUser` is the session shape, so its role is lowercase even though the
  // Prisma `UserRole` enum is uppercase.
  return { id, email: "", role: "student" }
}

describe("listStudentAssessments — published-mark invariant", () => {
  it("never lets an unpublished peer mark move the class average", async () => {
    const payload = await listStudentAssessments(asUser(viewerUserId))
    expect(payload).not.toBeNull()

    const item = payload!.assessments.find((row) => row.id === assessmentId)
    expect(item).toBeDefined()

    // Published-only is 100%. Including the two unpublished peers it would be
    // (100 + 50 + 25) / 3 = 58.33 — so this fails loudly if the filter is lost.
    expect(item!.classAveragePercentage).toBeCloseTo(100, 5)
    expect(item!.classAveragePercentage).not.toBeCloseTo(58.33, 1)

    expect(item!.score).toBe(PUBLISHED)
    expect(item!.percentage).toBeCloseTo(100, 5)
    expect(item!.published).toBe(true)
    expect(item!.hasMark).toBe(true)
  })

  it("reports hasMark for an unreleased mark, and keeps its value out of the payload", async () => {
    const payload = await listStudentAssessments(asUser(peerAUserId))
    const item = payload!.assessments.find((row) => row.id === assessmentId)
    expect(item).toBeDefined()

    // A mark exists, so this is distinguishable from "not marked yet"...
    expect(item!.hasMark).toBe(true)
    // ...but it is unreleased, so no value leaks — not even through the average.
    expect(item!.published).toBe(false)
    expect(item!.score).toBeNull()
    expect(item!.percentage).toBeNull()
    expect(item!.classAveragePercentage).toBeCloseTo(100, 5)
  })

  it("does not list an assessment the student is not enrolled in", async () => {
    const outsider = await addStudent(9, "REG-INV-9")
    const payload = await listStudentAssessments(asUser(outsider.id))
    expect(payload!.assessments.find((row) => row.id === assessmentId)).toBeUndefined()
  })
})

describe("cleanup", () => {
  it("disconnects", async () => {
    await disconnectTestDatabase()
  })
})
