import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { FinalGradeConfig } from "@/lib/contracts/lms-export"
import { finalLineItemSourcedId, lineItemSourcedId } from "@/lib/lms-export/oneroster"
import {
  dryRunAgsPublishForTeacher,
  getStudentGradeExport,
  getStudentOneRosterCsv,
  getTeacherGradeExport,
  getTeacherOneRosterCsv,
  listTeacherExportOfferings,
} from "@/lib/lms-export/service"
import type { AuthUser } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import {
  createDraftModernGrade,
  createLegacyGrade,
  createLmsExportFixture,
  lmsStudentSession,
  lmsTeacherSession,
  publishModernGrade,
} from "./fixtures/lms-export"

const VALID_LTI_ENV = {
  LTI_PLATFORM_ISSUER: "https://lms.example",
  LTI_CLIENT_ID: "client-1",
  LTI_DEPLOYMENT_ID: "deployment-1",
  LTI_KEY_ID: "key-1",
  LTI_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
  LTI_AGS_LINEITEMS_URL: "https://lms.example/ags/lineitems",
}

async function createOtherTeacher(): Promise<AuthUser> {
  const user = await prisma.user.create({
    data: {
      email: "other-lms-teacher@test.local",
      passwordHash: "test-only-not-a-real-hash",
      role: "TEACHER",
      staffProfile: { create: { fullName: "Olive Other", empId: "EMP-LMS-OTHER" } },
    },
  })
  return { id: user.id, email: user.email, role: "teacher" }
}

