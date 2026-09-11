import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Regression coverage for raw database errors leaking through route handlers.
 * An invalid `date`/`maxMarks` used to reach Prisma, and the route echoed the
 * resulting `PrismaClientValidationError` message (schema fragments and internal
 * file paths) back to the caller with a 400.
 */
const mocks = vi.hoisted(() => ({
  createAssessment: vi.fn(),
  getCookies: vi.fn(),
}))

vi.mock("@/lib/gradebook-db", () => ({
  createAssessmentForSessionUser: mocks.createAssessment,
}))

vi.mock("next/headers", () => ({
  cookies: () => mocks.getCookies(),
}))

// These route tests use synthetic sessions that have no User row; the real
// database re-validation is covered by tests/session-role-revalidation.test.ts.
vi.mock("@/lib/authz-actor", () => ({
  revalidateSessionActor: (user: unknown) => Promise.resolve(user),
}))

import { POST } from "@/app/api/gradebook/assessments/route"
import { signSessionValue } from "@/lib/session"

function request(body: Record<string, unknown>) {
  return new Request("https://app.test/api/gradebook/assessments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const validBody = {
  title: "Week 4 Quiz",
  offeringId: "offering-1",
  type: "Quiz",
  date: "2026-12-01",
  maxMarks: 20,
}

function useTeacherSession() {
  mocks.getCookies.mockResolvedValue({
    get: (name: string) => ({
      name,
      value: signSessionValue({ id: "teacher-1", email: "t@test.local", role: "teacher" }),
    }),
  })
}

describe("POST /api/gradebook/assessments error handling", () => {
  beforeEach(() => {
    mocks.createAssessment.mockReset()
    mocks.getCookies.mockReset()
    useTeacherSession()
  })

  it("rejects an invalid date before calling the data layer", async () => {
    const response = await POST(request({ ...validBody, date: "not-a-date" }))
    const body = (await response.json()) as { message: string }

    expect(response.status).toBe(400)
    expect(body.message).toBe("Invalid date.")
    expect(mocks.createAssessment).not.toHaveBeenCalled()
  })

  it("returns a generic 500 for a database error and never echoes its message", async () => {
    mocks.createAssessment.mockRejectedValue(
      Object.assign(
        new Error("Invalid `prisma.assessment.create()` at /Users/secret/internal.ts"),
        {
          name: "PrismaClientValidationError",
        },
      ),
    )

    const response = await POST(request(validBody))
    const body = (await response.json()) as { message: string }

    expect(response.status).toBe(500)
    expect(body.message).toBe("Unable to create assessment.")
    expect(JSON.stringify(body)).not.toContain("secret")
    expect(JSON.stringify(body)).not.toContain("prisma.assessment.create")
  })

  it("surfaces a known domain error with its own status and no leaked internals", async () => {
    mocks.createAssessment.mockRejectedValue(new Error("Offering not found or not owned by you."))

    const response = await POST(request(validBody))
    const body = (await response.json()) as { message: string }

    expect(response.status).toBe(403)
    expect(body.message).toBe("Offering not found or not owned by you.")
  })
})
