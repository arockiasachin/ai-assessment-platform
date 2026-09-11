import bcrypt from "bcryptjs"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Login throttling regression coverage (Phase 3 item S-1).
 *
 * Two layers:
 *  - the pure sliding-window / throttle logic, driven by an injected clock and
 *    store so every assertion is deterministic; and
 *  - the real `POST /api/auth/login` handler with the database mocked, proving
 *    the throttle is consulted before the lookup, locks out after the
 *    configured failure count, resets on success, and never reveals whether an
 *    account exists.
 */
const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }))

vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.findUnique } } }))

import { POST } from "@/app/api/auth/login/route"
import {
  LoginAttemptThrottle,
  SlidingWindowCounter,
  configureLoginAttemptThrottle,
  normalizeLoginIdentifier,
  resolveLoginRateLimitConfig,
} from "@/lib/login-rate-limit"

const PASSWORD = "correct-horse-battery"
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 10)
const KNOWN_EMAIL = "known@test.local"

function jsonRequest(email: string, password: string, ip?: string) {
  return new Request("https://app.test/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(ip ? { "x-forwarded-for": ip } : {}),
    },
    body: JSON.stringify({ email, password }),
  })
}

describe("SlidingWindowCounter", () => {
  it("blocks at the failure threshold and forgets failures outside the window", () => {
    let now = 0
    const counter = new SlidingWindowCounter({
      maxFailures: 3,
      windowMs: 1_000,
      maxEntries: 10,
      now: () => now,
    })

    counter.recordFailure("k")
    counter.recordFailure("k")
    expect(counter.isBlocked("k")).toBe(false)
    counter.recordFailure("k")
    expect(counter.isBlocked("k")).toBe(true)
    expect(counter.retryAfterMs("k")).toBe(1_000)

    // One millisecond past the window, the old failures are gone.
    now = 1_001
    expect(counter.isBlocked("k")).toBe(false)
    expect(counter.retryAfterMs("k")).toBe(0)
  })

  it("keeps at most maxFailures timestamps per key", () => {
    const store = new Map<string, number[]>()
    const counter = new SlidingWindowCounter({
      maxFailures: 3,
      windowMs: 60_000,
      maxEntries: 10,
      now: () => 0,
      store,
    })
    for (let i = 0; i < 10; i += 1) counter.recordFailure("k")
    expect(store.get("k")).toHaveLength(3)
  })

  it("bounds the store by evicting the oldest bucket at capacity", () => {
    const counter = new SlidingWindowCounter({
      maxFailures: 3,
      windowMs: 60_000,
      maxEntries: 2,
      now: () => 0,
    })
    counter.recordFailure("a")
    counter.recordFailure("b")
    counter.recordFailure("c")
    expect(counter.size).toBe(2)
    // "a" was the oldest and is evicted; "b" and "c" remain blocked-tracking.
    expect(counter.isBlocked("a")).toBe(false)
    expect(counter.isBlocked("b")).toBe(false)
    expect(counter.size).toBe(2)
  })

  it("reset clears a key", () => {
    const counter = new SlidingWindowCounter({
      maxFailures: 1,
      windowMs: 60_000,
      maxEntries: 10,
      now: () => 0,
    })
    counter.recordFailure("k")
    expect(counter.isBlocked("k")).toBe(true)
    counter.reset("k")
    expect(counter.isBlocked("k")).toBe(false)
    expect(counter.size).toBe(0)
  })
})

describe("LoginAttemptThrottle", () => {
  function makeThrottle(now: () => number) {
    return LoginAttemptThrottle.create({ maxFailures: 3, windowMs: 60_000, maxEntries: 100 }, now)
  }

  it("normalizes the identifier the same way the route does", () => {
    expect(normalizeLoginIdentifier("  User@Test.Local ")).toBe("user@test.local")
  })

  it("locks a single identifier after the threshold", () => {
    const now = () => 0
    const throttle = makeThrottle(now)
    for (let i = 0; i < 3; i += 1) {
      expect(throttle.check("a@test.local", null).limited).toBe(false)
      throttle.recordFailure("a@test.local", null)
    }
    const decision = throttle.check("a@test.local", null)
    expect(decision.limited).toBe(true)
    if (decision.limited) expect(decision.retryAfterSeconds).toBeGreaterThanOrEqual(1)
    // A different identifier is unaffected.
    expect(throttle.check("b@test.local", null).limited).toBe(false)
  })

  it("does not extend the lockout while blocked (hammering is free)", () => {
    let nowMs = 0
    const throttle = makeThrottle(() => nowMs)
    for (let i = 0; i < 3; i += 1) throttle.recordFailure("a@test.local", null)
    for (let i = 0; i < 10; i += 1) {
      nowMs += 1_000
      expect(throttle.check("a@test.local", null).limited).toBe(true)
    }
    // 10s of hammering is within the 60s window, so the lockout still expires
    // relative to the original failures, not the checks.
    nowMs = 60_001
    expect(throttle.check("a@test.local", null).limited).toBe(false)
  })

  it("locks a client IP across many identifiers", () => {
    const throttle = makeThrottle(() => 0)
    for (const email of ["a@t.local", "b@t.local", "c@t.local"]) {
      throttle.recordFailure(email, "203.0.113.9")
    }
    expect(throttle.check("d@t.local", "203.0.113.9").limited).toBe(true)
    expect(throttle.check("d@t.local", "203.0.113.10").limited).toBe(false)
  })

  it("a successful login resets the identifier but not the address", () => {
    const throttle = makeThrottle(() => 0)
    for (const email of ["a@t.local", "a@t.local"]) throttle.recordFailure(email, "203.0.113.9")
    throttle.recordSuccess("a@t.local")
    expect(throttle.check("a@t.local", "203.0.113.9").limited).toBe(false)
    // The address still carries its failure history.
    throttle.recordFailure("a@t.local", "203.0.113.9")
    expect(throttle.check("a@t.local", "203.0.113.9").limited).toBe(true)
  })
})

