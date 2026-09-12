import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Route-level proof that the export APIs enforce their roles, and that a
 * rejected request never reaches the database-backed service. The service is
 * mocked so a denial cannot touch the database.
 */
const mocks = vi.hoisted(() => ({
  getTeacherGradeExport: vi.fn(),
  getTeacherOneRosterCsv: vi.fn(),
  dryRunAgsPublishForTeacher: vi.fn(),
  getStudentGradeExport: vi.fn(),
  getStudentOneRosterCsv: vi.fn(),
  getCookies: vi.fn(),
}))

vi.mock("@/lib/lms-export/service", () => ({
  getTeacherGradeExport: mocks.getTeacherGradeExport,
  getTeacherOneRosterCsv: mocks.getTeacherOneRosterCsv,
  dryRunAgsPublishForTeacher: mocks.dryRunAgsPublishForTeacher,
  getStudentGradeExport: mocks.getStudentGradeExport,
  getStudentOneRosterCsv: mocks.getStudentOneRosterCsv,
}))

vi.mock("next/headers", () => ({
  cookies: () => mocks.getCookies(),
}))

// These route tests use synthetic sessions that have no User row; the real
// database re-validation is covered by tests/session-role-revalidation.test.ts.
vi.mock("@/lib/authz-actor", () => ({
  revalidateSessionActor: (user: unknown) => Promise.resolve(user),
}))

import { GET as teacherExportGet, POST as teacherExportPost } from "@/app/api/teacher/export/route"
import { GET as teacherCsvGet } from "@/app/api/teacher/export/oneroster/route"
import { POST as ltiPost } from "@/app/api/teacher/export/lti/route"
import { GET as studentExportGet } from "@/app/api/student/export/route"
import { GET as studentCsvGet } from "@/app/api/student/export/oneroster/route"
import { signSessionValue } from "@/lib/session"

const TEACHER = { id: "teacher-1", email: "teacher@test.local", role: "teacher" as const }
const STUDENT = { id: "student-1", email: "student@test.local", role: "student" as const }

function useSession(user: typeof TEACHER | typeof STUDENT | null) {
  mocks.getCookies.mockReturnValue({
    get: () => (user ? { name: "auth-user", value: signSessionValue(user) } : undefined),
  })
}

const EMPTY_EXPORT = {
  offering: {
    id: "o1",
    courseCode: "CS101",
    courseName: "Intro",
    className: "A",
    term: "T1",
    academicYear: 2026,
  },
  config: { categories: [] },
  assessments: [],
  students: [],
  lti: { configured: false, missing: [], message: null, scopes: [] },
  generatedAt: new Date().toISOString(),
}

const CSV_DOWNLOAD = {
  filename: "oneroster-results-CS101.csv",
  contentType: "text/csv; charset=utf-8",
  csv: "a,b\r\n1,2\r\n",
  generatedAt: new Date().toISOString(),
  rowCount: 1,
}

