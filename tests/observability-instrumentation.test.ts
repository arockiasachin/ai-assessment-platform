import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { resetProcessLoggerCache } from "@/lib/observability"

/**
 * The instrumentation file is runtime-dispatched: it is bundled for both the
 * Node.js and Edge instrumentation runtimes and dynamically imports the Node
 * implementation only when `NEXT_RUNTIME !== "edge"`. This test drives that
 * dispatch directly (bug-fix run 3 verified the observability layer still
 * registers and captures unhandled route errors on Node, and that the error line
 * stays redacted).
 */

const SECRET_DB = "postgresql://assessment_user:supersecret@db.internal:5432/assessment_x"

describe("instrumentation runtime dispatch", () => {
  let writes: string[]
  let writeSpy: ReturnType<typeof vi.spyOn>
  const saved = { LOG_LEVEL: process.env.LOG_LEVEL, NEXT_RUNTIME: process.env.NEXT_RUNTIME }

  beforeEach(() => {
    writes = []
    process.env.LOG_LEVEL = "info"
    process.env.NEXT_RUNTIME = "nodejs"
    resetProcessLoggerCache()
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString())
      return true
    }) as typeof process.stdout.write)
  })

  afterEach(() => {
    writeSpy.mockRestore()
    if (saved.LOG_LEVEL === undefined) delete process.env.LOG_LEVEL
    else process.env.LOG_LEVEL = saved.LOG_LEVEL
    if (saved.NEXT_RUNTIME === undefined) delete process.env.NEXT_RUNTIME
    else process.env.NEXT_RUNTIME = saved.NEXT_RUNTIME
    resetProcessLoggerCache()
  })

  it("registers on Node and emits app.start", async () => {
    const { register } = await import("@/instrumentation")
    await register()
    expect(writes.join("")).toContain('"event":"app.start"')
  })

  it("captures an unhandled route error on Node and redacts a connection string", async () => {
    const { onRequestError } = await import("@/instrumentation")
    await onRequestError(
      new Error(`connect failed ${SECRET_DB}`),
      { path: "/api/x", method: "POST", headers: { "x-request-id": "req-123" } },
      {
        routerKind: "App Router",
        routePath: "/api/x",
        routeType: "route",
        revalidateReason: undefined,
      },
    )

    const line = writes.join("")
    expect(line).toContain('"event":"http.unhandled_error"')
    expect(line).toContain('"requestId":"req-123"')
    expect(line).not.toContain("supersecret")
    expect(line).not.toContain("db.internal")
    expect(line).not.toContain("postgresql")
  })

  it("does not touch Node-only logging on the edge runtime", async () => {
    process.env.NEXT_RUNTIME = "edge"
    const { register, onRequestError } = await import("@/instrumentation")

    await register()
    await onRequestError(
      new Error("edge boom"),
      { path: "/", method: "GET", headers: {} },
      {
        routerKind: "App Router",
        routePath: "/",
        routeType: "route",
        revalidateReason: undefined,
      },
    )

    const line = writes.join("")
    expect(line).not.toContain("app.start")
    expect(line).not.toContain("edge boom")
  })
})
