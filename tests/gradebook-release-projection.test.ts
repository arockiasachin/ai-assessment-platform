import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { getGradebookPayloadForSessionUser } from "@/lib/gradebook-db"
import type { AuthUser } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * SN-29: the `GradebookProvider` projection is embedded in the RSC payload of every
 * `(dashboard)` route, so an assessment filtered out of the visible table but present in the
 * payload is still readable in the page source. The fix is a projection filter, and these
 * tests assert on the payload itself — not on what a renderer chooses to show.
 */

function studentSession(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "student" }
}

describe("gradebook projection release filter", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("omits an unreleased assessment and its due event from the student payload", async () => {
    const fixture = await createSpineFixture(prisma)
    const studentId = fixture.student.studentProfile!.id
    await prisma.enrollment.create({
      data: { studentId, offeringId: fixture.offering.id, status: "active" },
    })

    // The fixture assessment becomes the released one.
    await prisma.assessment.update({
      where: { id: fixture.assessment.id },
      data: { releasedAt: new Date("2026-09-01T00:00:00.000Z") },
    })
    const releasedTitle = fixture.assessment.title

    const unreleased = await prisma.assessment.create({
      data: {
        offeringId: fixture.offering.id,
        courseId: fixture.course.id,
        classId: fixture.classroom.id,
        title: "Secret group project",
        type: "GROUP_PROJECT",
        dueDate: new Date("2026-12-01T08:00:00.000Z"),
        maxMarks: 20,
        createdById: fixture.teacher.staffProfile!.id,
        releasedAt: null,
      },
    })

    // Both have calendar events; the unreleased one's must not travel either.
    for (const assessment of [fixture.assessment, unreleased]) {
      await prisma.calendarEvent.create({
        data: {
          classId: fixture.classroom.id,
          offeringId: fixture.offering.id,
          assessmentId: assessment.id,
          title: assessment.title,
          description: `Due: ${assessment.title}`,
          eventType: "ASSESSMENT",
          startAt: assessment.dueDate,
          isUpcoming: true,
        },
      })
    }

    const payload = await getGradebookPayloadForSessionUser(studentSession(fixture.student))

    expect(payload.assessments.map((assessment) => assessment.id)).toContain(fixture.assessment.id)
    expect(payload.assessments.map((assessment) => assessment.id)).not.toContain(unreleased.id)
    expect(payload.upcomingEvents.map((event) => event.assessmentId)).not.toContain(unreleased.id)

    // The whole payload, as the page source would serialize it, names nothing unreleased.
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain(unreleased.id)
    expect(serialized).not.toContain("Secret group project")
    expect(serialized).toContain(releasedTitle)
  })

  it("still leaves an unreleased assessment visible to its teacher", async () => {
    const fixture = await createSpineFixture(prisma)
    const unreleased = await prisma.assessment.create({
      data: {
        offeringId: fixture.offering.id,
        courseId: fixture.course.id,
        classId: fixture.classroom.id,
        title: "Teacher-only draft",
        type: "ASSIGNMENT",
        dueDate: new Date("2026-12-01T08:00:00.000Z"),
        maxMarks: 20,
        createdById: fixture.teacher.staffProfile!.id,
        releasedAt: null,
      },
    })

    const teacherPayload = await getGradebookPayloadForSessionUser({
      id: fixture.teacher.id,
      email: fixture.teacher.email,
      role: "teacher",
    })
    expect(teacherPayload.assessments.map((assessment) => assessment.id)).toContain(unreleased.id)
  })

  it("scopes a dropped or withdrawn student out of the payload (SN-37)", async () => {
    // `bda.student31` had 0 active enrolments yet still received the course, the assessment
    // titles and the class averages, because the enrollment include applied no status filter.
    const fixture = await createSpineFixture(prisma)
    const studentId = fixture.student.studentProfile!.id
    await prisma.assessment.update({
      where: { id: fixture.assessment.id },
      data: { releasedAt: new Date("2026-09-01T00:00:00.000Z") },
    })

    const enrollment = await prisma.enrollment.create({
      data: { studentId, offeringId: fixture.offering.id, status: "active" },
    })
    const active = await getGradebookPayloadForSessionUser(studentSession(fixture.student))
    expect(active.assessments.map((assessment) => assessment.id)).toContain(fixture.assessment.id)

    await prisma.enrollment.update({ where: { id: enrollment.id }, data: { status: "dropped" } })
    const dropped = await getGradebookPayloadForSessionUser(studentSession(fixture.student))

    expect(dropped.assessments).toEqual([])
    expect(dropped.courses).toEqual([])
    expect(JSON.stringify(dropped)).not.toContain(fixture.course.code)
  })
})
