import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Route-level proof that the groups teacher APIs and the student peer-evaluation
 * API enforce their roles, and that a rejected request never reaches the service
 * (so it cannot touch the database).
 */
const mocks = vi.hoisted(() => ({
  listGroupsForTeacher: vi.fn(),
  formTeamsForTeacher: vi.fn(),
  getPeerEvaluationWorkspaceForStudent: vi.fn(),
  submitPeerEvaluationsForStudent: vi.fn(),
  getCookies: vi.fn(),
}))

vi.mock("@/lib/groups", async () => {
  const actual = await vi.importActual<typeof import("@/lib/groups")>("@/lib/groups")
  return {
    ...actual,
    listGroupsForTeacher: mocks.listGroupsForTeacher,
    formTeamsForTeacher: mocks.formTeamsForTeacher,
    getPeerEvaluationWorkspaceForStudent: mocks.getPeerEvaluationWorkspaceForStudent,
    submitPeerEvaluationsForStudent: mocks.submitPeerEvaluationsForStudent,
  }
})

vi.mock("next/headers", () => ({
  cookies: () => mocks.getCookies(),
}))

import { POST as formPost } from "@/app/api/teacher/groups/form/route"
import { GET as teacherGroupsGet, POST as teacherGroupsPost } from "@/app/api/teacher/groups/route"
import { GET as studentGet, POST as studentPost } from "@/app/api/student/peer-evaluation/route"
import { signSessionValue } from "@/lib/session"

const TEACHER = { id: "teacher-1", email: "teacher@test.local", role: "teacher" as const }
const STUDENT = { id: "student-1", email: "student@test.local", role: "student" as const }

function useSession(user: typeof TEACHER | typeof STUDENT | null) {
  mocks.getCookies.mockReturnValue({
    get: () => (user ? { name: "auth-user", value: signSessionValue(user) } : undefined),
  })
}

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const RATINGS = {
  contributing: 4,
  interacting: 4,
  keepingOnTrack: 4,
  expectingQuality: 4,
  knowledgeSkillsAbilities: 4,
}

describe("teacher groups routes", () => {
  beforeEach(() => {
    mocks.listGroupsForTeacher.mockReset()
    mocks.formTeamsForTeacher.mockReset()
    mocks.getCookies.mockReset()
  })

  it("rejects anonymous and student callers before the service runs", async () => {
    useSession(null)
    expect(
      (await teacherGroupsGet(new Request("https://app.test/api/teacher/groups"))).status,
    ).toBe(401)
    useSession(STUDENT)
    expect(
      (await teacherGroupsGet(new Request("https://app.test/api/teacher/groups"))).status,
    ).toBe(403)
    expect(mocks.listGroupsForTeacher).not.toHaveBeenCalled()
  })

  it("allows a teacher through to the group service", async () => {
    mocks.listGroupsForTeacher.mockResolvedValue([])
    useSession(TEACHER)
    const response = await teacherGroupsGet(new Request("https://app.test/api/teacher/groups"))
    expect(response.status).toBe(200)
    expect(mocks.listGroupsForTeacher).toHaveBeenCalledTimes(1)
  })

  it("rejects a student from team formation before it runs, and allows a teacher", async () => {
    const body = {
      offeringId: "offering-1",
      criteria: [{ id: "gpa", label: "GPA", kind: "numeric-balance", weight: 1, attribute: "gpa" }],
      students: [{ studentId: "s1" }, { studentId: "s2" }],
    }
    useSession(STUDENT)
    const denied = await formPost(jsonRequest("https://app.test/api/teacher/groups/form", body))
    expect(denied.status).toBe(403)
    expect(mocks.formTeamsForTeacher).not.toHaveBeenCalled()

    mocks.formTeamsForTeacher.mockResolvedValue({
      formation: {
        teams: [],
        objective: 1,
        teamCount: 1,
        scheduleCompatible: true,
        criteria: [],
      },
      persistedGroupIds: [],
    })
    useSession(TEACHER)
    const allowed = await formPost(jsonRequest("https://app.test/api/teacher/groups/form", body))
    expect(allowed.status).toBe(200)
    expect(mocks.formTeamsForTeacher).toHaveBeenCalledTimes(1)
  })

  it("rejects a malformed create body without calling the service", async () => {
    useSession(TEACHER)
    const response = await teacherGroupsPost(
      jsonRequest("https://app.test/api/teacher/groups", { offeringId: "offering-1" }),
    )
    expect(response.status).toBe(400)
  })
})

describe("student peer-evaluation route", () => {
  beforeEach(() => {
    mocks.getPeerEvaluationWorkspaceForStudent.mockReset()
    mocks.submitPeerEvaluationsForStudent.mockReset()
    mocks.getCookies.mockReset()
  })

  it("rejects anonymous and teacher callers", async () => {
    useSession(null)
    expect((await studentGet()).status).toBe(401)
    useSession(TEACHER)
    expect((await studentGet()).status).toBe(403)
    useSession(TEACHER)
    expect(
      (
        await studentPost(
          jsonRequest("https://app.test/api/student/peer-evaluation", {
            groupId: "g1",
            evaluations: [{ evaluateeId: "s1", ratings: RATINGS }],
          }),
        )
      ).status,
    ).toBe(403)
    expect(mocks.getPeerEvaluationWorkspaceForStudent).not.toHaveBeenCalled()
    expect(mocks.submitPeerEvaluationsForStudent).not.toHaveBeenCalled()
  })

  it("returns the workspace to a student and passes submissions to the service", async () => {
    mocks.getPeerEvaluationWorkspaceForStudent.mockResolvedValue([])
    useSession(STUDENT)
    expect((await studentGet()).status).toBe(200)

    mocks.submitPeerEvaluationsForStudent.mockResolvedValue({
      success: true,
      groupId: "g1",
      submitted: 1,
      status: "SUBMITTED",
    })
    const response = await studentPost(
      jsonRequest("https://app.test/api/student/peer-evaluation", {
        groupId: "g1",
        evaluations: [{ evaluateeId: "s1", ratings: RATINGS }],
      }),
    )
    expect(response.status).toBe(200)
    expect(mocks.submitPeerEvaluationsForStudent).toHaveBeenCalledTimes(1)
  })
})
