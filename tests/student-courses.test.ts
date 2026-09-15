import { afterAll, beforeEach, describe, expect, it } from "vitest"

import type { AuthUser } from "@/lib/session"
import {
  buildRatingDistribution,
  listStudentCourses,
  registrationStatusFor,
} from "@/lib/student-courses"
import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * The student course catalog.
 *
 * This read path had **no test at all** before the port (it was an inline query
 * in the route handler), so these are the first assertions on it. The
 * db-backed cases cover the invariants the port must not regress:
 *
 * - a course with no ratings reports `averageRating: null`, **never `0`** — it
 *   renders as `—`, because "not rated yet" and "rated zero" are different facts;
 * - the rating distribution is the new aggregate D7 allows, and it is
 *   aggregate-only: no rater identity reaches the payload.
 */

const PAST = new Date("2026-01-01T00:00:00.000Z")
const FUTURE = new Date("2099-01-01T00:00:00.000Z")

function studentActor(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "student" }
}

async function createPeer(name: string) {
  return prisma.user.create({
    data: {
      email: `${name.toLowerCase()}@spine.test`,
      passwordHash: "test-only-not-a-real-hash",
      role: "STUDENT",
      studentProfile: {
        create: { fullName: name, registerNumber: `REG-TEST-${name.toUpperCase()}` },
      },
    },
    include: { studentProfile: true },
  })
}

describe("buildRatingDistribution", () => {
  it("counts per star value, highest first, with all five buckets present", () => {
    expect(buildRatingDistribution([{ rating: 5 }, { rating: 4 }, { rating: 4 }])).toEqual([
      { stars: 5, count: 1 },
      { stars: 4, count: 2 },
      { stars: 3, count: 0 },
      { stars: 2, count: 0 },
      { stars: 1, count: 0 },
    ])
  })

  it("is all zeros — not undefined keys — when there are no ratings", () => {
    expect(buildRatingDistribution([])).toEqual([
      { stars: 5, count: 0 },
      { stars: 4, count: 0 },
      { stars: 3, count: 0 },
      { stars: 2, count: 0 },
      { stars: 1, count: 0 },
    ])
  })
})

describe("registrationStatusFor", () => {
  const base = {
    isEnrolled: false,
    isWaitlisted: false,
    now: new Date("2026-06-01T00:00:00.000Z"),
    registrationOpenAt: new Date("2026-01-01T00:00:00.000Z"),
    registrationCloseAt: new Date("2026-12-01T00:00:00.000Z"),
    enrolledCount: 0,
    studentLimit: 30,
  }

  it("lets an existing enrollment win over capacity and the window", () => {
    expect(
      registrationStatusFor({
        ...base,
        isEnrolled: true,
        enrolledCount: 30,
        registrationCloseAt: new Date("2026-02-01T00:00:00.000Z"),
      }),
    ).toEqual({ status: "enrolled", canRegister: false })
  })

  it("reports a waitlisted student as waitlisted even when the class is full", () => {
    expect(registrationStatusFor({ ...base, isWaitlisted: true, enrolledCount: 30 })).toEqual({
      status: "waitlisted",
      canRegister: false,
    })
  })

  it("reports full before it reports a closed window", () => {
    expect(registrationStatusFor({ ...base, enrolledCount: 30 })).toEqual({
      status: "full",
      canRegister: false,
    })
  })

  it("distinguishes upcoming, closed and open", () => {
    expect(
      registrationStatusFor({ ...base, registrationOpenAt: new Date("2026-09-01T00:00:00.000Z") }),
    ).toEqual({ status: "upcoming", canRegister: false })
    expect(
      registrationStatusFor({ ...base, registrationCloseAt: new Date("2026-02-01T00:00:00.000Z") }),
    ).toEqual({ status: "closed", canRegister: false })
    expect(registrationStatusFor(base)).toEqual({ status: "open", canRegister: true })
  })
})

describe("listStudentCourses (database-backed)", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("returns null for a user with no student profile", async () => {
    const user = await prisma.user.create({
      data: {
        email: "not-a-student@spine.test",
        passwordHash: "test-only-not-a-real-hash",
        role: "STUDENT",
      },
    })

    expect(await listStudentCourses(studentActor(user))).toBeNull()
  })

  it("reports a null average — not zero — for a course nobody has rated", async () => {
    const fixture = await createSpineFixture(prisma)
    await prisma.enrollment.create({
      data: { studentId: fixture.student.studentProfile!.id, offeringId: fixture.offering.id },
    })

    const payload = await listStudentCourses(studentActor(fixture.student))
    const course = payload!.offeredCourses[0]

    expect(course.ratingsCount).toBe(0)
    expect(course.averageRating).toBeNull()
    expect(course.averageRating).not.toBe(0)
    expect(course.studentRating).toBeNull()
    expect(course.ratingDistribution.every((bucket) => bucket.count === 0)).toBe(true)
  })

  it("aggregates the average and distribution, exposes only the caller's own row, and leaks no rater identity", async () => {
    const fixture = await createSpineFixture(prisma)
    const peer = await createPeer("Peer")
    const ownProfileId = fixture.student.studentProfile!.id
    const peerProfileId = peer.studentProfile!.id

    await prisma.enrollment.createMany({
      data: [
        { studentId: ownProfileId, offeringId: fixture.offering.id, status: "active" },
        { studentId: peerProfileId, offeringId: fixture.offering.id, status: "active" },
      ],
    })
    await prisma.courseRating.createMany({
      data: [
        {
          offeringId: fixture.offering.id,
          studentId: ownProfileId,
          rating: 4,
          comment: "MY-OWN-COMMENT",
        },
        {
          offeringId: fixture.offering.id,
          studentId: peerProfileId,
          rating: 5,
          comment: "PEER-ONLY-COMMENT",
        },
      ],
    })

    const payload = await listStudentCourses(studentActor(fixture.student))
    const course = payload!.offeredCourses[0]

    expect(course.ratingsCount).toBe(2)
    expect(course.averageRating).toBe(4.5)
    expect(course.ratingDistribution).toEqual([
      { stars: 5, count: 1 },
      { stars: 4, count: 1 },
      { stars: 3, count: 0 },
      { stars: 2, count: 0 },
      { stars: 1, count: 0 },
    ])

    // The caller's own rating and comment are theirs to see...
    expect(course.studentRating).toBe(4)
    expect(course.studentRatingComment).toBe("MY-OWN-COMMENT")

    // ...but the peer's identity and words are not in the payload at all (D7).
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain("PEER-ONLY-COMMENT")
    expect(serialized).not.toContain(peerProfileId)
    expect(serialized).not.toContain(peer.id)
    expect(serialized).not.toContain(peer.email)
  })

  it("splits registered offerings from the rest and marks completion from the end date", async () => {
    const fixture = await createSpineFixture(prisma)
    await prisma.enrollment.create({
      data: { studentId: fixture.student.studentProfile!.id, offeringId: fixture.offering.id },
    })
    await prisma.courseOffering.update({
      where: { id: fixture.offering.id },
      data: { endsOn: PAST, registrationCloseAt: FUTURE },
    })

    const payload = await listStudentCourses(studentActor(fixture.student))

    expect(payload!.enrolledCourses).toHaveLength(1)
    expect(payload!.offeredCourses).toHaveLength(1)
    expect(payload!.enrolledCourses[0].isCompleted).toBe(true)
    expect(payload!.enrolledCourses[0].registrationStatus).toBe("enrolled")
  })
})
