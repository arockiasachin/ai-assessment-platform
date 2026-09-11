import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Seat-capacity race regression for course enrollment.
 *
 * The route reads the offering's active enrollment count and then writes the new
 * enrollment as two separate statements. Two students racing for the last seat
 * can both observe the seat as free and both be activated, over-enrolling the
 * offering beyond `studentLimit`. This test drives two concurrent requests
 * through the real route handler and asserts the server keeps the invariant
 * (exactly `studentLimit` active enrollments, the loser waitlisted).
 */
const mocks = vi.hoisted(() => ({ getCookies: vi.fn() }))

vi.mock("next/headers", () => ({
  cookies: () => mocks.getCookies(),
}))

import { POST } from "@/app/api/student/courses/enroll/route"
import { signSessionValue } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

function enrollRequest(offeringId: string) {
  return new Request("https://app.test/api/student/courses/enroll", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ offeringId }),
  })
}

describe("course enrollment capacity race", () => {
  beforeEach(async () => {
    await truncateAll()
    mocks.getCookies.mockReset()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("never activates more students than the seat limit under concurrency", async () => {
    const fixture = await createSpineFixture(prisma)

    // A capacity-1 offering both students are eligible for.
    await prisma.courseOffering.update({
      where: { id: fixture.offering.id },
      data: { studentLimit: 1 },
    })

    const secondStudent = await prisma.user.create({
      data: {
        email: "race-second-student@test.local",
        passwordHash: "test-only-not-a-real-hash",
        role: "STUDENT",
        studentProfile: {
          create: { fullName: "Race Student Two", registerNumber: "REG-RACE-2" },
        },
      },
      include: { studentProfile: true },
    })

    const cookies = [
      signSessionValue({
        id: fixture.student.id,
        email: fixture.student.email,
        role: "student",
      }),
      signSessionValue({
        id: secondStudent.id,
        email: secondStudent.email,
        role: "student",
      }),
    ]

    // Each handler reads the session cookie exactly once; hand out a distinct
    // signed session per invocation so both students race for the same seat.
    const queue = [...cookies]
    mocks.getCookies.mockImplementation(() =>
      Promise.resolve({
        get: () => ({ name: "auth-user", value: queue.shift() }),
      }),
    )

    const [first, second] = await Promise.all([
      POST(enrollRequest(fixture.offering.id)),
      POST(enrollRequest(fixture.offering.id)),
    ])

    expect([first.status, second.status]).toEqual([200, 200])

    const active = await prisma.enrollment.count({
      where: { offeringId: fixture.offering.id, status: "active" },
    })
    const waitlisted = await prisma.enrollment.count({
      where: { offeringId: fixture.offering.id, status: "waitlisted" },
    })

    expect(active).toBe(1)
    expect(waitlisted).toBe(1)
  })
})
