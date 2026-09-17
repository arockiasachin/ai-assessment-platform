import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * TN-69, at the HTTP boundary: a teacher probing another teacher's real
 * assessment id must receive exactly what they receive for an id that does not
 * exist — the same status *and* the same body.
 *
 * `tests/gradebook-marks.test.ts` pins the service; this test exercises the real
 * route against the real database (only the session plumbing is mocked, as in the
 * other route tests), so the status the client actually sees is asserted rather
 * than inferred from an error message.
 */
const mocks = vi.hoisted(() => ({
  getCookies: vi.fn(),
}))

vi.mock("next/headers", () => ({
  cookies: () => mocks.getCookies(),
}))

// Synthetic sessions would have no `User` row; the real database re-validation is
// covered by `tests/session-role-revalidation.test.ts`. Here the actors are real
// rows so the service's ownership lookup runs for real.
vi.mock("@/lib/authz-actor", () => ({
  revalidateSessionActor: (user: unknown) => Promise.resolve(user),
}))

import { POST } from "@/app/api/gradebook/marks/route"
import { signSessionValue } from "@/lib/session"
import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

function useSession(user: { id: string; email: string; role: string }) {
  mocks.getCookies.mockReturnValue({
    get: () => ({ name: "auth-user", value: signSessionValue(user as never) }),
  })
}

function markRequest(studentId: string, assessmentId: string, score: number) {
  return POST(
    new Request("https://app.test/api/gradebook/marks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ studentId, assessmentId, score }),
    }),
  )
}

describe("POST /api/gradebook/marks — a foreign assessment is indistinguishable from a missing one (TN-69)", () => {
  beforeEach(async () => {
    await truncateAll()
    mocks.getCookies.mockReset()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("returns the identical status and body for another teacher's assessment and a nonexistent id", async () => {
    const f = await createSpineFixture(prisma)
    // A real second teacher — the caller. `f.assessment` belongs to `f.teacher`.
    const other = await prisma.user.create({
      data: {
        email: "marks-route-other@spine.test",
        passwordHash: "test-only-not-a-real-hash",
        role: "TEACHER",
        staffProfile: { create: { fullName: "Otto Teacher", empId: "EMP-MARKS-ROUTE" } },
      },
      include: { staffProfile: true },
    })
    useSession({ id: other.id, email: other.email, role: "teacher" })

    // Deliberately not enrolled: before the fix this returned 400 "Student not
    // enrolled in assessment offering" for the foreign id and 404 for the
    // missing one, which is exactly the oracle.
    const studentId = f.student.studentProfile!.id
    const foreign = await markRequest(studentId, f.assessment.id, 5)
    const missing = await markRequest(studentId, "no-such-assessment", 5)

    const foreignBody = await foreign.json()
    const missingBody = await missing.json()

    expect(foreign.status, `foreign body: ${JSON.stringify(foreignBody)}`).toBe(404)
    expect(missing.status, `missing body: ${JSON.stringify(missingBody)}`).toBe(404)
    expect(foreignBody).toEqual(missingBody)
    expect(foreignBody).toEqual({ success: false, message: "Assessment not found" })
  })

  it("still writes a mark for an assessment the caller owns", async () => {
    const f = await createSpineFixture(prisma)
    const studentId = f.student.studentProfile!.id
    await prisma.enrollment.create({
      data: { studentId, offeringId: f.offering.id, status: "active" },
    })
    useSession({ id: f.teacher.id, email: f.teacher.email, role: "teacher" })

    const response = await markRequest(studentId, f.assessment.id, 12)
    expect(response.status).toBe(200)
    await expect(
      prisma.grade.count({ where: { assessmentId: f.assessment.id, studentId } }),
    ).resolves.toBe(1)
  })
})
