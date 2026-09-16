import { beforeAll, describe, expect, it } from "vitest"

import { releaseAssessment } from "@/lib/assessment-release"
import type { AuthUser } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * The assessment-release write path, against a real database.
 *
 * What matters here is not that a timestamp gets written — it is that releasing
 * stays a *single, bounded* fact:
 *
 * - one audit row, written in the same transaction;
 * - a repeat release does not move the instant (otherwise a double click silently
 *   changes when students first saw an assessment);
 * - a foreign assessment is indistinguishable from a missing one;
 * - and releasing does **not** touch either of the two neighbouring publish facts
 *   (`CourseOffering.resultsPublishedAt`, `Grade.publishedAt`). That last one is
 *   the trap this whole slice exists to avoid, so it is asserted rather than
 *   assumed.
 */

let f: Awaited<ReturnType<typeof createSpineFixture>>
let teacher: AuthUser
let intruder: AuthUser
let noProfile: AuthUser

beforeAll(async () => {
  await truncateAll()
  f = await createSpineFixture(prisma)

  teacher = { id: f.teacher.id, email: f.teacher.email, role: "teacher" }

  // A second teacher with a staff profile who owns nothing here.
  const other = await prisma.user.create({
    data: {
      email: "intruder@spine.test",
      passwordHash: "test-only-not-a-real-hash",
      role: "TEACHER",
      staffProfile: { create: { fullName: "Ivan Intruder", empId: "EMP-TEST-INTRUDER" } },
    },
    select: { id: true, email: true },
  })
  intruder = { id: other.id, email: other.email, role: "teacher" }

  // A teacher-shaped user with no staff profile at all.
  const bare = await prisma.user.create({
    data: {
      email: "nostaff@spine.test",
      passwordHash: "test-only-not-a-real-hash",
      role: "TEACHER",
    },
    select: { id: true, email: true },
  })
  noProfile = { id: bare.id, email: bare.email, role: "teacher" }
})

