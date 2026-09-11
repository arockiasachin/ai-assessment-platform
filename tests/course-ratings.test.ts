import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * End-to-end coverage for course ratings against the real (migrated) test
 * database. The route handlers are exercised with a signed session cookie so
 * `requireRole` re-validates the actor against `User`, and every assertion
 * checks the database, not a mock.
 */

const mocks = vi.hoisted(() => ({ getCookies: vi.fn() }))

vi.mock("next/headers", () => ({
  cookies: () => mocks.getCookies(),
}))

import { GET as teacherRatingsReport } from "@/app/api/teacher/reports/ratings/route"
import { POST as rateCourse } from "@/app/api/student/courses/rating/route"
import type { AuthUser } from "@/lib/session"
import { signSessionValue } from "@/lib/session"
import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

const COMPLETED = new Date("2026-01-01T00:00:00.000Z")

function useSession(user: AuthUser | null) {
  mocks.getCookies.mockResolvedValue({
    get: () => (user ? { value: signSessionValue(user) } : undefined),
  })
}

function postRating(body: Record<string, unknown>) {
  return rateCourse(
    new Request("https://app.test/api/student/courses/rating", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
}

async function enroll(studentId: string, offeringId: string, status = "active") {
  await prisma.enrollment.create({ data: { studentId, offeringId, status } })
}

describe("course ratings (database-backed)", () => {
  beforeEach(async () => {
    await mocks.getCookies.mockReset()
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("lets an enrolled student rate a completed course and upserts on re-rating", async () => {
    const fixture = await createSpineFixture(prisma)
    const studentProfileId = fixture.student.studentProfile!.id
    await prisma.courseOffering.update({
      where: { id: fixture.offering.id },
      data: { endsOn: COMPLETED },
    })
    await enroll(studentProfileId, fixture.offering.id)

    useSession({ id: fixture.student.id, email: fixture.student.email, role: "student" })

    const first = await postRating({
      offeringId: fixture.offering.id,
      rating: 4,
      comment: "Great course",
    })
    expect(first.status).toBe(200)

    let rows = await prisma.courseRating.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0].rating).toBe(4)
    expect(rows[0].comment).toBe("Great course")

    // Re-rating updates the existing row (the unique constraint means upsert).
    const second = await postRating({ offeringId: fixture.offering.id, rating: 2 })
    expect(second.status).toBe(200)

    rows = await prisma.courseRating.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0].rating).toBe(2)
    expect(rows[0].comment).toBeNull()
  })

  it("rejects a rating for a course the student is not enrolled in", async () => {
    const fixture = await createSpineFixture(prisma)
    await prisma.courseOffering.update({
      where: { id: fixture.offering.id },
      data: { endsOn: COMPLETED },
    })

    useSession({ id: fixture.student.id, email: fixture.student.email, role: "student" })

    const response = await postRating({ offeringId: fixture.offering.id, rating: 5 })

    expect(response.status).toBe(403)
    expect(await prisma.courseRating.count()).toBe(0)
  })

  it("rejects a rating on a course that has not completed, and on a waitlisted enrollment", async () => {
    const fixture = await createSpineFixture(prisma)
    const studentProfileId = fixture.student.studentProfile!.id
    await enroll(studentProfileId, fixture.offering.id)

    useSession({ id: fixture.student.id, email: fixture.student.email, role: "student" })

    // `endsOn` is null in the fixture, so the offering has not completed.
    const notCompleted = await postRating({ offeringId: fixture.offering.id, rating: 3 })
    expect(notCompleted.status).toBe(409)

    await prisma.courseOffering.update({
      where: { id: fixture.offering.id },
      data: { endsOn: COMPLETED },
    })
    await prisma.enrollment.update({
      where: {
        studentId_offeringId: { studentId: studentProfileId, offeringId: fixture.offering.id },
      },
      data: { status: "waitlisted" },
    })
    const waitlisted = await postRating({ offeringId: fixture.offering.id, rating: 3 })
    expect(waitlisted.status).toBe(403)

    expect(await prisma.courseRating.count()).toBe(0)
  })

  it("shows a teacher only their own offerings' ratings, with real aggregates", async () => {
    const fixture = await createSpineFixture(prisma)
    const ownOfferingId = fixture.offering.id
    const ownStudentId = fixture.student.studentProfile!.id
    await prisma.courseOffering.update({
      where: { id: ownOfferingId },
      data: { endsOn: COMPLETED },
    })
    await enroll(ownStudentId, ownOfferingId)

    // A second student on the same offering, and a second teacher with their
    // own offering + rating that must never leak into the first teacher's view.
    const otherStudent = await prisma.user.create({
      data: {
        email: "second-student@spine.test",
        passwordHash: "test-only-not-a-real-hash",
        role: "STUDENT",
        studentProfile: {
          create: { fullName: "Second Student", registerNumber: "REG-TEST-SECOND" },
        },
      },
      include: { studentProfile: true },
    })
    await enroll(otherStudent.studentProfile!.id, ownOfferingId)

    const otherTeacher = await prisma.user.create({
      data: {
        email: "other-teacher@spine.test",
        passwordHash: "test-only-not-a-real-hash",
        role: "TEACHER",
        staffProfile: { create: { fullName: "Otto Other", empId: "EMP-TEST-OTHER" } },
      },
      include: { staffProfile: true },
    })
    const otherOffering = await prisma.courseOffering.create({
      data: {
        courseId: fixture.course.id,
        classId: fixture.classroom.id,
        teacherId: otherTeacher.staffProfile!.id,
        term: "Term-Other",
        academicYear: 2026,
        endsOn: COMPLETED,
      },
    })
    await enroll(otherStudent.studentProfile!.id, otherOffering.id)

    await prisma.courseRating.createMany({
      data: [
        { offeringId: ownOfferingId, studentId: ownStudentId, rating: 5, comment: "Loved it" },
        {
          offeringId: ownOfferingId,
          studentId: otherStudent.studentProfile!.id,
          rating: 3,
        },
        {
          offeringId: otherOffering.id,
          studentId: otherStudent.studentProfile!.id,
          rating: 1,
          comment: "NOT MINE",
        },
      ],
    })

    useSession({ id: fixture.teacher.id, email: fixture.teacher.email, role: "teacher" })
    const response = await teacherRatingsReport()
    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      offerings: { offeringId: string; ratingsCount: number; averageRating: number | null }[]
    }

    expect(body.offerings.map((offering) => offering.offeringId)).toEqual([ownOfferingId])

    const own = body.offerings[0]
    expect(own.ratingsCount).toBe(2)
    expect(own.averageRating).toBe(4)

    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain(otherOffering.id)
    expect(serialized).not.toContain("NOT MINE")
  })
})
