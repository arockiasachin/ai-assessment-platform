import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Route-level authorization for the quiz-attempt endpoints. The services are
 * mocked so a request that should be rejected is shown to be rejected *before*
 * any service runs, and a rejection can never touch the database.
 */
const mocks = vi.hoisted(() => ({
  listStudentQuizzes: vi.fn(),
  listStudentAttempts: vi.fn(),
  startQuizAttempt: vi.fn(),
  getStudentAttempt: vi.fn(),
  submitQuizAttempt: vi.fn(),
  listTeacherAttempts: vi.fn(),
  getTeacherAttempt: vi.fn(),
  getCookies: vi.fn(),
}))

vi.mock("@/lib/quiz-attempts", async () => {
  const actual = await vi.importActual<typeof import("@/lib/quiz-attempts")>("@/lib/quiz-attempts")
  return {
    ...actual,
    listStudentQuizzes: mocks.listStudentQuizzes,
    listStudentAttempts: mocks.listStudentAttempts,
    startQuizAttempt: mocks.startQuizAttempt,
    getStudentAttempt: mocks.getStudentAttempt,
    submitQuizAttempt: mocks.submitQuizAttempt,
    listTeacherAttempts: mocks.listTeacherAttempts,
    getTeacherAttempt: mocks.getTeacherAttempt,
  }
})

vi.mock("next/headers", () => ({
  cookies: () => mocks.getCookies(),
}))

// These route tests use synthetic sessions that have no User row; the real
// database re-validation is covered by tests/session-role-revalidation.test.ts.
vi.mock("@/lib/authz-actor", () => ({
  revalidateSessionActor: (user: unknown) => Promise.resolve(user),
}))

import {
  GET as studentListGet,
  POST as studentStartPost,
} from "@/app/api/student/quiz-attempts/route"
import { GET as studentDetailGet } from "@/app/api/student/quiz-attempts/[attemptId]/route"
import { POST as studentSubmitPost } from "@/app/api/student/quiz-attempts/[attemptId]/submit/route"
import { GET as teacherListGet } from "@/app/api/teacher/quiz-attempts/route"
import { GET as teacherDetailGet } from "@/app/api/teacher/quiz-attempts/[attemptId]/route"
import { signSessionValue } from "@/lib/session"

function useSession(value: string | null) {
  mocks.getCookies.mockReturnValue({
    get: (name: string) => (value ? { name, value } : undefined),
  })
}

const studentCookie = () =>
  signSessionValue({ id: "student-1", email: "student@test.local", role: "student" })
const teacherCookie = () =>
  signSessionValue({ id: "teacher-1", email: "teacher@test.local", role: "teacher" })
const teacherSession = { id: "teacher-1", email: "teacher@test.local", role: "teacher" }
const studentSession = { id: "student-1", email: "student@test.local", role: "student" }

function jsonRequest(url: string, method: string, body?: Record<string, unknown>) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const params = (attemptId: string) => ({ params: Promise.resolve({ attemptId }) })