describe("releaseAssessment", () => {
  it("releases an assessment the teacher created, and records the instant", async () => {
    const result = await releaseAssessment(teacher, f.assessment.id)
    expect(result.kind).toBe("released")

    const row = await prisma.assessment.findUniqueOrThrow({
      where: { id: f.assessment.id },
      select: { releasedAt: true },
    })
    expect(row.releasedAt).not.toBeNull()
  })

  it("writes exactly one audit row, attributed to the acting teacher", async () => {
    const audits = await prisma.auditLog.findMany({
      where: { entityType: "Assessment", entityId: f.assessment.id },
    })
    expect(audits).toHaveLength(1)

    const audit = audits[0]
    expect(audit.action).toBe("assessment.released")
    expect(audit.actorId).toBe(f.teacher.id)
    expect(audit.actorRole).toBe("teacher")
    expect(audit.before).toBeNull()
    expect(audit.after).toMatchObject({ releasedAt: expect.any(String) })
  })

  it("does not move the instant on a repeat release, and adds no second audit row", async () => {
    const before = await prisma.assessment.findUniqueOrThrow({
      where: { id: f.assessment.id },
      select: { releasedAt: true },
    })

    const result = await releaseAssessment(teacher, f.assessment.id)
    expect(result.kind).toBe("already-released")

    const after = await prisma.assessment.findUniqueOrThrow({
      where: { id: f.assessment.id },
      select: { releasedAt: true },
    })
    // Not merely "still set": the exact instant must survive a repeat click.
    expect(after.releasedAt?.toISOString()).toBe(before.releasedAt?.toISOString())

    expect(
      await prisma.auditLog.count({
        where: { entityType: "Assessment", entityId: f.assessment.id },
      }),
    ).toBe(1)
  })

  it("reports a foreign assessment as not-found, leaves it untouched, and audits nothing", async () => {
    const otherAssessment = await createAssessmentOnOwnOffering()

    const result = await releaseAssessment(intruder, otherAssessment.id)
    expect(result.kind).toBe("not-found")

    const row = await prisma.assessment.findUniqueOrThrow({
      where: { id: otherAssessment.id },
      select: { releasedAt: true },
    })
    expect(row.releasedAt).toBeNull()
    expect(await prisma.auditLog.count({ where: { entityId: otherAssessment.id } })).toBe(0)
  })

  it("reports a nonexistent assessment identically to a foreign one", async () => {
    // Same verdict, so the endpoint cannot be used to probe which ids exist.
    expect((await releaseAssessment(teacher, "assessment-does-not-exist")).kind).toBe("not-found")
    expect((await releaseAssessment(intruder, "assessment-does-not-exist")).kind).toBe("not-found")
  })

  it("grants ownership through the offering's teacher, not only the creator", async () => {
    // A colleague's assessment on the teacher's own offering. The rule is
    // "created it OR teach its offering", so this must succeed.
    const colleague = await prisma.user.create({
      data: {
        email: "colleague@spine.test",
        passwordHash: "test-only-not-a-real-hash",
        role: "TEACHER",
        staffProfile: { create: { fullName: "Cal Colleague", empId: "EMP-TEST-COLLEAGUE" } },
      },
      include: { staffProfile: true },
    })

    const assessment = await prisma.assessment.create({
      data: {
        offeringId: f.offering.id,
        courseId: f.course.id,
        classId: f.classroom.id,
        title: "Colleague's quiz on my offering",
        type: "QUIZ",
        dueDate: new Date("2026-10-05T08:00:00.000Z"),
        maxMarks: 10,
        createdById: colleague.staffProfile!.id,
      },
    })

    const result = await releaseAssessment(teacher, assessment.id)
    expect(result.kind).toBe("released")
  })

  it("refuses when the actor has no staff profile", async () => {
    expect((await releaseAssessment(noProfile, f.assessment.id)).kind).toBe("staff-profile-missing")
  })

  it("leaves both neighbouring publish facts alone", async () => {
    // The trap this slice exists to avoid: releasing an assessment is not
    // publishing results (the retention anchor) and not releasing a mark.
    expect(await prisma.grade.count({ where: { assessmentId: f.assessment.id } })).toBe(0)

    const offering = await prisma.courseOffering.findUniqueOrThrow({
      where: { id: f.offering.id },
      select: { resultsPublishedAt: true },
    })
    expect(offering.resultsPublishedAt).toBeNull()
  })

  it("stamps the instant once under two concurrent releases", async () => {
    const assessment = await createAssessmentOnOwnOffering()

    const [first, second] = await Promise.all([
      releaseAssessment(teacher, assessment.id),
      releaseAssessment(teacher, assessment.id),
    ])

    // Exactly one wins; the other observes the winner's instant. Whichever order
    // they land in, the two must agree.
    const kinds = [first.kind, second.kind].sort()
    expect(kinds).toEqual(["already-released", "released"])

    const releasedAt = (result: typeof first) =>
      "releasedAt" in result ? result.releasedAt.toISOString() : null
    expect(releasedAt(first)).toBe(releasedAt(second))

    expect(
      await prisma.auditLog.count({
        where: { entityType: "Assessment", entityId: assessment.id },
      }),
    ).toBe(1)
  })
})

/** A fresh assessment on the fixture's offering, so tests do not share state. */
async function createAssessmentOnOwnOffering() {
  return prisma.assessment.create({
    data: {
      offeringId: f.offering.id,
      courseId: f.course.id,
      classId: f.classroom.id,
      title: `Release test ${Math.random().toString(36).slice(2, 8)}`,
      type: "ASSIGNMENT",
      dueDate: new Date("2026-10-09T08:00:00.000Z"),
      maxMarks: 10,
      createdById: f.teacher.staffProfile!.id,
    },
  })
}

describe("cleanup", () => {
  it("disconnects", async () => {
    await disconnectTestDatabase()
  })
})