describe("weighted final grade service", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("combines published modern grades and legacy fallbacks, and blocks legacy when a modern row exists", async () => {
    const fixture = await createLmsExportFixture(prisma, { studentCount: 3 })
    const [a1, a2, a3] = fixture.assessments
    const [s1, s2, s3] = fixture.students
    const teacher = lmsTeacherSession(fixture)

    const config: FinalGradeConfig = {
      categories: [
        { id: "exams", name: "Exams", weight: 60, assessmentIds: [a1.id] },
        {
          id: "coursework",
          name: "Coursework",
          weight: 40,
          assessmentIds: [a2.id, a3.id],
          assessmentWeights: { [a2.id]: 1, [a3.id]: 3 },
        },
      ],
    }

    // Student 1: modern published, legacy fallback, modern published => 83.
    await publishModernGrade(prisma, {
      assessmentId: a1.id,
      studentId: s1.profileId,
      points: 16,
      maxPoints: 20,
    })
    await createLegacyGrade(prisma, {
      assessmentId: a2.id,
      studentId: s1.profileId,
      marksObtained: 8,
    })
    await publishModernGrade(prisma, {
      assessmentId: a3.id,
      studentId: s1.profileId,
      points: 27,
      maxPoints: 30,
    })

    // Student 2: an unpublished modern grade on a1 must block the legacy a1 mark.
    await createDraftModernGrade(prisma, {
      assessmentId: a1.id,
      studentId: s2.profileId,
      points: 20,
      maxPoints: 20,
    })
    await createLegacyGrade(prisma, {
      assessmentId: a1.id,
      studentId: s2.profileId,
      marksObtained: 2,
    })
    await publishModernGrade(prisma, {
      assessmentId: a2.id,
      studentId: s2.profileId,
      points: 5,
      maxPoints: 10,
    })

    // Student 3: legacy only.
    await createLegacyGrade(prisma, {
      assessmentId: a1.id,
      studentId: s3.profileId,
      marksObtained: 10,
    })
    await createLegacyGrade(prisma, {
      assessmentId: a2.id,
      studentId: s3.profileId,
      marksObtained: 5,
    })
    await createLegacyGrade(prisma, {
      assessmentId: a3.id,
      studentId: s3.profileId,
      marksObtained: 15,
    })

    const result = await getTeacherGradeExport(teacher, {
      offeringId: fixture.offering.id,
      config,
    })
    const byId = new Map(result.students.map((student) => [student.studentId, student]))

    const p1 = byId.get(s1.profileId)!
    expect(p1.percentage).toBe(83)
    expect(p1.letter).toBe("B")
    expect(p1.marks.map((mark) => mark.origin)).toEqual([
      "modern-grade",
      "legacy-grade",
      "modern-grade",
    ])
    expect(p1.legacyFallbackAssessmentIds).toEqual([a2.id])
    expect(p1.excludedUnpublishedAssessmentIds).toEqual([])

    const p2 = byId.get(s2.profileId)!
    expect(p2.excludedUnpublishedAssessmentIds).toEqual([a1.id])
    expect(p2.legacyFallbackAssessmentIds).toEqual([])
    expect(p2.marks).toHaveLength(1)
    expect(p2.percentage).toBe(50)

    const p3 = byId.get(s3.profileId)!
    expect(p3.percentage).toBe(50)
    expect([...p3.legacyFallbackAssessmentIds].sort()).toEqual([a1.id, a2.id, a3.id].sort())
  })

  it("proves across the DB that an unpublished grade never changes a final grade", async () => {
    const fixture = await createLmsExportFixture(prisma, { studentCount: 1 })
    const [a1] = fixture.assessments
    const student = fixture.students[0]
    const teacher = lmsTeacherSession(fixture)
    const config: FinalGradeConfig = {
      categories: [{ id: "all", name: "All", weight: 100, assessmentIds: [a1.id] }],
    }

    const before = await getTeacherGradeExport(teacher, {
      offeringId: fixture.offering.id,
      config,
    })
    expect(before.students[0].percentage).toBeNull()

    const draft = await createDraftModernGrade(prisma, {
      assessmentId: a1.id,
      studentId: student.profileId,
      points: 20,
      maxPoints: 20,
    })
    const afterDraft = await getTeacherGradeExport(teacher, {
      offeringId: fixture.offering.id,
      config,
    })
    expect(afterDraft.students[0].percentage).toBeNull()
    expect(afterDraft.students[0].excludedUnpublishedAssessmentIds).toEqual([a1.id])

    await prisma.grade.update({
      where: { id: draft.id },
      data: { publishedAt: new Date("2026-11-01T00:00:00.000Z") },
    })
    const afterPublish = await getTeacherGradeExport(teacher, {
      offeringId: fixture.offering.id,
      config,
    })
    expect(afterPublish.students[0].percentage).toBe(100)
  })

  it("rejects an incoherent weight configuration with a 400 before computing", async () => {
    const fixture = await createLmsExportFixture(prisma, { studentCount: 1 })
    const [a1] = fixture.assessments
    const teacher = lmsTeacherSession(fixture)
    await expect(
      getTeacherGradeExport(teacher, {
        offeringId: fixture.offering.id,
        config: { categories: [{ id: "x", name: "X", weight: 50, assessmentIds: [a1.id] }] },
      }),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe("LMS export scoping", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("denies a second teacher every export surface and a student on the teacher surface", async () => {
    const fixture = await createLmsExportFixture(prisma, { studentCount: 1 })
    const otherTeacher = await createOtherTeacher()

    await expect(
      getTeacherGradeExport(otherTeacher, { offeringId: fixture.offering.id }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      getTeacherOneRosterCsv(otherTeacher, {
        offeringId: fixture.offering.id,
        file: "lineItems",
      }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      dryRunAgsPublishForTeacher(otherTeacher, {
        offeringId: fixture.offering.id,
        env: VALID_LTI_ENV,
      }),
    ).rejects.toMatchObject({ status: 403 })
    expect(await listTeacherExportOfferings(otherTeacher)).toEqual([])

    await expect(
      getTeacherGradeExport(lmsStudentSession(fixture.students[0]), {
        offeringId: fixture.offering.id,
      }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it("returns only the signed-in student's own grade and results", async () => {
    const fixture = await createLmsExportFixture(prisma, { studentCount: 3 })
    const [a1] = fixture.assessments
    const [s1, s2] = fixture.students
    const teacher = lmsTeacherSession(fixture)

    await publishModernGrade(prisma, {
      assessmentId: a1.id,
      studentId: s1.profileId,
      points: 16,
      maxPoints: 20,
    })
    await publishModernGrade(prisma, {
      assessmentId: a1.id,
      studentId: s2.profileId,
      points: 4,
      maxPoints: 20,
    })

    const own = await getStudentGradeExport(lmsStudentSession(s1), {
      offeringId: fixture.offering.id,
    })
    expect(own.finalGrade.studentId).toBe(s1.profileId)
    expect(own.finalGrade.percentage).toBe(80)

    const csv = await getStudentOneRosterCsv(lmsStudentSession(s1), {
      offeringId: fixture.offering.id,
      file: "results",
    })
    expect(csv.csv).toContain(s1.profileId)
    for (const other of fixture.students.slice(1)) {
      expect(csv.csv).not.toContain(other.profileId)
    }

    const outsider = await prisma.user.create({
      data: {
        email: "lms-outsider@test.local",
        passwordHash: "test-only-not-a-real-hash",
        role: "STUDENT",
        studentProfile: { create: { fullName: "Outsider", registerNumber: "REG-LMS-OUT" } },
      },
    })
    await expect(
      getStudentGradeExport(
        { id: outsider.id, email: outsider.email, role: "student" },
        { offeringId: fixture.offering.id },
      ),
    ).rejects.toMatchObject({ status: 403 })

    await expect(
      getStudentGradeExport(teacher, { offeringId: fixture.offering.id }),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe("OneRoster CSV service", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("includes only published results and escapes free-text titles", async () => {
    const fixture = await createLmsExportFixture(prisma, { studentCount: 1 })
    const [a1, a2, a3] = fixture.assessments
    const student = fixture.students[0]
    const teacher = lmsTeacherSession(fixture)

    await publishModernGrade(prisma, {
      assessmentId: a1.id,
      studentId: student.profileId,
      points: 16,
      maxPoints: 20,
    })
    await createDraftModernGrade(prisma, {
      assessmentId: a2.id,
      studentId: student.profileId,
      points: 10,
      maxPoints: 10,
    })
    await createLegacyGrade(prisma, {
      assessmentId: a3.id,
      studentId: student.profileId,
      marksObtained: 15,
    })

    const results = await getTeacherOneRosterCsv(teacher, {
      offeringId: fixture.offering.id,
      file: "results",
    })
    expect(results.contentType).toBe("text/csv; charset=utf-8")
    expect(results.filename).toMatch(/^oneroster-results-/)
    expect(results.csv).toContain(lineItemSourcedId(a1.id))
    expect(results.csv).toContain(lineItemSourcedId(a3.id))
    expect(results.csv).not.toContain(lineItemSourcedId(a2.id))
    expect(results.csv).toContain(finalLineItemSourcedId(fixture.offering.id))

    const lineItems = await getTeacherOneRosterCsv(teacher, {
      offeringId: fixture.offering.id,
      file: "lineItems",
    })
    // The descriptive assessment title contains a quote and a newline.
    expect(lineItems.csv).toContain('"Descriptive ""essay""\nwith a newline"')
    expect(lineItems.csv).toContain("Final Grade")
  })
})

describe("LTI AGS dry run service", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("sends only published grades and never touches the network", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("network is disabled in tests")
    })
    vi.stubGlobal("fetch", fetchSpy)

    const fixture = await createLmsExportFixture(prisma, { studentCount: 2 })
    const [a1, a2, a3] = fixture.assessments
    const [s1, s2] = fixture.students
    const teacher = lmsTeacherSession(fixture)

    await publishModernGrade(prisma, {
      assessmentId: a1.id,
      studentId: s1.profileId,
      points: 16,
      maxPoints: 20,
    })
    await publishModernGrade(prisma, {
      assessmentId: a2.id,
      studentId: s2.profileId,
      points: 8,
      maxPoints: 10,
    })
    await createDraftModernGrade(prisma, {
      assessmentId: a3.id,
      studentId: s1.profileId,
      points: 27,
      maxPoints: 30,
    })

    const result = await dryRunAgsPublishForTeacher(teacher, {
      offeringId: fixture.offering.id,
      env: VALID_LTI_ENV,
      ltiUserIds: { [s1.profileId]: "lti-1" },
    })

    expect(result.mode).toBe("dry-run")
    expect(result.lineItems).toHaveLength(3)
    expect(result.scores).toHaveLength(2)
    expect(result.skippedUnpublished).toEqual([{ assessmentId: a3.id, studentId: s1.profileId }])
    expect(result.scores.map((score) => score.userId).sort()).toEqual(
      ["lti-1", s2.profileId].sort(),
    )
    expect(result.userIdMapping).toBe("provided")
    // 3 line items + 2 scores.
    expect(result.log).toHaveLength(5)
    expect(result.contentTypes.score).toBe("application/vnd.ims.lis.v1.score+json")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("surfaces an actionable 422 when LTI is not configured", async () => {
    const fixture = await createLmsExportFixture(prisma, { studentCount: 1 })
    const teacher = lmsTeacherSession(fixture)
    await expect(
      dryRunAgsPublishForTeacher(teacher, { offeringId: fixture.offering.id, env: {} }),
    ).rejects.toMatchObject({ status: 422 })
  })
})
