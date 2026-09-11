import { describe, expect, it } from "vitest"

import { createLogger, isSensitiveKey, redactValue, scrubString } from "@/lib/observability"
import { SESSION_COOKIE_NAME, signSessionValue } from "@/lib/session"

/** Log one record and return the serialized line. */
function logLine(fields: Record<string, unknown>): string {
  const lines: string[] = []
  const logger = createLogger({
    sink: (line) => lines.push(line),
    level: "debug",
    now: () => new Date(0),
  })
  logger.info("redaction.probe", fields)
  expect(lines).toHaveLength(1)
  return lines[0]!
}

const SESSION_VALUE = signSessionValue({
  id: "user-1",
  email: "teacher@test.local",
  role: "teacher",
})
const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
const POSTGRES_URL =
  "postgresql://assessment_user:assessment_pass@127.0.0.1:5432/assessment_dashboard"
const BEARER = "Bearer sk-live-0123456789abcdef"

/**
 * The redaction proof. Each raw secret below is distinctive; if any of them
 * appears in the serialized log line, this test fails.
 */
describe("log redaction", () => {
  it("never serializes secrets, passwords, tokens, or cookie values", () => {
    const line = logLine({
      password: "hunter2-password",
      passwordHash: "$2b$10$ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      sessionSecret: "session-secret-value",
      apiKey: "sk-live-api-key",
      accessToken: "access-token-value",
      refreshToken: "refresh-token-value",
      databaseUrl: POSTGRES_URL,
      connectionString: POSTGRES_URL,
      headers: {
        authorization: BEARER,
        cookie: `${SESSION_COOKIE_NAME}=${SESSION_VALUE}`,
        "set-cookie": `${SESSION_COOKIE_NAME}=${SESSION_VALUE}; Path=/`,
      },
      nested: { providerOptions: { apiKey: "sk-nested-secret" }, note: `connect ${POSTGRES_URL}` },
      message: `auth failed for ${SESSION_VALUE}`,
    })

    const forbidden = [
      "hunter2-password",
      "$2b$10$ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      "session-secret-value",
      "sk-live-api-key",
      "access-token-value",
      "refresh-token-value",
      "assessment_pass",
      "assessment_user:",
      "sk-live-0123456789abcdef",
      "sk-nested-secret",
      SESSION_VALUE,
      JWT,
    ]
    for (const secret of forbidden) {
      expect(line).not.toContain(secret)
    }
    expect(line).toContain("[redacted]")
  })

  it("keeps non-sensitive operational fields intact", () => {
    const line = logLine({
      status: 200,
      durationMs: 7,
      route: "/api/x",
      method: "GET",
      requestId: "req-1",
      userId: "u1",
      userRole: "teacher",
      promptTokens: 123,
      completionTokens: 45,
      totalTokens: 168,
    })
    const record = JSON.parse(line) as Record<string, unknown>
    expect(record).toMatchObject({
      status: 200,
      durationMs: 7,
      route: "/api/x",
      method: "GET",
      requestId: "req-1",
      userId: "u1",
      userRole: "teacher",
      promptTokens: 123,
      completionTokens: 45,
      totalTokens: 168,
    })
  })

  it("classifies keys, redacting secrets but preserving usage counters", () => {
    for (const key of [
      "password",
      "passwordHash",
      "sessionSecret",
      "session_secret",
      "accessToken",
      "refreshToken",
      "apiKey",
      "x-api-key",
      "authorization",
      "cookie",
      "set-cookie",
      "databaseUrl",
      "connectionString",
      "privateKey",
      "sessionId",
    ]) {
      expect(isSensitiveKey(key), key).toBe(true)
    }
    for (const key of [
      "promptTokens",
      "completionTokens",
      "totalTokens",
      "requestId",
      "userId",
      "route",
      "status",
      "durationMs",
      "latencyMs",
    ]) {
      expect(isSensitiveKey(key), key).toBe(false)
    }
  })

  it("scrubs credentials embedded in free text", () => {
    expect(scrubString(`connect to ${POSTGRES_URL} now`)).not.toContain("assessment_pass")
    expect(scrubString(`connect to ${POSTGRES_URL} now`)).toContain("[redacted-url]")
    expect(scrubString(BEARER)).toContain("[redacted]")
    expect(scrubString(BEARER)).not.toContain("sk-live")
    expect(scrubString(`cookie auth-user=${SESSION_VALUE}`)).not.toContain(SESSION_VALUE)
    expect(scrubString(`token ${JWT}`)).not.toContain(JWT)
    expect(scrubString("/api/x?token=abc123&y=1")).toBe("/api/x?token=[redacted]&y=1")
  })

  it("does not throw or loop on cyclic values", () => {
    const cyclic: Record<string, unknown> = { name: "root" }
    cyclic.self = cyclic
    expect(() => redactValue(cyclic)).not.toThrow()
    expect(JSON.stringify(redactValue(cyclic))).toContain("[circular]")
  })
})
