import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Route-level proof that the student self-grading hole is closed. The marks
 * handler is exercised directly with a mocked cookie store and a mocked data
 * layer, so a student session can be shown to be rejected *before* any mark is
 * written.
 */
const mocks = vi.hoisted(() => ({
  upsertAssessmentGrade: vi.fn(),
  getCookies: vi.fn(),
}))

vi.mock("@/lib/gradebook-db", () => ({
  upsertAssessmentGrade: mocks.upsertAssessmentGrade,
}))

vi.mock("next/headers", () => ({
  cookies: () => mocks.getCookies(),
}))

import { signSessionValue } from "@/lib/session"
import { POST } from "@/app/api/gradebook/marks/route"

function requestWith(studentId: string, score: number) {
  return new Request("https://app.test/api/gradebook/marks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ studentId, assessmentId: "assessment-1", score }),
  })
}

function useSession(value: string | null) {
  mocks.getCookies.mockResolvedValue({
    get: (name: string) => (value ? { name, value } : undefined),
  })
}

describe("POST /api/gradebook/marks authorization", () => {
  beforeEach(() => {
    mocks.upsertAssessmentGrade.mockReset()
    mocks.getCookies.mockReset()
  })

  it("rejects an unsigned forged admin cookie before writing", async () => {
    const forged = JSON.stringify({
      user: { id: "attacker", email: "attacker@test.local", role: "admin" },
      expiresAt: Date.now() + 60_000,
    })
    useSession(forged)

    const response = await POST(requestWith("attacker", 100))

    expect(response.status).toBe(401)
    expect(mocks.upsertAssessmentGrade).not.toHaveBeenCalled()
  })

  it("rejects a student trying to write their own mark", async () => {
    const studentSession = signSessionValue({
      id: "student-1",
      email: "student@test.local",
      role: "student",
    })
    useSession(studentSession)

    const response = await POST(requestWith("student-1", 100))
    const body = (await response.json()) as { success: boolean; message: string }

    expect(response.status).toBe(403)
    expect(body.success).toBe(false)
    expect(mocks.upsertAssessmentGrade).not.toHaveBeenCalled()
  })

  it("allows an authenticated teacher to write a mark", async () => {
    mocks.upsertAssessmentGrade.mockResolvedValue(undefined)
    useSession(signSessionValue({ id: "teacher-1", email: "teacher@test.local", role: "teacher" }))

    const response = await POST(requestWith("student-1", 42))

    expect(response.status).toBe(200)
    expect(mocks.upsertAssessmentGrade).toHaveBeenCalledTimes(1)
    expect(mocks.upsertAssessmentGrade).toHaveBeenCalledWith(
      { studentId: "student-1", assessmentId: "assessment-1", score: 42 },
      expect.objectContaining({ id: "teacher-1", role: "teacher" }),
    )
  })

  it("rejects a malformed body without calling the data layer", async () => {
    useSession(signSessionValue({ id: "teacher-1", email: "teacher@test.local", role: "teacher" }))

    const response = await POST(
      new Request("https://app.test/api/gradebook/marks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assessmentId: "assessment-1" }),
      }),
    )

    expect(response.status).toBe(400)
    expect(mocks.upsertAssessmentGrade).not.toHaveBeenCalled()
  })
})
