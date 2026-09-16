import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Route-level proof that releasing an assessment enforces its role before any
 * service (or database) runs.
 *
 * The service is mocked, so a denial cannot possibly set a release timestamp or
 * write an audit row — the assertions below are about the route's own contract,
 * not about the service's behaviour, which `assessment-release.test.ts` covers
 * against a real database.
 *
 * The session mechanism is a local `useSession` helper, the same shape as
 * `retention-route-auth.test.ts`: `next/headers` cookies are mocked, the session
 * value is really signed with `signSessionValue`, and `revalidateSessionActor` is
 * stubbed because these synthetic users have no `User` row (database
 * re-validation is itself covered by the database-backed tests).
 */
const mocks = vi.hoisted(() => ({
  releaseAssessment: vi.fn(),
  getCookies: vi.fn(),
}))

vi.mock("@/lib/assessment-release", () => ({
  releaseAssessment: mocks.releaseAssessment,
}))

vi.mock("next/headers", () => ({
  cookies: () => mocks.getCookies(),
}))

vi.mock("@/lib/authz-actor", () => ({
  revalidateSessionActor: (user: unknown) => Promise.resolve(user),
}))

import { POST as release } from "@/app/api/teacher/assessments/[assessmentId]/release/route"
import { signSessionValue } from "@/lib/session"

const ADMIN = { id: "admin-1", email: "admin@test.local", role: "admin" as const }
const TEACHER = { id: "teacher-1", email: "teacher@test.local", role: "teacher" as const }
const STUDENT = { id: "student-1", email: "student@test.local", role: "student" as const }

function useSession(user: typeof ADMIN | typeof TEACHER | typeof STUDENT | null) {
  mocks.getCookies.mockReturnValue({
    get: () => (user ? { name: "auth-user", value: signSessionValue(user) } : undefined),
  })
}

function releaseRequest(assessmentId = "a1") {
  return release(new Request("https://app.test/x", { method: "POST" }), {
    params: Promise.resolve({ assessmentId }),
  })
}

describe("POST /api/teacher/assessments/[assessmentId]/release authorization", () => {
  beforeEach(() => {
    mocks.releaseAssessment.mockReset()
    mocks.getCookies.mockReset()
  })

  it("rejects anonymous callers with 401 before the service runs", async () => {
    useSession(null)
    expect((await releaseRequest()).status).toBe(401)
    expect(mocks.releaseAssessment).not.toHaveBeenCalled()
  })

  it("rejects a student with 403 before the service runs", async () => {
    useSession(STUDENT)
    expect((await releaseRequest()).status).toBe(403)
    expect(mocks.releaseAssessment).not.toHaveBeenCalled()
  })

  it("rejects an admin with 403 — releasing is a teacher action, not an admin one", async () => {
    // Worth pinning: "admin can do anything" is an assumption people make, and
    // `requireRole("teacher")` does not grant it.
    useSession(ADMIN)
    expect((await releaseRequest()).status).toBe(403)
    expect(mocks.releaseAssessment).not.toHaveBeenCalled()
  })

  it("passes an authorized request through with the assessment id", async () => {
    useSession(TEACHER)
    mocks.releaseAssessment.mockResolvedValue({
      kind: "released",
      assessmentId: "a42",
      releasedAt: new Date("2026-09-16T10:00:00.000Z"),
    })

    const response = await releaseRequest("a42")
    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      success: boolean
      assessmentId: string
      releasedAt: string
      alreadyReleased: boolean
    }
    expect(body.success).toBe(true)
    expect(body.assessmentId).toBe("a42")
    expect(body.releasedAt).toBe("2026-09-16T10:00:00.000Z")
    expect(body.alreadyReleased).toBe(false)
    expect(mocks.releaseAssessment).toHaveBeenCalledWith(
      { id: "teacher-1", email: "teacher@test.local", role: "teacher" },
      "a42",
    )
  })

  it("reports an already-released assessment as a success, not an error", async () => {
    useSession(TEACHER)
    mocks.releaseAssessment.mockResolvedValue({
      kind: "already-released",
      assessmentId: "a1",
      releasedAt: new Date("2026-09-01T00:00:00.000Z"),
    })

    const response = await releaseRequest()
    expect(response.status).toBe(200)

    const body = (await response.json()) as { alreadyReleased: boolean; releasedAt: string }
    expect(body.alreadyReleased).toBe(true)
    // The original instant must be reported, not a fresh one.
    expect(body.releasedAt).toBe("2026-09-01T00:00:00.000Z")
  })

  it("reports a foreign or missing assessment as 404 without confirming existence", async () => {
    useSession(TEACHER)

    mocks.releaseAssessment.mockResolvedValue({ kind: "not-found" })
    expect((await releaseRequest("someone-elses")).status).toBe(404)

    mocks.releaseAssessment.mockResolvedValue({ kind: "staff-profile-missing" })
    expect((await releaseRequest("a1")).status).toBe(404)
  })
})
