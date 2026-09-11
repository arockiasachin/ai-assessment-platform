import { describe, expect, it } from "vitest"

import { createSessionActorRevalidator } from "@/lib/authz-actor"
import type { AuthUser } from "@/lib/session"

/**
 * Deterministic coverage of the session actor re-validator (Phase 3 item S-2).
 *
 * Every test injects its own lookup and clock, so the cache TTL and the
 * fail-closed / role-match rules are observed without a database or real time.
 */

const CLAIMED: AuthUser = { id: "u1", email: "old@test.local", role: "teacher" }

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return { id: "u1", email: "old@test.local", role: "teacher", ...overrides }
}

describe("createSessionActorRevalidator", () => {
  it("returns the current actor when the row exists and the role matches", async () => {
    const revalidate = createSessionActorRevalidator({
      lookup: async () => user({ email: "fresh@test.local" }),
      now: () => 0,
    })
    await expect(revalidate(CLAIMED)).resolves.toEqual(
      user({ email: "fresh@test.local", role: "teacher" }),
    )
  })

  it("rejects a deleted user", async () => {
    const revalidate = createSessionActorRevalidator({ lookup: async () => null, now: () => 0 })
    await expect(revalidate(CLAIMED)).resolves.toBeNull()
  })

  it("rejects a demoted user whose database role no longer matches the session", async () => {
    const revalidate = createSessionActorRevalidator({
      lookup: async () => user({ role: "student" }),
      now: () => 0,
    })
    await expect(revalidate(CLAIMED)).resolves.toBeNull()
  })

  it("fails closed (and never caches) when the lookup throws", async () => {
    let attempts = 0
    const revalidate = createSessionActorRevalidator({
      lookup: async () => {
        attempts += 1
        throw new Error("database unavailable")
      },
      now: () => 0,
    })
    await expect(revalidate(CLAIMED)).resolves.toBeNull()
    await expect(revalidate(CLAIMED)).resolves.toBeNull()
    expect(attempts).toBe(2)
  })

  it("serves from cache inside the TTL and refreshes after it", async () => {
    let now = 0
    let calls = 0
    const revalidate = createSessionActorRevalidator({
      lookup: async () => {
        calls += 1
        return user()
      },
      ttlMs: 1_000,
      now: () => now,
    })

    await revalidate(CLAIMED)
    now = 500
    await revalidate(CLAIMED)
    expect(calls).toBe(1)

    now = 1_001
    await revalidate(CLAIMED)
    expect(calls).toBe(2)
  })

  it("serves the cached role inside the TTL (the documented staleness window)", async () => {
    let now = 0
    let role: AuthUser["role"] = "teacher"
    let calls = 0
    const revalidate = createSessionActorRevalidator({
      lookup: async () => {
        calls += 1
        return user({ role })
      },
      ttlMs: 60_000,
      now: () => now,
    })

    await expect(revalidate(CLAIMED)).resolves.toMatchObject({ role: "teacher" })
    role = "student"
    // Within the TTL the cached row is served, so the demotion is not observed
    // until the entry expires. This is the documented trade-off.
    await expect(revalidate(CLAIMED)).resolves.toMatchObject({ role: "teacher" })
    expect(calls).toBe(1)

    now = 60_001
    await expect(revalidate(CLAIMED)).resolves.toBeNull()
    expect(calls).toBe(2)
  })

  it("caches the deleted-user result for the TTL", async () => {
    let calls = 0
    let now = 0
    const revalidate = createSessionActorRevalidator({
      lookup: async () => {
        calls += 1
        return null
      },
      ttlMs: 1_000,
      now: () => now,
    })
    await revalidate(CLAIMED)
    now = 900
    await revalidate(CLAIMED)
    expect(calls).toBe(1)
  })

  it("with a zero TTL always re-reads the database", async () => {
    let calls = 0
    const revalidate = createSessionActorRevalidator({
      lookup: async () => {
        calls += 1
        return user()
      },
      ttlMs: 0,
      now: () => 0,
    })
    await revalidate(CLAIMED)
    await revalidate(CLAIMED)
    expect(calls).toBe(2)
  })

  it("bounds the cache by evicting the oldest actor", async () => {
    let calls = 0
    const revalidate = createSessionActorRevalidator({
      lookup: async (id) => {
        calls += 1
        return { id, email: `${id}@test.local`, role: "teacher" }
      },
      ttlMs: 60_000,
      maxEntries: 1,
      now: () => 0,
    })
    const first = { id: "a", email: "a@test.local", role: "teacher" as const }
    const second = { id: "b", email: "b@test.local", role: "teacher" as const }

    await revalidate(first) // lookup a → cached
    await revalidate(second) // lookup b, evict a
    await revalidate(second) // b still cached → no lookup
    await revalidate(first) // a was evicted → lookup again
    expect(calls).toBe(3)
  })
})
