import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Database-backed proof that a stale role is rejected on the authorization path
 * (Phase 3 item S-2): the real `lookupActorById` runs against the test
 * database, with caching disabled so each call observes the current row.
 */
const mocks = vi.hoisted(() => ({ cookies: vi.fn() }))

vi.mock("next/headers", () => ({ cookies: () => mocks.cookies() }))
vi.mock("@/lib/authz-actor", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz-actor")>("@/lib/authz-actor")
  return {
    ...actual,
    // Cache off, real lookup: every assertion sees the committed database row.
    revalidateSessionActor: actual.createSessionActorRevalidator({
      ttlMs: 0,
      lookup: actual.lookupActorById,
    }),
  }
})

import { requireRole, requireUser } from "@/lib/authz"
import type { AuthUser } from "@/lib/session"
import { signSessionValue } from "@/lib/session"
import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"

function useSession(user: AuthUser | null) {
  mocks.cookies.mockResolvedValue({
    get: (name: string) => (user ? { name, value: signSessionValue(user) } : undefined),
  })
}

async function seedTeacher(): Promise<AuthUser> {
  const row = await prisma.user.create({
    data: {
      email: "revalidate-teacher@test.local",
      passwordHash: "test-only-not-a-real-hash",
      role: "TEACHER",
    },
  })
  return { id: row.id, email: row.email, role: "teacher" }
}

describe("authorization re-validates against the database", () => {
  beforeEach(async () => {
    await truncateAll()
    mocks.cookies.mockReset()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("authorizes a session whose actor still exists with the same role", async () => {
    const teacher = await seedTeacher()
    useSession(teacher)
    const result = await requireRole("teacher")
    expect(result.authorized).toBe(true)
    if (result.authorized) expect(result.user.id).toBe(teacher.id)
  })

  it("rejects a demoted user with 401 even though the session still says teacher", async () => {
    const teacher = await seedTeacher()
    useSession(teacher)
    await prisma.user.update({ where: { id: teacher.id }, data: { role: "STUDENT" } })

    const result = await requireRole("teacher")
    expect(result.authorized).toBe(false)
    if (!result.authorized) expect(result.response.status).toBe(401)
  })

  it("rejects a deleted user with 401", async () => {
    const teacher = await seedTeacher()
    useSession(teacher)
    await prisma.user.delete({ where: { id: teacher.id } })

    const result = await requireUser()
    expect(result.authorized).toBe(false)
    if (!result.authorized) expect(result.response.status).toBe(401)
  })

  it("authorizes the demoted user only under their current role", async () => {
    const teacher = await seedTeacher()
    await prisma.user.update({ where: { id: teacher.id }, data: { role: "STUDENT" } })
    useSession({ ...teacher, role: "student" })

    const result = await requireRole("student")
    expect(result.authorized).toBe(true)
    if (result.authorized) expect(result.user.role).toBe("student")
  })

  it("looks up the current role and reports a missing user as null", async () => {
    const teacher = await seedTeacher()
    await prisma.user.update({ where: { id: teacher.id }, data: { role: "ADMIN" } })
    const { lookupActorById } =
      await vi.importActual<typeof import("@/lib/authz-actor")>("@/lib/authz-actor")
    await expect(lookupActorById(teacher.id)).resolves.toMatchObject({
      id: teacher.id,
      role: "admin",
    })
    await expect(lookupActorById("does-not-exist")).resolves.toBeNull()
  })
})