describe("quiz-attempt route authorization", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.startQuizAttempt.mockResolvedValue({ id: "attempt-1" })
    mocks.getStudentAttempt.mockResolvedValue({ id: "attempt-1" })
    mocks.submitQuizAttempt.mockResolvedValue({ id: "attempt-1" })
    mocks.listStudentQuizzes.mockResolvedValue([])
    mocks.listStudentAttempts.mockResolvedValue([])
    mocks.listTeacherAttempts.mockResolvedValue([])
    mocks.getTeacherAttempt.mockResolvedValue({ attempt: { id: "attempt-1" } })
  })

  it("rejects anonymous callers on every student route", async () => {
    useSession(null)
    expect(
      (await studentListGet(new Request("https://app.test/api/student/quiz-attempts"))).status,
    ).toBe(401)
    expect(
      (
        await studentStartPost(
          jsonRequest("https://app.test/api/student/quiz-attempts", "POST", { assessmentId: "a1" }),
        )
      ).status,
    ).toBe(401)
    expect(
      (
        await studentDetailGet(
          new Request("https://app.test/api/student/quiz-attempts/x"),
          params("x"),
        )
      ).status,
    ).toBe(401)
    expect(
      (
        await studentSubmitPost(
          jsonRequest("https://app.test/api/student/quiz-attempts/x/submit", "POST", {
            answers: [{ questionId: "q1", selectedIndex: 0 }],
          }),
          params("x"),
        )
      ).status,
    ).toBe(401)
    expect(mocks.startQuizAttempt).not.toHaveBeenCalled()
  })

  it("rejects a teacher on student routes before any service runs", async () => {
    useSession(teacherCookie())
    expect(
      (await studentListGet(new Request("https://app.test/api/student/quiz-attempts"))).status,
    ).toBe(403)
    expect(
      (
        await studentStartPost(
          jsonRequest("https://app.test/api/student/quiz-attempts", "POST", { assessmentId: "a1" }),
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await studentDetailGet(
          new Request("https://app.test/api/student/quiz-attempts/x"),
          params("x"),
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await studentSubmitPost(
          jsonRequest("https://app.test/api/student/quiz-attempts/x/submit", "POST", {
            answers: [{ questionId: "q1", selectedIndex: 0 }],
          }),
          params("x"),
        )
      ).status,
    ).toBe(403)
    expect(mocks.startQuizAttempt).not.toHaveBeenCalled()
    expect(mocks.submitQuizAttempt).not.toHaveBeenCalled()
  })

  it("validates the start body before calling the service", async () => {
    useSession(studentCookie())
    const response = await studentStartPost(
      jsonRequest("https://app.test/api/student/quiz-attempts", "POST", {}),
    )
    expect(response.status).toBe(400)
    expect(mocks.startQuizAttempt).not.toHaveBeenCalled()
  })

  it("allows a student through to the start and submit services", async () => {
    useSession(studentCookie())
    const start = await studentStartPost(
      jsonRequest("https://app.test/api/student/quiz-attempts", "POST", { assessmentId: "a1" }),
    )
    expect(start.status).toBe(200)
    expect(mocks.startQuizAttempt).toHaveBeenCalledWith(studentSession, { assessmentId: "a1" })

    const submit = await studentSubmitPost(
      jsonRequest("https://app.test/api/student/quiz-attempts/x/submit", "POST", {
        answers: [{ questionId: "q1", selectedIndex: 0 }],
      }),
      params("x"),
    )
    expect(submit.status).toBe(200)
    expect(mocks.submitQuizAttempt).toHaveBeenCalledWith(studentSession, "x", {
      answers: [{ questionId: "q1", selectedIndex: 0 }],
    })
  })

  it("rejects anonymous and student callers on teacher routes", async () => {
    useSession(null)
    expect(
      (
        await teacherListGet(
          new Request("https://app.test/api/teacher/quiz-attempts?assessmentId=a1"),
        )
      ).status,
    ).toBe(401)
    expect(
      (
        await teacherDetailGet(
          new Request("https://app.test/api/teacher/quiz-attempts/x"),
          params("x"),
        )
      ).status,
    ).toBe(401)

    useSession(studentCookie())
    expect(
      (
        await teacherListGet(
          new Request("https://app.test/api/teacher/quiz-attempts?assessmentId=a1"),
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await teacherDetailGet(
          new Request("https://app.test/api/teacher/quiz-attempts/x"),
          params("x"),
        )
      ).status,
    ).toBe(403)
    expect(mocks.listTeacherAttempts).not.toHaveBeenCalled()
    expect(mocks.getTeacherAttempt).not.toHaveBeenCalled()
  })

  it("requires assessmentId and allows an owning teacher through", async () => {
    useSession(teacherCookie())
    expect(
      (await teacherListGet(new Request("https://app.test/api/teacher/quiz-attempts"))).status,
    ).toBe(400)
    expect(mocks.listTeacherAttempts).not.toHaveBeenCalled()

    const response = await teacherListGet(
      new Request("https://app.test/api/teacher/quiz-attempts?assessmentId=a1"),
    )
    expect(response.status).toBe(200)
    expect(mocks.listTeacherAttempts).toHaveBeenCalledWith(teacherSession, "a1")
  })
})
