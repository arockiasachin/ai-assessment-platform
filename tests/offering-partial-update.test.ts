import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Regression coverage for bug-fix run 2: `PUT /api/teacher/offerings/[id]`
 * treated an *omitted* schedule field the same as an explicit `null`, so a
 * partial update such as `{ "studentLimit": 30 }` silently wiped every date on
 * the offering and returned `200`.
 */
const mocks = vi.hoisted(() => ({
  getCookies: vi.fn(),
}))

vi.mock("next/headers", () => ({
  cookies: () => mocks.getCookies(),
}))

import { PUT } from "@/app/api/teacher/offerings/[offeringId]/route"
import { signSessionValue } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

function useTeacherSession(userId: string, email: string) {
  mocks.getCookies.mockResolvedValue({
    get: (name: string) => ({
      name,
      value: signSessionValue({ id: userId, email, role: "teacher" }),
    }),
  })
}

function put(offeringId: string, body: Record<string, unknown>) {
  return PUT(
    new Request("https://app.test/api/teacher/offerings/" + offeringId, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ offeringId }) },
  )
}

const SCHEDULE = {
  registrationOpenAt: new Date("2026-08-01T00:00:00.000Z"),
  registrationCloseAt: new Date("2026-09-01T00:00:00.000Z"),
  startsOn: new Date("2026-09-05T00:00:00.000Z"),
  endsOn: new Date("2026-12-15T00:00:00.000Z"),
} as const

describe("PUT /api/teacher/offerings/[offeringId] partial update", () => {
  beforeEach(async () => {
    await truncateAll()
    mocks.getCookies.mockReset()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("leaves omitted schedule fields untouched", async () => {
    const spine = await createSpineFixture(prisma)
    await prisma.courseOffering.update({ where: { id: spine.offering.id }, data: { ...SCHEDULE } })
    useTeacherSession(spine.teacher.id, spine.teacher.email)

    const response = await put(spine.offering.id, { studentLimit: 30 })
    expect(response.status).toBe(200)

    const after = await prisma.courseOffering.findUniqueOrThrow({
      where: { id: spine.offering.id },
    })
    expect(after.studentLimit).toBe(30)
    expect(after.registrationOpenAt?.toISOString()).toBe(SCHEDULE.registrationOpenAt.toISOString())
    expect(after.registrationCloseAt?.toISOString()).toBe(
      SCHEDULE.registrationCloseAt.toISOString(),
    )
    expect(after.startsOn?.toISOString()).toBe(SCHEDULE.startsOn.toISOString())
    expect(after.endsOn?.toISOString()).toBe(SCHEDULE.endsOn.toISOString())
  })

  it("clears only the field explicitly set to null", async () => {
    const spine = await createSpineFixture(prisma)
    await prisma.courseOffering.update({ where: { id: spine.offering.id }, data: { ...SCHEDULE } })
    useTeacherSession(spine.teacher.id, spine.teacher.email)

    const response = await put(spine.offering.id, { studentLimit: 25, registrationCloseAt: null })
    expect(response.status).toBe(200)

    const after = await prisma.courseOffering.findUniqueOrThrow({
      where: { id: spine.offering.id },
    })
    expect(after.registrationOpenAt?.toISOString()).toBe(SCHEDULE.registrationOpenAt.toISOString())
    expect(after.registrationCloseAt).toBeNull()
    expect(after.startsOn?.toISOString()).toBe(SCHEDULE.startsOn.toISOString())
    expect(after.endsOn?.toISOString()).toBe(SCHEDULE.endsOn.toISOString())
  })

  it("updates only the supplied date", async () => {
    const spine = await createSpineFixture(prisma)
    await prisma.courseOffering.update({ where: { id: spine.offering.id }, data: { ...SCHEDULE } })
    useTeacherSession(spine.teacher.id, spine.teacher.email)

    const newStart = "2026-10-01T00:00:00.000Z"
    const response = await put(spine.offering.id, { studentLimit: 26, startsOn: newStart })
    expect(response.status).toBe(200)

    const after = await prisma.courseOffering.findUniqueOrThrow({
      where: { id: spine.offering.id },
    })
    expect(after.startsOn?.toISOString()).toBe(new Date(newStart).toISOString())
    expect(after.endsOn?.toISOString()).toBe(SCHEDULE.endsOn.toISOString())
  })

  it("still rejects an unparseable date before touching the row", async () => {
    const spine = await createSpineFixture(prisma)
    await prisma.courseOffering.update({ where: { id: spine.offering.id }, data: { ...SCHEDULE } })
    useTeacherSession(spine.teacher.id, spine.teacher.email)

    const response = await put(spine.offering.id, { studentLimit: 30, startsOn: "not-a-date" })
    expect(response.status).toBe(400)

    const after = await prisma.courseOffering.findUniqueOrThrow({
      where: { id: spine.offering.id },
    })
    expect(after.startsOn?.toISOString()).toBe(SCHEDULE.startsOn.toISOString())
  })
})
