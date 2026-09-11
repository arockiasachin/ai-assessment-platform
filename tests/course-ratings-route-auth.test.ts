import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Route-level proof that the course-rating endpoints enforce their roles and
 * contracts before the data layer runs. The service is mocked, so a denial can
 * never touch the database.
 */
const mocks = vi.hoisted(() => ({
  submitCourseRating: vi.fn(),
  getTeacherRatingsReport: vi.fn(),
  getCookies: vi.fn(),
}))

vi.mock("@/lib/course-ratings", () => ({
  submitCourseRating: mocks.submitCourseRating,
  getTeacherRatingsReport: mocks.getTeacherRatingsReport,
}))

vi.mock("next/headers", () => ({
  cookies: () => mocks.getCookies(),
}))

// Synthetic sessions with no User row: the database re-validation is covered by
// the database-backed `course-ratings.test.ts`.
vi.mock("@/lib/authz-actor", () => ({
  revalidateSessionActor: (user: unknown) => Promise.resolve(user),
}))

import { GET as teacherRatingsReport } from "@/app/api/teacher/reports/ratings/route"
import { POST as rateCourse } from "@/app/api/student/courses/rating/route"
import { signSessionValue } from "@/lib/session"

const STUDENT = { id: "student-1", email: "student@test.local", role: "student" as const }
const TEACHER = { id: "teacher-1", email: "teacher@test.local", role: "teacher" as const }

function useSession(user: typeof STUDENT | typeof TEACHER | null) {
  mocks.getCookies.mockResolvedValue({
    get: () => (user ? { value: signSessionValue(user) } : undefined),
  })
}

function postRating(body: unknown) {
  return rateCourse(
    new Request("https://app.test/api/student/courses/rating", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
}

describe("course rating route authorization", () => {
  beforeEach(() => {
    mocks.submitCourseRating.mockReset()
    mocks.getTeacherRatingsReport.mockReset()
    mocks.getCookies.mockReset()
  })

  it("rejects anonymous callers before the service runs", async () => {
    useSession(null)

    expect((await postRating({ offeringId: "o1", rating: 4 })).status).toBe(401)
    expect((await teacherRatingsReport()).status).toBe(401)
    expect(mocks.submitCourseRating).not.toHaveBeenCalled()
    expect(mocks.getTeacherRatingsReport).not.toHaveBeenCalled()
  })

  it("rejects the wrong role on each endpoint", async () => {
    useSession(STUDENT)
    expect((await teacherRatingsReport()).status).toBe(403)

    useSession(TEACHER)
    expect((await postRating({ offeringId: "o1", rating: 4 })).status).toBe(403)

    expect(mocks.submitCourseRating).not.toHaveBeenCalled()
    expect(mocks.getTeacherRatingsReport).not.toHaveBeenCalled()
  })

  it("rejects a rating outside the 1-5 range without calling the service", async () => {
    useSession(STUDENT)

    expect((await postRating({ offeringId: "o1", rating: 0 })).status).toBe(400)
    expect((await postRating({ offeringId: "o1", rating: 6 })).status).toBe(400)
    expect((await postRating({ offeringId: "o1", rating: 3.5 })).status).toBe(400)
    expect((await postRating({ offeringId: "", rating: 4 })).status).toBe(400)

    expect(mocks.submitCourseRating).not.toHaveBeenCalled()
  })

  it("passes an authorized request through to the service", async () => {
    useSession(STUDENT)
    mocks.submitCourseRating.mockResolvedValue({ kind: "rated", courseName: "Algorithms" })

    const rated = await postRating({ offeringId: "o1", rating: 4, comment: "nice" })
    expect(rated.status).toBe(200)
    expect(mocks.submitCourseRating).toHaveBeenCalledTimes(1)

    useSession(TEACHER)
    mocks.getTeacherRatingsReport.mockResolvedValue([])
    const report = await teacherRatingsReport()
    expect(report.status).toBe(200)
    expect(mocks.getTeacherRatingsReport).toHaveBeenCalledTimes(1)
  })
})
