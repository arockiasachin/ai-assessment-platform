import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Wiring proof that `requireRole` / `requireUser` consult the database
 * re-validation and reject a stale session with 401 (Phase 3 item S-2).
 *
 * The re-validator itself is mocked here so the assertion is about the
 * authorization path: a null result must deny, and a wrong role must still deny
 * before any database work.
 */
const mocks = vi.hoisted(() => ({
  revalidateSessionActor: vi.fn(),
  cookies: vi.fn(),
}))

vi.mock("next/headers", () => ({ cookies: () => mocks.cookies() }))
vi.mock("@/lib/authz-actor", () => ({
  revalidateSessionActor: mocks.revalidateSessionActor,
}))

import { requireRole, requireUser } from "@/lib/authz"
import { signSessionValue, type AuthUser } from "@/lib/session"

const TEACHER: AuthUser = { id: "t1", email: "t@test.local", role: "teacher" }

function useSession(user: AuthUser | null) {
  mocks.cookies.mockResolvedValue({
    get: (name: string) => (user ? { name, value: signSessionValue(user) } : undefined),
  })
}

describe("authorization session re-validation", () => {
  beforeEach(() => {
    mocks.revalidateSessionActor.mockReset()
    mocks.cookies.mockReset()
  })

  it("denies a missing session without re-validating", async () => {
    useSession(null)
    const result = await requireUser()
    expect(result.authorized).toBe(false)
    if (!result.authorized) expect(result.response.status).toBe(401)
    expect(mocks.revalidateSessionActor).not.toHaveBeenCalled()
  })

  it("denies a wrong role with 403 without re-validating", async () => {
    useSession({ id: "s1", email: "s@test.local", role: "student" })
    const result = await requireRole("teacher")
    expect(result.authorized).toBe(false)
    if (!result.authorized) expect(result.response.status).toBe(403)
    expect(mocks.revalidateSessionActor).not.toHaveBeenCalled()
  })

  it("returns 401 when the actor no longer exists", async () => {
    useSession(TEACHER)
    mocks.revalidateSessionActor.mockResolvedValue(null)
    const result = await requireRole("teacher")
    expect(result.authorized).toBe(false)
    if (!result.authorized) expect(result.response.status).toBe(401)
  })

  it("returns 401 when the database role no longer matches the session", async () => {
    useSession(TEACHER)
    mocks.revalidateSessionActor.mockResolvedValue(null)
    const result = await requireUser()
    expect(result.authorized).toBe(false)
    if (!result.authorized) expect(result.response.status).toBe(401)
  })

  it("authorizes with the re-validated actor (fresh fields)", async () => {
    useSession(TEACHER)
    const fresh: AuthUser = { id: "t1", email: "renamed@test.local", role: "teacher" }
    mocks.revalidateSessionActor.mockResolvedValue(fresh)
    const result = await requireRole("teacher")
    expect(result).toEqual({ authorized: true, user: fresh })
    expect(mocks.revalidateSessionActor).toHaveBeenCalledWith(TEACHER)
  })
})
