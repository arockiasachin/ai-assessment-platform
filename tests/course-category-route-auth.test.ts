import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Route-level proof that setting a course's grading category is **admin-only**, and that the
 * body is validated **before any service or database work**.
 *
 * The role rule moved with the route: the old `/api/teacher/courses/[courseId]/category` path
 * is deleted rather than re-gated, so a teacher is now refused on the admin path (and the
 * teacher path no longer exists). The service is mocked, so a denial cannot possibly write a
 * category. The session mechanism is a local `useSession` helper matching the other
 * route-auth tests: cookies are mocked, the session value is really signed, and
 * `revalidateSessionActor` is stubbed because these synthetic users have no `User` row.
 */
const mocks = vi.hoisted(() => ({
  setCategory: vi.fn(),
  getCookies: vi.fn(),
}))

vi.mock("@/lib/analytics/course-category", () => ({
  setCourseCategoryForAdmin: mocks.setCategory,
}))

vi.mock("next/headers", () => ({
  cookies: () => mocks.getCookies(),
}))

vi.mock("@/lib/authz-actor", () => ({
  revalidateSessionActor: (user: unknown) => Promise.resolve(user),
}))

import { PATCH } from "@/app/api/admin/courses/[courseId]/category/route"
import { AnalyticsError } from "@/lib/analytics/errors"
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
    new Request("https://app.test/api/admin/courses/c1/category", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: raw ? (body as string) : JSON.stringify(body),
    }),
    { params: Promise.resolve({ courseId }) },
  )
}

describe("PATCH /api/admin/courses/[courseId]/category", () => {
  beforeEach(() => {
    mocks.setCategory.mockReset()
    mocks.getCookies.mockReset()
  })

  it("rejects anonymous, student and teacher callers before the service runs", async () => {
    useSession(null)
    expect((await setCategory({ category: "THEORY" })).status).toBe(401)

    useSession(STUDENT)
    expect((await setCategory({ category: "THEORY" })).status).toBe(403)

    // The role that used to own this write path. The route is admin-only now.
    useSession(TEACHER)
    expect((await setCategory({ category: "THEORY" })).status).toBe(403)

    expect(mocks.setCategory).not.toHaveBeenCalled()
  })

  it("rejects an unknown category without touching the service", async () => {
    useSession(ADMIN)
    expect((await setCategory({ category: "NOT_A_CATEGORY" })).status).toBe(400)
    expect(mocks.setCategory).not.toHaveBeenCalled()
  })

  it("rejects a malformed body without touching the service", async () => {
    useSession(ADMIN)
    expect((await setCategory("{not json", "c1", true)).status).toBe(400)
    expect((await setCategory({})).status).toBe(400)
    expect(mocks.setCategory).not.toHaveBeenCalled()
  })

  it("refuses to clear the category by omission", async () => {
    // `null` is not accepted, so a client that never knew about the field cannot wipe it by
    // leaving the key out.
    useSession(ADMIN)
    expect((await setCategory({ category: null })).status).toBe(400)
    expect(mocks.setCategory).not.toHaveBeenCalled()
  })

  it("passes an authorized admin request through and reports the grading effect", async () => {
    useSession(ADMIN)
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
      { id: "admin-1", email: "admin@test.local", role: "admin" },
      "c42",
      "LABORATORY",
    )
  })

  it("reports a course that does not exist as 404", async () => {
    useSession(ADMIN)
    mocks.setCategory.mockResolvedValue({ kind: "not-found" })
    expect((await setCategory({ category: "THEORY" }, "no-such-course")).status).toBe(404)
  })

  it("maps an analytics error to its own status rather than 500", async () => {
    useSession(ADMIN)
    mocks.setCategory.mockRejectedValue(new AnalyticsError(403, "Forbidden"))
    const response = await setCategory({ category: "THEORY" })
    expect(response.status).toBe(403)
  })

  it("reports an unexpected failure as 500 without leaking it", async () => {
    useSession(ADMIN)
    mocks.setCategory.mockRejectedValue(new Error("connection reset by peer"))
    const response = await setCategory({ category: "THEORY" })
    expect(response.status).toBe(500)
    expect(JSON.stringify(await response.json())).not.toContain("connection reset")
  })
})
