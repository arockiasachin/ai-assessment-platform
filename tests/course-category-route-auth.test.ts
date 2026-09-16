import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Route-level proof that setting a course's grading category enforces its role and its
 * body **before any service or database work**.
 *
 * The service is mocked, so a denial cannot possibly write a category. The session mechanism
 * is a local `useSession` helper matching the other route-auth tests: cookies are mocked, the
 * session value is really signed, and `revalidateSessionActor` is stubbed because these
 * synthetic users have no `User` row.
 */
const mocks = vi.hoisted(() => ({
  setCategory: vi.fn(),
  getCookies: vi.fn(),
}))

vi.mock("@/lib/analytics/course-category", () => ({
  setCourseCategoryForTeacher: mocks.setCategory,
}))

vi.mock("next/headers", () => ({
  cookies: () => mocks.getCookies(),
}))

vi.mock("@/lib/authz-actor", () => ({
  revalidateSessionActor: (user: unknown) => Promise.resolve(user),
}))

import { PATCH } from "@/app/api/teacher/courses/[courseId]/category/route"
import { signSessionValue } from "@/lib/session"

const ADMIN = { id: "admin-1", email: "admin@test.local", role: "admin" as const }
const TEACHER = { id: "teacher-1", email: "teacher@test.local", role: "teacher" as const }
const STUDENT = { id: "student-1", email: "student@test.local", role: "student" as const }

function useSession(user: typeof ADMIN | typeof TEACHER | typeof STUDENT | null) {
  mocks.getCookies.mockReturnValue({
    get: () => (user ? { name: "auth-user", value: signSessionValue(user) } : undefined),
  })
}

function setCategory(body: unknown, courseId = "c1", raw = false) {
  return PATCH(
    new Request("https://app.test/api/teacher/courses/c1/category", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: raw ? (body as string) : JSON.stringify(body),
    }),
    { params: Promise.resolve({ courseId }) },
  )
}

describe("PATCH /api/teacher/courses/[courseId]/category", () => {
  beforeEach(() => {
    mocks.setCategory.mockReset()
    mocks.getCookies.mockReset()
  })

  it("rejects anonymous, student and admin callers before the service runs", async () => {
    useSession(null)
    expect((await setCategory({ category: "THEORY" })).status).toBe(401)

    useSession(STUDENT)
    expect((await setCategory({ category: "THEORY" })).status).toBe(403)

    useSession(ADMIN)
    expect((await setCategory({ category: "THEORY" })).status).toBe(403)

    expect(mocks.setCategory).not.toHaveBeenCalled()
  })

  it("rejects an unknown category without touching the service", async () => {
    useSession(TEACHER)
    expect((await setCategory({ category: "NOT_A_CATEGORY" })).status).toBe(400)
    expect(mocks.setCategory).not.toHaveBeenCalled()
  })

  it("rejects a malformed body without touching the service", async () => {
    useSession(TEACHER)
    expect((await setCategory("{not json", "c1", true)).status).toBe(400)
    expect((await setCategory({})).status).toBe(400)
    expect(mocks.setCategory).not.toHaveBeenCalled()
  })

  it("refuses to clear the category by omission", async () => {
    // `null` is not accepted, so a client that never knew about the field cannot wipe it by
    // leaving the key out.
    useSession(TEACHER)
    expect((await setCategory({ category: null })).status).toBe(400)
    expect(mocks.setCategory).not.toHaveBeenCalled()
  })

  it("passes an authorized request through and reports the grading effect", async () => {
    useSession(TEACHER)
    mocks.setCategory.mockResolvedValue({
      kind: "updated",
      courseId: "c42",
      category: "LABORATORY",
      gradingEffect: "Absolute bands apply at any class size.",
    })

    const response = await setCategory({ category: "LABORATORY" }, "c42")
    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      success: boolean
      courseId: string
      category: string
      gradingEffect: string
    }
    expect(body.success).toBe(true)
    expect(body.courseId).toBe("c42")
    expect(body.category).toBe("LABORATORY")
    expect(body.gradingEffect).toContain("Absolute")
    expect(mocks.setCategory).toHaveBeenCalledWith(
      { id: "teacher-1", email: "teacher@test.local", role: "teacher" },
      "c42",
      "LABORATORY",
    )
  })

  it("reports a course the caller does not teach as 404", async () => {
    useSession(TEACHER)
    mocks.setCategory.mockResolvedValue({ kind: "not-found" })
    expect((await setCategory({ category: "THEORY" }, "someone-elses")).status).toBe(404)
  })

  it("surfaces a missing staff profile as 403, not 500", async () => {
    useSession(TEACHER)
    mocks.setCategory.mockRejectedValue(new Error("Teacher profile not found."))
    expect((await setCategory({ category: "THEORY" })).status).toBe(403)
  })

  it("reports an unexpected failure as 500 without leaking it", async () => {
    useSession(TEACHER)
    mocks.setCategory.mockRejectedValue(new Error("connection reset by peer"))
    const response = await setCategory({ category: "THEORY" })
    expect(response.status).toBe(500)
    expect(JSON.stringify(await response.json())).not.toContain("connection reset")
  })
})
