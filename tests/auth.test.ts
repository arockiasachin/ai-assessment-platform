import { NextRequest } from "next/server"
import { describe, expect, it } from "vitest"

import { proxy } from "@/proxy"
import {
  getSessionSecret,
  signSessionValue,
  verifySessionValue,
  type AuthUser,
} from "@/lib/session"

const SECRET = "unit-test-session-secret"

const adminUser: AuthUser = { id: "user-admin", email: "admin@test.local", role: "admin" }
const teacherUser: AuthUser = { id: "user-teacher", email: "teacher@test.local", role: "teacher" }

describe("signed session values", () => {
  it("round-trips a correctly signed session", () => {
    const value = signSessionValue(adminUser, { secret: SECRET })
    expect(verifySessionValue(value, { secret: SECRET })).toEqual(adminUser)
  })

  it("rejects the legacy unsigned plaintext JSON cookie that forges an admin role", () => {
    const forgedLegacy = JSON.stringify({
      user: { id: "attacker", email: "attacker@test.local", role: "admin" },
      expiresAt: Date.now() + 60_000,
    })

    expect(verifySessionValue(forgedLegacy, { secret: SECRET })).toBeNull()

    // The base64url variant of the same forgery is also rejected.
    const forgedEncoded = Buffer.from(forgedLegacy, "utf8").toString("base64url")
    expect(verifySessionValue(forgedEncoded, { secret: SECRET })).toBeNull()
  })

  it("rejects a tampered payload that reuses a valid signature", () => {
    const signed = signSessionValue(teacherUser, { secret: SECRET })
    const signature = signed.slice(signed.indexOf(".") + 1)

    const forgedPayload = Buffer.from(
      JSON.stringify({
        user: { id: "attacker", email: "attacker@test.local", role: "admin" },
        expiresAt: Date.now() + 60_000,
      }),
      "utf8",
    ).toString("base64url")

    expect(verifySessionValue(`${forgedPayload}.${signature}`, { secret: SECRET })).toBeNull()
  })

  it("rejects a session signed with a different secret", () => {
    const value = signSessionValue(adminUser, { secret: "some-other-secret" })
    expect(verifySessionValue(value, { secret: SECRET })).toBeNull()
  })

  it("rejects expired, malformed, and empty values", () => {
    const now = Date.now()
    const expired = signSessionValue(adminUser, { secret: SECRET, now, maxAgeMs: 1_000 })
    expect(verifySessionValue(expired, { secret: SECRET, now: now + 2_000 })).toBeNull()

    expect(verifySessionValue("not-a-session", { secret: SECRET })).toBeNull()
    expect(verifySessionValue("..", { secret: SECRET })).toBeNull()
    expect(verifySessionValue("", { secret: SECRET })).toBeNull()
    expect(verifySessionValue(null, { secret: SECRET })).toBeNull()
  })

  it("fails loudly in production when SESSION_SECRET is unset", () => {
    expect(() => getSessionSecret({ NODE_ENV: "production" })).toThrow(/SESSION_SECRET/)
    expect(getSessionSecret({ NODE_ENV: "production", SESSION_SECRET: "configured" })).toBe(
      "configured",
    )
    expect(getSessionSecret({ NODE_ENV: "development" }).length).toBeGreaterThan(0)
  })
})

describe("proxy route gate", () => {
  it("redirects a forged admin cookie away from /admin", () => {
    const forged = JSON.stringify({
      user: { id: "attacker", email: "attacker@test.local", role: "admin" },
      expiresAt: Date.now() + 60_000,
    })
    const request = new NextRequest("https://app.test/admin", {
      headers: { cookie: `auth-user=${encodeURIComponent(forged)}` },
    })

    const response = proxy(request)
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("https://app.test/login")
  })

  it("allows a correctly signed admin cookie through /admin", () => {
    const signed = signSessionValue(adminUser)
    const request = new NextRequest("https://app.test/admin", {
      headers: { cookie: `auth-user=${signed}` },
    })

    const response = proxy(request)
    expect(response.headers.get("x-middleware-next")).toBe("1")
  })

  it("protects /quiz for unauthenticated visitors", () => {
    const request = new NextRequest("https://app.test/quiz")
    const response = proxy(request)
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("https://app.test/login")
  })
})
