/**
 * Dependency-free structured logger core.
 *
 * The core is pure: it takes an injected sink and clock, so tests are
 * deterministic and nothing writes to stdout unless a sink is provided. The
 * process-wide logger (console sink, level from `LOG_LEVEL`) is created lazily
 * by `getProcessLogger`.
 *
 * Every record is serialized as a single JSON line and passed through the
 * redactor first, so a secret can never reach the sink regardless of which
 * caller produced it. See `docs/observability.md` for the log line shape.
 */

import { redactValue } from "./redact"

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const

export type ActiveLogLevel = (typeof LOG_LEVELS)[number]

/** `"silent"` disables all output; used as the test default. */
export type LogLevel = ActiveLogLevel | "silent"

const LEVEL_WEIGHT: Record<ActiveLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

export const DEFAULT_SERVICE_NAME = "assessment-platform"

export type LogRecord = {
  timestamp: string
  level: ActiveLogLevel
  event: string
  service: string
  [field: string]: unknown
}

export type LogSink = (line: string, record: LogRecord) => void

export type LoggerOptions = {
  sink: LogSink
  /** Threshold; records below it are dropped. Defaults to `"info"`. */
  level?: LogLevel
  /** Injected clock for deterministic timestamps. */
  now?: () => Date
  /** Fields merged into every record (e.g. `{ component: "llm" }`). */
  base?: Record<string, unknown>
  service?: string
}

export type Logger = {
  readonly level: LogLevel
  debug(event: string, fields?: Record<string, unknown>): void
  info(event: string, fields?: Record<string, unknown>): void
  warn(event: string, fields?: Record<string, unknown>): void
  error(event: string, fields?: Record<string, unknown>): void
  child(base: Record<string, unknown>): Logger
}

/** True when a record at `level` should be emitted under `configured`. */
export function isLevelEnabled(configured: LogLevel, level: ActiveLogLevel): boolean {
  if (configured === "silent") return false
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[configured]
}

export function createLogger(options: LoggerOptions): Logger {
  const { sink, now = () => new Date() } = options
  const level = options.level ?? "info"
  const service = options.service ?? DEFAULT_SERVICE_NAME
  const base = options.base ?? {}

  function emit(
    recordLevel: ActiveLogLevel,
    event: string,
    fields: Record<string, unknown> | undefined,
  ): void {
    if (!isLevelEnabled(level, recordLevel)) return

    const record: LogRecord = {
      timestamp: now().toISOString(),
      level: recordLevel,
      event,
      service,
      ...base,
      ...fields,
    }

    // Redact the whole record, not just `fields`, so base fields and future
    // additions are covered by the same policy.
    const redacted = redactValue(record) as LogRecord
    let line: string
    try {
      line = JSON.stringify(redacted)
    } catch {
      line = JSON.stringify({
        timestamp: record.timestamp,
        level: recordLevel,
        event,
        service,
        serializationError: true,
      })
    }
    sink(line, redacted)
  }

  return {
    level,
    debug: (event, fields) => emit("debug", event, fields),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
    child: (childBase) => createLogger({ ...options, base: { ...base, ...childBase } }),
  }
}

/** Write one JSON line to stdout. The only sink the app uses in production. */
export const consoleSink: LogSink = (line) => {
  process.stdout.write(`${line}\n`)
}

/**
 * Resolve the threshold from `LOG_LEVEL`. `silent|off|none` disables output.
 * Tests default to silent so suites do not spam stdout unless they opt in.
 */
export function resolveLogLevel(
  env: { LOG_LEVEL?: string; NODE_ENV?: string } = process.env,
): LogLevel {
  const raw = (env.LOG_LEVEL ?? "").trim().toLowerCase()
  if (raw === "silent" || raw === "off" || raw === "none") return "silent"
  if ((LOG_LEVELS as readonly string[]).includes(raw)) return raw as ActiveLogLevel
  if (env.NODE_ENV === "test") return "silent"
  return "info"
}

let processLogger: Logger | undefined

/** The process-wide logger, constructed lazily on first use. */
export function getProcessLogger(): Logger {
  if (!processLogger) {
    processLogger = createLogger({ sink: consoleSink, level: resolveLogLevel() })
  }
  return processLogger
}

/** Test helper: drop the cached logger so a changed `LOG_LEVEL` takes effect. */
export function resetProcessLoggerCache(): void {
  processLogger = undefined
}