describe("teacher export routes", () => {
  beforeEach(() => {
    mocks.getTeacherGradeExport.mockReset()
    mocks.getTeacherOneRosterCsv.mockReset()
    mocks.dryRunAgsPublishForTeacher.mockReset()
    mocks.getCookies.mockReset()
  })

  it("rejects anonymous and student callers before the service runs", async () => {
    useSession(null)
    expect(
      (await teacherExportGet(new Request("https://app.test/api/teacher/export?offeringId=o1")))
        .status,
    ).toBe(401)
    expect(
      (
        await teacherCsvGet(
          new Request("https://app.test/api/teacher/export/oneroster?offeringId=o1&file=results"),
        )
      ).status,
    ).toBe(401)
    expect(
      (
        await ltiPost(
          new Request("https://app.test/api/teacher/export/lti", {
            method: "POST",
            body: JSON.stringify({ offeringId: "o1" }),
          }),
        )
      ).status,
    ).toBe(401)

    useSession(STUDENT)
    expect(
      (await teacherExportGet(new Request("https://app.test/api/teacher/export?offeringId=o1")))
        .status,
    ).toBe(403)
    expect(
      (
        await teacherCsvGet(
          new Request("https://app.test/api/teacher/export/oneroster?offeringId=o1&file=results"),
        )
      ).status,
    ).toBe(403)
    expect(mocks.getTeacherGradeExport).not.toHaveBeenCalled()
    expect(mocks.getTeacherOneRosterCsv).not.toHaveBeenCalled()
    expect(mocks.dryRunAgsPublishForTeacher).not.toHaveBeenCalled()
  })

  it("rejects a malformed request without calling the service", async () => {
    useSession(TEACHER)
    expect(
      (await teacherExportGet(new Request("https://app.test/api/teacher/export"))).status,
    ).toBe(400)
    expect(
      (
        await teacherExportPost(
          new Request("https://app.test/api/teacher/export", { method: "POST", body: "{" }),
        )
      ).status,
    ).toBe(400)
    expect(
      (
        await teacherCsvGet(
          new Request("https://app.test/api/teacher/export/oneroster?file=results"),
        )
      ).status,
    ).toBe(400)
    expect(mocks.getTeacherGradeExport).not.toHaveBeenCalled()
    expect(mocks.getTeacherOneRosterCsv).not.toHaveBeenCalled()
  })

  it("passes an authorized request through and returns the export", async () => {
    mocks.getTeacherGradeExport.mockResolvedValue(EMPTY_EXPORT)
    useSession(TEACHER)
    const response = await teacherExportGet(
      new Request("https://app.test/api/teacher/export?offeringId=o1"),
    )
    expect(response.status).toBe(200)
    expect(mocks.getTeacherGradeExport).toHaveBeenCalledTimes(1)
    const body = (await response.json()) as { success: boolean }
    expect(body.success).toBe(true)
  })

  it("returns a CSV download with the correct headers", async () => {
    mocks.getTeacherOneRosterCsv.mockResolvedValue(CSV_DOWNLOAD)
    useSession(TEACHER)
    const response = await teacherCsvGet(
      new Request("https://app.test/api/teacher/export/oneroster?offeringId=o1&file=results"),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/csv")
    expect(response.headers.get("content-disposition")).toContain(CSV_DOWNLOAD.filename)
    expect(await response.text()).toBe(CSV_DOWNLOAD.csv)
  })

  it("runs the LTI dry run for an authorized teacher", async () => {
    mocks.dryRunAgsPublishForTeacher.mockResolvedValue({
      success: true,
      mode: "dry-run",
      offering: EMPTY_EXPORT.offering,
      contentTypes: { score: "s", lineItem: "l", result: "r" },
      scopes: [],
      lineItems: [],
      scores: [],
      skippedUnpublished: [],
      log: [],
      userIdMapping: "internal-id-fallback",
      generatedAt: new Date().toISOString(),
    })
    useSession(TEACHER)
    const response = await ltiPost(
      new Request("https://app.test/api/teacher/export/lti", {
        method: "POST",
        body: JSON.stringify({ offeringId: "o1" }),
      }),
    )
    expect(response.status).toBe(200)
    expect(mocks.dryRunAgsPublishForTeacher).toHaveBeenCalledTimes(1)
  })
})

describe("student export routes", () => {
  beforeEach(() => {
    mocks.getStudentGradeExport.mockReset()
    mocks.getStudentOneRosterCsv.mockReset()
    mocks.getCookies.mockReset()
  })

  it("rejects anonymous and teacher callers before the service runs", async () => {
    useSession(null)
    expect(
      (await studentExportGet(new Request("https://app.test/api/student/export?offeringId=o1")))
        .status,
    ).toBe(401)

    useSession(TEACHER)
    expect(
      (await studentExportGet(new Request("https://app.test/api/student/export?offeringId=o1")))
        .status,
    ).toBe(403)
    expect(
      (
        await studentCsvGet(
          new Request("https://app.test/api/student/export/oneroster?offeringId=o1&file=results"),
        )
      ).status,
    ).toBe(403)
    expect(mocks.getStudentGradeExport).not.toHaveBeenCalled()
    expect(mocks.getStudentOneRosterCsv).not.toHaveBeenCalled()
  })

  it("passes an authorized student request through and returns their CSV", async () => {
    mocks.getStudentGradeExport.mockResolvedValue({
      offering: EMPTY_EXPORT.offering,
      config: { categories: [] },
      finalGrade: {
        studentId: "s1",
        fullName: "Sam",
        registerNumber: "R1",
        percentage: 80,
        letter: "B",
        completedWeight: 100,
        totalWeight: 100,
        incomplete: false,
        categories: [],
        marks: [],
        excludedUnpublishedAssessmentIds: [],
      },
      lti: { configured: false, missing: [], message: null, scopes: [] },
      generatedAt: new Date().toISOString(),
    })
    mocks.getStudentOneRosterCsv.mockResolvedValue(CSV_DOWNLOAD)
    useSession(STUDENT)

    const jsonResponse = await studentExportGet(
      new Request("https://app.test/api/student/export?offeringId=o1"),
    )
    expect(jsonResponse.status).toBe(200)

    const csvResponse = await studentCsvGet(
      new Request("https://app.test/api/student/export/oneroster?offeringId=o1&file=results"),
    )
    expect(csvResponse.status).toBe(200)
    expect(csvResponse.headers.get("content-disposition")).toContain(CSV_DOWNLOAD.filename)
  })
})
