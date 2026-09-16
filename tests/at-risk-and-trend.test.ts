import { beforeAll, describe, expect, it } from "vitest"

import { getAtRiskRosterForTeacher } from "@/lib/analytics/at-risk"
import { getCohortTrendForTeacher } from "@/lib/analytics/trend"
import type { AuthUser } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * The two new analytics readers against a real database.
 *
 * Both apply the same inclusion rule — a mark counts only when its assessment is past due and
 * the mark is published — and both are scoped by ownership. The assertions target those two
 * properties plus the specific things each reader can get wrong: the roster's three-group
 * split, and the trend's refusal to invent an axis.
 */

let f: Awaited<ReturnType<typeof createSpineFixture>>
let teacher: AuthUser

beforeAll(async () => {
  await truncateAll()
  f = await createSpineFixture(prisma)
  teacher = { id: f.teacher.id, email: f.teacher.email, role: "teacher" }

  // The fixture's assessment is due 2026-10-01, which is in the fixture's future by design.
  // A term window is needed for the trend, and a due date in the past for inclusion.
  await prisma.assessment.update({
    where: { id: f.assessment.id },
    data: { dueDate: new Date("2026-09-01T00:00:00.000Z") },
  })
  await prisma.courseOffering.update({
    where: { id: f.offering.id },
    data: {
      startsOn: new Date("2026-08-25T00:00:00.000Z"),
      endsOn: new Date("2026-12-08T00:00:00.000Z"),
    },
  })
})

/** A running counter, since the helper is called more than once and emails must be unique. */
let enrolledSoFar = 0

async function enrol(count: number, percentages: (number | null)[]): Promise<string[]> {
  const ids: string[] = []
  for (let index = 0; index < count; index += 1) {
    const n = enrolledSoFar++
    const user = await prisma.user.create({
      data: {
        email: `atrisk-${n}@spine.test`,
        passwordHash: "test-only-not-a-real-hash",
        role: "STUDENT",
        studentProfile: {
          create: { fullName: `At Risk ${n}`, registerNumber: `REG-AR-${n}` },
        },
      },
      include: { studentProfile: true },
    })
    const studentId = user.studentProfile!.id
    await prisma.enrollment.create({
      data: { studentId, offeringId: f.offering.id, status: "active" },
    })
    const percentage = percentages[index] ?? null
    if (percentage !== null) {
      await prisma.grade.create({
        data: {
          assessmentId: f.assessment.id,
          studentId,
          points: percentage,
          maxPoints: 100,
          source: "TEACHER_OVERRIDE",
          publishedAt: new Date(),
          approvedById: f.teacher.staffProfile!.id,
        },
      })
    }
    ids.push(studentId)
  }
  return ids
}

describe("getAtRiskRosterForTeacher", () => {
  it("separates the unmarked from the below-boundary", async () => {
    await prisma.course.update({ where: { id: f.course.id }, data: { category: "LABORATORY" } })
    await enrol(3, [30, 80, null])

    const roster = await getAtRiskRosterForTeacher(teacher, f.offering.id)
    expect(roster.regime).toBe("absolute")
    expect(roster.boundary).toBe(50)
    expect(roster.enrolledCount).toBe(3)
    expect(roster.publishedCount).toBe(2)

    const groups = roster.atRisk.map((student) => student.group).sort()
    expect(groups).toEqual(["below-boundary", "no-published-work"])
    expect(roster.aboveBoundaryCount).toBe(1)
  })

  it("does not count an unpublished mark toward a student's total", async () => {
    const [studentId] = await enrol(1, [null])
    await prisma.grade.create({
      data: {
        assessmentId: f.assessment.id,
        studentId,
        points: 10,
        maxPoints: 100,
        source: "AI_SUGGESTED",
        publishedAt: null,
      },
    })

    const roster = await getAtRiskRosterForTeacher(teacher, f.offering.id)
    // Still one student with no total, and the unpublished 10 has not made them at-risk.
    const unmarked = roster.atRisk.filter((student) => student.group === "no-published-work")
    expect(unmarked.map((student) => student.studentId)).toContain(studentId)
    expect(roster.boundary).toBe(50)
  })

  it("refuses an offering the caller does not own", async () => {
    await expect(
      getAtRiskRosterForTeacher(
        { id: "nobody", email: "n@test.local", role: "teacher" },
        f.offering.id,
      ),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe("getCohortTrendForTeacher", () => {
  it("buckets published marks into the offering's term weeks", async () => {
    const trend = await getCohortTrendForTeacher(teacher, f.offering.id)
    expect(trend.series).not.toBeNull()
    // 2026-08-25 → 2026-12-08 is 15 weeks.
    expect(trend.series?.weeks).toBe(15)
    expect(trend.markedCount).toBeGreaterThan(0)
  })

  it("dates a mark by its assessment's due date, so non-quiz assessments appear", async () => {
    // The assessment is due in week 2 of that term (2026-09-01). If the reader dated by
    // `submittedAt` instead — quizzes only — this point would not exist.
    const trend = await getCohortTrendForTeacher(teacher, f.offering.id)
    const nonNull = (trend.series?.points ?? []).filter((point) => point.average !== null)
    expect(nonNull.length).toBeGreaterThan(0)
    expect(nonNull[0].week).toBe(2)
  })

  it("returns no series when the offering has no term window", async () => {
    // B2's requirement: no honest axis, so say nothing rather than guess a start date.
    await prisma.courseOffering.update({
      where: { id: f.offering.id },
      data: { startsOn: null, endsOn: null },
    })

    const trend = await getCohortTrendForTeacher(teacher, f.offering.id)
    expect(trend.series).toBeNull()

    await prisma.courseOffering.update({
      where: { id: f.offering.id },
      data: {
        startsOn: new Date("2026-08-25T00:00:00.000Z"),
        endsOn: new Date("2026-12-08T00:00:00.000Z"),
      },
    })
  })

  it("refuses an offering the caller does not own", async () => {
    await expect(
      getCohortTrendForTeacher(
        { id: "nobody", email: "n@test.local", role: "teacher" },
        f.offering.id,
      ),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe("cleanup", () => {
  it("disconnects", async () => {
    await disconnectTestDatabase()
  })
})
