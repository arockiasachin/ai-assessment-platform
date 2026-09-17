import { beforeAll, describe, expect, it } from "vitest"

import { listStudentAssessments, MIN_COHORT_FOR_CLASS_AVERAGE } from "@/lib/student-assessments"
import type { AuthUser } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * SN-49 — the minimum-cohort threshold on `classAveragePercentage`.
 *
 * A class average is an aggregate, but in a two-student cohort it is invertible:
 * with the student's own mark and the average, a classmate's exact mark is
 * `2 × average − own`. The rule is therefore to withhold the average below
 * `MIN_COHORT_FOR_CLASS_AVERAGE` (three released marks) and to say so, so a
 * withheld number does not read as a broken one.
 *
 * The cases pin the boundary in both directions — withheld *below* the minimum,
 * shown *at* it — and pin the cohort definition itself: only released marks
 * count, because an unreleased mark is not a fact a student may use and must not
 * move the number either.
 */

let assessmentId: string
let offeringId: string
let viewerUserId: string
const studentIds: string[] = []

async function addStudent(index: number) {
  const user = await prisma.user.create({
    data: {
      email: `cohort-student-${index}@spine.test`,
      passwordHash: "test-only-not-a-real-hash",
      role: "STUDENT",
      studentProfile: {
        create: { fullName: `Cohort Student ${index}`, registerNumber: `REG-COHORT-${index}` },
      },
    },
    include: { studentProfile: true },
  })
  return user
}

/** Replace the assessment's grades with one per student, in order. */
async function setMarks(marks: { points: number; published: boolean }[]) {
  await prisma.grade.deleteMany({ where: { assessmentId } })
  await prisma.grade.createMany({
    data: marks.map((mark, index) => ({
      assessmentId,
      studentId: studentIds[index],
      points: mark.points,
      maxPoints: 20,
      publishedAt: mark.published ? new Date() : null,
    })),
  })
}

beforeAll(async () => {
  await truncateAll()

  const fixture = await createSpineFixture(prisma)
  assessmentId = fixture.assessment.id
  offeringId = fixture.offering.id
  viewerUserId = fixture.student.id

  // Three extra students, so a four-mark cohort is expressible. One extra is
  // left without a mark in some cases, which is fine: the cohort is the count of
  // released marks, not enrollments.
  const extras = await Promise.all([addStudent(2), addStudent(3), addStudent(4)])
  studentIds.push(
    fixture.student.studentProfile!.id,
    ...extras.map((user) => user.studentProfile!.id),
  )

  for (const studentId of studentIds) {
    await prisma.enrollment.create({ data: { studentId, offeringId, status: "active" } })
  }
})

function asUser(id: string): AuthUser {
  return { id, email: "", role: "student" }
}

async function averageForViewer() {
  const payload = await listStudentAssessments(asUser(viewerUserId))
  const item = payload!.assessments.find((row) => row.id === assessmentId)
  expect(item).toBeDefined()
  return item!
}

describe("SN-49 minimum-cohort threshold on the class average", () => {
  it("uses three as the minimum cohort", () => {
    expect(MIN_COHORT_FOR_CLASS_AVERAGE).toBe(3)
  })

  it("withholds the average over a two-mark cohort, where a peer's mark is derivable", async () => {
    await setMarks([
      { points: 20, published: true }, // 100%
      { points: 10, published: true }, // 50%
    ])

    const item = await averageForViewer()
    expect(item.classAveragePercentage).toBeNull()
    expect(item.classAverageWithheld).toBe(true)
    expect(item.classAverageCohortSize).toBe(2)
    expect(item.classAverageMinimumCohort).toBe(MIN_COHORT_FOR_CLASS_AVERAGE)
  })

  it("shows the average once the cohort reaches the minimum", async () => {
    await setMarks([
      { points: 20, published: true }, // 100%
      { points: 10, published: true }, // 50%
      { points: 5, published: true }, // 25%
    ])

    const item = await averageForViewer()
    // (100 + 50 + 25) / 3
    expect(item.classAveragePercentage).toBeCloseTo(58.33, 1)
    expect(item.classAverageWithheld).toBe(false)
    expect(item.classAverageCohortSize).toBe(3)
  })

  it("does not count unreleased marks toward the cohort", async () => {
    await setMarks([
      { points: 20, published: true },
      { points: 10, published: true },
      { points: 0, published: false },
      { points: 0, published: false },
    ])

    const item = await averageForViewer()
    expect(item.classAveragePercentage).toBeNull()
    expect(item.classAverageWithheld).toBe(true)
    expect(item.classAverageCohortSize).toBe(2)
  })

  it("reports 'no average yet' rather than 'withheld' when nothing is released", async () => {
    await setMarks([
      { points: 20, published: false },
      { points: 10, published: false },
    ])

    const item = await averageForViewer()
    // Nothing to disclose, so this is the empty state, not a withheld one.
    expect(item.classAveragePercentage).toBeNull()
    expect(item.classAverageWithheld).toBe(false)
    expect(item.classAverageCohortSize).toBe(0)
  })
})

describe("cleanup", () => {
  it("disconnects", async () => {
    await disconnectTestDatabase()
  })
})
