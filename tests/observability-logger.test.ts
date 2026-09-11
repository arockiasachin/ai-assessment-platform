import { describe, expect, it } from "vitest"

import { createLogger, isLevelEnabled, resolveLogLevel, type LogRecord } from "@/lib/observability"

function capture(level: Parameters<typeof createLogger>[0]["level"] = "debug") {
  const lines: string[] = []
  const records: LogRecord[] = []
  const logger = createLogger({
    sink: (line, record) => {
      lines.push(line)
      records.push(record)
    },
    level,
    now: () => new Date("2026-01-02T03:04:05.000Z"),
    service: "test-service",
  })
  return { logger, lines, records }
}

describe("structured logger core", () => {
  it("emits one JSON line with the required envelope fields", () => {
    const { logger, lines } = capture()
    logger.info("http.response", {
      requestId: "req-1",
      route: "/api/thing",
      method: "GET",
      status: 200,
      durationMs: 12,
      userId: "user-1",
      userRole: "teacher",
    })

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0]!) as Record<string, unknown>
    expect(record).toMatchObject({
      timestamp: "2026-01-02T03:04:05.000Z",
      level: "info",
      event: "http.response",
      service: "test-service",
      requestId: "req-1",
      route: "/api/thing",
      method: "GET",
      status: 200,
      durationMs: 12,
      userId: "user-1",
      userRole: "teacher",
    })
  })

  it("drops records below the configured threshold", () => {
    const { logger, lines } = capture("warn")
    logger.debug("debug.event")
    logger.info("info.event")
    logger.warn("warn.event")
    logger.error("error.event")
    expect(lines.map((line) => JSON.parse(line).event)).toEqual(["warn.event", "error.event"])
  })

  it("emits nothing when silent", () => {
    const { logger, lines } = capture("silent")
    logger.error("error.event")
    expect(lines).toHaveLength(0)
  })

  it("merges child base fields into every record", () => {
    const { logger, lines } = capture()
    logger.child({ component: "llm" }).info("llm.generate", { task: "rubric-grading" })
    expect(JSON.parse(lines[0]!)).toMatchObject({
      component: "llm",
      event: "llm.generate",
      task: "rubric-grading",
    })
  })

  it("does not throw on a value JSON cannot serialize", () => {
    const { logger, lines } = capture()
    expect(() => logger.info("weird", { value: BigInt(10) })).not.toThrow()
    const record = JSON.parse(lines[0]!) as Record<string, unknown>
    expect(record.serializationError).toBe(true)
    expect(record.event).toBe("weird")
  })

  it("resolves LOG_LEVEL, defaulting tests to silent", () => {
    expect(resolveLogLevel({ LOG_LEVEL: "debug" })).toBe("debug")
    expect(resolveLogLevel({ LOG_LEVEL: "silent" })).toBe("silent")
    expect(resolveLogLevel({})).toBe("info")
    expect(resolveLogLevel({ NODE_ENV: "test" })).toBe("silent")
    expect(resolveLogLevel({ NODE_ENV: "test", LOG_LEVEL: "warn" })).toBe("warn")
  })

  it("isLevelEnabled orders levels correctly", () => {
    expect(isLevelEnabled("info", "debug")).toBe(false)
    expect(isLevelEnabled("info", "info")).toBe(true)
    expect(isLevelEnabled("warn", "error")).toBe(true)
    expect(isLevelEnabled("silent", "error")).toBe(false)
  })
})
