import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Route-level proof that role guards run before any service call. The services
 * are mocked so a request that should be rejected is shown to be rejected
 * *before* any sandbox or database work.
 */
const mocks = vi.hoisted(() => ({
  listTeacherCodeTasks: vi.fn(),
  upsertCodeTaskForTeacher: vi.fn(),
  listStudentCodeTasks: vi.fn(),
  submitCodeForStudent: vi.fn(),
  getCookies: vi.fn(),
}))

vi.mock("@/lib/code-eval", async () => {
  const actual = await vi.importActual<typeof import("@/lib/code-eval")>("@/lib/code-eval")
  return {
    ...actual,
    listTeacherCodeTasks: mocks.listTeacherCodeTasks,
    upsertCodeTaskForTeacher: mocks.upsertCodeTaskForTeacher,
    listStudentCodeTasks: mocks.listStudentCodeTasks,
    submitCodeForStudent: mocks.submitCodeForStudent,
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

import { GET as teacherList, POST as teacherUpsert } from "@/app/api/teacher/code-tasks/route"
import { POST as studentSubmit } from "@/app/api/student/code-submissions/route"
import { signSessionValue } from "@/lib/session"

function useSession(user: { id: string; email: string; role: "teacher" | "student" } | null) {
  mocks.getCookies.mockReturnValue({
    get: (name: string) => (user ? { name, value: signSessionValue(user) } : undefined),
  })
}

const teacher = { id: "teacher-1", email: "teacher@test.local", role: "teacher" as const }
const student = { id: "student-1", email: "student@test.local", role: "student" as const }

function jsonRequest(url: string, body: Record<string, unknown>) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("teacher code-task routes", () => {
  beforeEach(() => {
    mocks.listTeacherCodeTasks.mockReset()
    mocks.upsertCodeTaskForTeacher.mockReset()
    mocks.getCookies.mockReset()
  })

  it("rejects anonymous and student callers before the service runs", async () => {
    useSession(null)
    expect((await teacherList()).status).toBe(401)

    useSession(student)
    expect((await teacherList()).status).toBe(403)
    expect(mocks.listTeacherCodeTasks).not.toHaveBeenCalled()
  })

  it("allows a teacher through to the list service", async () => {
    useSession(teacher)
    mocks.listTeacherCodeTasks.mockResolvedValue([])
    const response = await teacherList()
    expect(response.status).toBe(200)
    expect(mocks.listTeacherCodeTasks).toHaveBeenCalledTimes(1)
  })

  it("rejects a malformed upsert body without calling the service", async () => {
    useSession(teacher)
    const response = await teacherUpsert(
      jsonRequest("https://app.test/api/teacher/code-tasks", { assessmentId: "a1" }),
    )
    expect(response.status).toBe(400)
    expect(mocks.upsertCodeTaskForTeacher).not.toHaveBeenCalled()
  })
})

describe("student code-submission routes", () => {
  beforeEach(() => {
    mocks.listStudentCodeTasks.mockReset()
    mocks.submitCodeForStudent.mockReset()
    mocks.getCookies.mockReset()
  })

  it("rejects anonymous and teacher callers before the service runs", async () => {
    const body = { assessmentId: "a1", sourceCode: "print(1)" }

    useSession(null)
    expect(
      (await studentSubmit(jsonRequest("https://app.test/api/student/code-submissions", body)))
        .status,
    ).toBe(401)

    useSession(teacher)
    expect(
      (await studentSubmit(jsonRequest("https://app.test/api/student/code-submissions", body)))
        .status,
    ).toBe(403)
    expect(mocks.submitCodeForStudent).not.toHaveBeenCalled()
  })

  it("allows a student through and rejects a malformed body first", async () => {
    useSession(student)
    const malformed = await studentSubmit(
      jsonRequest("https://app.test/api/student/code-submissions", { assessmentId: "a1" }),
    )
    expect(malformed.status).toBe(400)
    expect(mocks.submitCodeForStudent).not.toHaveBeenCalled()

    mocks.submitCodeForStudent.mockResolvedValue({
      id: "run-1",
      codeTaskId: "task-1",
      assessmentId: "a1",
      studentId: "student-1",
      studentName: null,
      studentRegisterNumber: null,
      language: "python",
      status: "PASSED",
      passedCount: 1,
      failedCount: 0,
      totalCount: 1,
      earnedPoints: 1,
      maxPoints: 1,
      runtimeMs: 5,
      coverage: 1,
      results: [],
      stdout: null,
      stderr: null,
      timedOut: false,
      memoryExceeded: false,
      createdAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    })

    const response = await studentSubmit(
      jsonRequest("https://app.test/api/student/code-submissions", {
        assessmentId: "a1",
        sourceCode: "print(1)",
      }),
    )
    expect(response.status).toBe(200)
    expect(mocks.submitCodeForStudent).toHaveBeenCalledTimes(1)
  })
})