describe("resolveLoginRateLimitConfig", () => {
  it("applies safe defaults", () => {
    expect(resolveLoginRateLimitConfig({})).toEqual({
      maxFailures: 5,
      windowMs: 15 * 60 * 1000,
      maxEntries: 10_000,
    })
  })

  it("reads overrides and ignores nonsensical values", () => {
    const config = resolveLoginRateLimitConfig({
      LOGIN_RATE_LIMIT_MAX_FAILURES: "3",
      LOGIN_RATE_LIMIT_WINDOW_SECONDS: "60",
      LOGIN_RATE_LIMIT_MAX_ENTRIES: "50",
    })
    expect(config).toEqual({ maxFailures: 3, windowMs: 60_000, maxEntries: 50 })

    const fallback = resolveLoginRateLimitConfig({
      LOGIN_RATE_LIMIT_MAX_FAILURES: "-1",
      LOGIN_RATE_LIMIT_WINDOW_SECONDS: "not-a-number",
    })
    expect(fallback.maxFailures).toBe(5)
    expect(fallback.windowMs).toBe(15 * 60 * 1000)
  })
})

describe("POST /api/auth/login throttling", () => {
  beforeEach(() => {
    mocks.findUnique.mockReset()
    mocks.findUnique.mockImplementation(async ({ where }: { where: { email: string } }) =>
      where.email === KNOWN_EMAIL
        ? { id: "user-1", email: KNOWN_EMAIL, role: "TEACHER", passwordHash: PASSWORD_HASH }
        : null,
    )
    // Fresh, deterministic throttle for every test.
    configureLoginAttemptThrottle(
      LoginAttemptThrottle.create({ maxFailures: 3, windowMs: 60_000, maxEntries: 100 }, () => 0),
    )
  })

  it("signs in a valid user", async () => {
    const response = await POST(jsonRequest(KNOWN_EMAIL, PASSWORD))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { user: { id: string; role: string } }
    expect(body.user).toMatchObject({ id: "user-1", role: "teacher" })
  })

  it("rejects wrong passwords with one generic message", async () => {
    const response = await POST(jsonRequest(KNOWN_EMAIL, "wrong"))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ success: false, message: "Invalid credentials." })
  })

  it("locks out after the failure threshold, even for the correct password", async () => {
    for (let i = 0; i < 3; i += 1) {
      expect((await POST(jsonRequest(KNOWN_EMAIL, "wrong"))).status).toBe(401)
    }
    const locked = await POST(jsonRequest(KNOWN_EMAIL, PASSWORD))
    expect(locked.status).toBe(429)
    expect(locked.headers.get("Retry-After")).toBeTruthy()
    expect(mocks.findUnique).toHaveBeenCalledTimes(3)
  })

  it("never reveals whether an account exists", async () => {
    const unknown = "nobody@test.local"
    for (let i = 0; i < 3; i += 1) {
      await POST(jsonRequest(unknown, "wrong"))
    }
    for (let i = 0; i < 3; i += 1) {
      await POST(jsonRequest(KNOWN_EMAIL, "wrong"))
    }
    const unknownLocked = await POST(jsonRequest(unknown, "wrong"))
    const knownLocked = await POST(jsonRequest(KNOWN_EMAIL, "wrong"))
    expect(unknownLocked.status).toBe(429)
    expect(knownLocked.status).toBe(429)
    expect(await unknownLocked.json()).toEqual(await knownLocked.json())
  })

  it("resets the counter on a successful login", async () => {
    await POST(jsonRequest(KNOWN_EMAIL, "wrong"))
    await POST(jsonRequest(KNOWN_EMAIL, "wrong"))
    expect((await POST(jsonRequest(KNOWN_EMAIL, PASSWORD))).status).toBe(200)

    // A successful login cleared the two failures: two more are still allowed.
    expect((await POST(jsonRequest(KNOWN_EMAIL, "wrong"))).status).toBe(401)
    expect((await POST(jsonRequest(KNOWN_EMAIL, "wrong"))).status).toBe(401)
    // The third failure since the reset reaches the threshold.
    expect((await POST(jsonRequest(KNOWN_EMAIL, "wrong"))).status).toBe(401)
    expect((await POST(jsonRequest(KNOWN_EMAIL, PASSWORD))).status).toBe(429)
  })

  it("throttles by client IP across unrelated identifiers", async () => {
    const ip = "198.51.100.7"
    for (const email of ["a@test.local", "b@test.local", "c@test.local"]) {
      expect((await POST(jsonRequest(email, "wrong", ip))).status).toBe(401)
    }
    expect((await POST(jsonRequest("d@test.local", "wrong", ip))).status).toBe(429)
    expect((await POST(jsonRequest("d@test.local", "wrong", "198.51.100.8"))).status).toBe(401)
  })
})
