import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Regression coverage for bug-fix run 1, S-2 (carried through run 3): an
 * assessment created with only a `courseId` landed in whichever offering the
 * server's `academicYear desc` heuristic happened to pick. A teacher who teaches
 * the same course in two offerings could get the assessment in the wrong class.
 *
 * The contract now requires `offeringId`, the service validates that the
 * offering belongs to the signing-in teacher, and a non-owner id is a 403.
 */
const mocks = vi.hoisted(() => ({
  getCookies: vi.fn(),
}))

vi.mock("next/headers", () => ({
  cookies: () => mocks.getCookies(),
}))

import { POST } from "@/app/api/gradebook/assessments/route"
import { createAssessmentForSessionUser } from "@/lib/gradebook-db"
import { signSessionValue } from "@/lib/session"
import type { AuthUser } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

function teacherSession(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "teacher" }
}

function useTeacherSession(userId: string, email: string) {
  mocks.getCookies.mockResolvedValue({
    get: (name: string) => ({
      name,
      value: signSessionValue({ id: userId, email, role: "teacher" }),
    }),
  })
}

function createRequest(body: Record<string, unknown>) {
  return POST(
    new Request("https://app.test/api/gradebook/assessments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
}

const BODY = {
  title: "Weighted assessment",
  type: "Assignment",
  date: "2026-12-01",
  maxMarks: 20,
} as const

async function seedTeacherWithTwoOfferingsForOneCourse() {
  const f = await createSpineFixture(prisma)
  const secondClassroom = await prisma.classRoom.create({
    data: { code: "CLASS-SECOND", name: "Second Class", section: "B", academicYear: 2024 },
  })
  // Deliberately the OLDER year: the old heuristic ordered by `academicYear desc`
  // and would have chosen the spine offering instead.
  const olderOffering = await prisma.courseOffering.create({
    data: {
      courseId: f.course.id,
      classId: secondClassroom.id,
      teacherId: f.teacher.staffProfile!.id,
      term: "Older term",
      academicYear: 2024,
    },
  })
  return { f, secondClassroom, olderOffering }
}

async function createOtherTeacherOffering() {
  const f = await createSpineFixture(prisma)
  const other = await prisma.user.create({
    data: {
      email: "other-offering-teacher@test.local",
      passwordHash: "test-only-not-a-real-hash",
      role: "TEACHER",
      staffProfile: { create: { fullName: "Olive Teacher", empId: "EMP-OTHER-OFFERING" } },
    },
    include: { staffProfile: true },
  })
  const offering = await prisma.courseOffering.create({
    data: {
      courseId: f.course.id,
      classId: f.classroom.id,
      teacherId: other.staffProfile!.id,
      term: "Other teacher term",
      academicYear: 2026,
    },
  })
  return { f, other, offering }
}

describe("assessment creation targets an explicit offering", () => {
  beforeEach(async () => {
    await truncateAll()
    mocks.getCookies.mockReset()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("writes into the offering the teacher asked for, not the newest year", async () => {
    const { f, secondClassroom, olderOffering } = await seedTeacherWithTwoOfferingsForOneCourse()

    const created = await createAssessmentForSessionUser(
      { ...BODY, offeringId: olderOffering.id },
      teacherSession(f.teacher),
    )

    expect(created.offeringId).toBe(olderOffering.id)
    expect(created.classId).toBe(secondClassroom.id)

    const row = await prisma.assessment.findUniqueOrThrow({ where: { id: created.id } })
    expect(row.offeringId).toBe(olderOffering.id)
    expect(row.courseId).toBe(f.course.id)
    expect(row.classId).toBe(secondClassroom.id)

    const calendar = await prisma.calendarEvent.findFirstOrThrow({
      where: { assessmentId: created.id },
    })
    expect(calendar.offeringId).toBe(olderOffering.id)
    expect(calendar.classId).toBe(secondClassroom.id)
  })

  it("rejects an offering owned by another teacher and writes nothing", async () => {
    const { f, offering } = await createOtherTeacherOffering()

    await expect(
      createAssessmentForSessionUser(
        { ...BODY, title: "Should not exist", offeringId: offering.id },
        teacherSession(f.teacher),
      ),
    ).rejects.toThrow("Offering not found or not owned by you.")

    expect(await prisma.assessment.count({ where: { title: "Should not exist" } })).toBe(0)
  })

  it("rejects an unknown offering id", async () => {
    const f = await createSpineFixture(prisma)
    await expect(
      createAssessmentForSessionUser(
        { ...BODY, offeringId: "offering-does-not-exist" },
        teacherSession(f.teacher),
      ),
    ).rejects.toThrow("Offering not found or not owned by you.")
  })

  it("returns 200 and the correct offering through the route", async () => {
    const { f, olderOffering } = await seedTeacherWithTwoOfferingsForOneCourse()
    useTeacherSession(f.teacher.id, f.teacher.email)

    const response = await createRequest({ ...BODY, offeringId: olderOffering.id })
    const body = (await response.json()) as { assessment: { offeringId: string; classId: string } }

    expect(response.status).toBe(200)
    expect(body.assessment.offeringId).toBe(olderOffering.id)
  })

  it("returns a clear 403 for a non-owner offering through the route", async () => {
    const { f, offering } = await createOtherTeacherOffering()
    useTeacherSession(f.teacher.id, f.teacher.email)

    const response = await createRequest({ ...BODY, offeringId: offering.id })
    const body = (await response.json()) as { message: string }

    expect(response.status).toBe(403)
    expect(body.message).toBe("Offering not found or not owned by you.")
  })

  it("returns a 400 when the offering id is missing", async () => {
    const f = await createSpineFixture(prisma)
    useTeacherSession(f.teacher.id, f.teacher.email)

    const response = await createRequest(BODY)
    expect(response.status).toBe(400)
    expect(await prisma.assessment.count()).toBe(1) // only the spine fixture assessment
  })
})
