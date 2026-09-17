import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getRecentGradeActivityForTeacher: vi.fn(),
  getCookies: vi.fn(),
}))

vi.mock("@/lib/observability/audit-view", () => ({
  getRecentGradeActivityForTeacher: mocks.getRecentGradeActivityForTeacher,
}))

vi.mock("next/headers", () => ({
  cookies: () => mocks.getCookies(),
}))

// These route tests use synthetic sessions that have no User row; the real
// database re-validation is covered by tests/session-role-revalidation.test.ts.
vi.mock("@/lib/authz-actor", () => ({
  revalidateSessionActor: (user: unknown) => Promise.resolve(user),
}))

import { GET } from "@/app/api/teacher/observability/grade-activity/route"
import { signSessionValue } from "@/lib/session"

const TEACHER = { id: "teacher-1", email: "teacher@test.local", role: "teacher" as const }
const STUDENT = { id: "student-1", email: "student@test.local", role: "student" as const }

function useSession(user: typeof TEACHER | typeof STUDENT | null) {
  mocks.getCookies.mockReturnValue({
    get: () => (user ? { name: "auth-user", value: signSessionValue(user) } : undefined),
  })
}

function call(query = "") {
  return GET(
    new Request(`https://app.test/api/teacher/observability/grade-activity${query}`),
    undefined,
  )
}

describe("GET /api/teacher/observability/grade-activity", () => {
  beforeEach(() => {
    mocks.getRecentGradeActivityForTeacher.mockReset()
    mocks.getCookies.mockReset()
  })

  it("rejects anonymous and student callers before the service runs", async () => {
    useSession(null)
    expect((await call("?offeringId=o1")).status).toBe(401)

    useSession(STUDENT)
    expect((await call("?offeringId=o1")).status).toBe(403)
    expect(mocks.getRecentGradeActivityForTeacher).not.toHaveBeenCalled()
  })

  it("rejects a request without an offeringId", async () => {
    useSession(TEACHER)
    expect((await call()).status).toBe(400)
    expect((await call("?offeringId=o1&limit=1000")).status).toBe(400)
    expect(mocks.getRecentGradeActivityForTeacher).not.toHaveBeenCalled()
  })

  it("passes an authorized request to the scoped service", async () => {
    useSession(TEACHER)
    mocks.getRecentGradeActivityForTeacher.mockResolvedValue({
      offeringId: "o1",
      items: [],
      truncated: false,
      total: 0,
    })

    const response = await call("?offeringId=o1")
    expect(response.status).toBe(200)
    const body = (await response.json()) as { success: boolean; offeringId: string }
    expect(body).toEqual({ success: true, offeringId: "o1", items: [], truncated: false, total: 0 })
    expect(mocks.getRecentGradeActivityForTeacher).toHaveBeenCalledWith(
      { id: "teacher-1", email: "teacher@test.local", role: "teacher" },
      // `offset` defaults to 0 in `gradeActivityQuerySchema`, so the page reader can
      // page the log (TN-17) without every caller having to pass it.
      { offeringId: "o1", limit: 25, offset: 0 },
    )
  })

  it("maps a scoping failure from the service to its status", async () => {
    useSession(TEACHER)
    const { ObservabilityError } = await import("@/lib/observability/errors")
    mocks.getRecentGradeActivityForTeacher.mockRejectedValue(
      new ObservabilityError(403, "Forbidden"),
    )

    const response = await call("?offeringId=o1")
    expect(response.status).toBe(403)
    const body = (await response.json()) as { message: string }
    expect(body.message).toBe("Forbidden")
  })
})
