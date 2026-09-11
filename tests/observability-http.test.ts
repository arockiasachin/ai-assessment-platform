import { describe, expect, it } from "vitest"
import { NextResponse } from "next/server"

import { createLogger, type LogRecord, updateLogContext, withApiRoute } from "@/lib/observability"

function capture() {
  const records: LogRecord[] = []
  const logger = createLogger({
    sink: (_line, record) => records.push(record),
    level: "debug",
    now: () => new Date(0),
  })
  return { records, logger }
}

describe("withApiRoute", () => {
  it("logs a completion line with status and duration and echoes the correlation id", async () => {
    const { records, logger } = capture()
    const handler = withApiRoute(
      async () => {
        updateLogContext({ userId: "user-42", userRole: "teacher" })
        return NextResponse.json({ success: true })
      },
      { route: "/api/test", logger },
    )

    const response = await handler(
      new Request("https://app.test/api/test", { headers: { "x-request-id": "req-abc" } }),
      undefined,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("x-request-id")).toBe("req-abc")

    const completion = records.find((record) => record.event === "http.response")
    expect(completion).toMatchObject({
      level: "info",
      route: "/api/test",
      method: "GET",
      requestId: "req-abc",
      status: 200,
      userId: "user-42",
      userRole: "teacher",
    })
    expect(typeof completion?.durationMs).toBe("number")
  })

  it("mints a correlation id when the proxy did not provide one", async () => {
    const { records, logger } = capture()
    const handler = withApiRoute(async () => NextResponse.json({}), { route: "/api/x", logger })
    const response = await handler(new Request("https://app.test/api/x"), undefined)
    const completion = records.find((record) => record.event === "http.response")
    expect(completion?.requestId).toBeTruthy()
    expect(response.headers.get("x-request-id")).toBe(completion?.requestId)
  })

  it("captures an unhandled error, logs it with a stack, and returns a generic 500", async () => {
    const { records, logger } = capture()
    const handler = withApiRoute(
      async () => {
        throw Object.assign(new Error("kaboom"), { name: "ExplosionError" })
      },
      { route: "/api/boom", logger },
    )

    const response = await handler(new Request("https://app.test/api/boom"), undefined)
    expect(response.status).toBe(500)
    const body = (await response.json()) as { message: string }
    expect(body.message).toBe("Unable to complete the request.")

    const failure = records.find((record) => record.event === "http.unhandled_error")
    expect(failure?.level).toBe("error")
    expect(failure?.error).toMatchObject({ name: "ExplosionError", message: "kaboom" })
    expect(String((failure?.error as { stack?: string }).stack)).toContain(
      "observability-http.test",
    )

    // The completion line still records the failure status.
    const completion = records.find((record) => record.event === "http.response")
    expect(completion).toMatchObject({ status: 500, route: "/api/boom" })
  })
})
