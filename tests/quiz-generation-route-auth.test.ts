import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Route-level proof that students (and anonymous callers) can never reach the
 * quiz-generation endpoint. The service is mocked so a request that should be
 * rejected can be shown to be rejected *before* any generation runs.
 */
const mocks = vi.hoisted(() => ({
  generateQuizDraftsForTeacher: vi.fn(),
  getCookies: vi.fn(),
}))

vi.mock("@/lib/quiz-generation", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/quiz-generation")>("@/lib/quiz-generation")
  return { ...actual, generateQuizDraftsForTeacher: mocks.generateQuizDraftsForTeacher }
})

vi.mock("next/headers", () => ({
  cookies: () => mocks.getCookies(),
}))

import { POST } from "@/app/api/teacher/quiz-generation/route"
import { signSessionValue } from "@/lib/session"

function requestWith(body: Record<string, unknown> = {}) {
  return new Request("https://app.test/api/teacher/quiz-generation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      assessmentId: "assessment-1",
      topic: "photosynthesis",
      questionCount: 2,
      ...body,
    }),
  })
}

function useSession(value: string | null) {
  mocks.getCookies.mockReturnValue({
    get: (name: string) => (value ? { name, value } : undefined),
  })
}

describe("POST /api/teacher/quiz-generation authorization", () => {
  beforeEach(() => {
    mocks.generateQuizDraftsForTeacher.mockReset()
    mocks.getCookies.mockReset()
  })

  it("rejects an anonymous caller", async () => {
    useSession(null)
    const response = await POST(requestWith())
    expect(response.status).toBe(401)
    expect(mocks.generateQuizDraftsForTeacher).not.toHaveBeenCalled()
  })

  it("rejects a student before any generation runs", async () => {
    useSession(signSessionValue({ id: "student-1", email: "student@test.local", role: "student" }))
    const response = await POST(requestWith())
    expect(response.status).toBe(403)
    expect(mocks.generateQuizDraftsForTeacher).not.toHaveBeenCalled()
  })

  it("allows a teacher through to the generation service", async () => {
    mocks.generateQuizDraftsForTeacher.mockResolvedValue({
      retrieval: { chunkCount: 0, sourceTitles: [], chunkIds: [] },
      questions: [],
    })
    useSession(signSessionValue({ id: "teacher-1", email: "teacher@test.local", role: "teacher" }))

    const response = await POST(requestWith())
    expect(response.status).toBe(200)
    expect(mocks.generateQuizDraftsForTeacher).toHaveBeenCalledTimes(1)
  })

  it("rejects a malformed body without calling the service", async () => {
    useSession(signSessionValue({ id: "teacher-1", email: "teacher@test.local", role: "teacher" }))
    const response = await POST(
      new Request("https://app.test/api/teacher/quiz-generation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assessmentId: "assessment-1" }),
      }),
    )
    expect(response.status).toBe(400)
    expect(mocks.generateQuizDraftsForTeacher).not.toHaveBeenCalled()
  })
})
