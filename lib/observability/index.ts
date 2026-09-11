/**
 * Structured observability primitives.
 *
 * This barrel intentionally excludes the Prisma-backed audit view
 * (`./audit-view`) so that importing the logger/wrapper never pulls the
 * database client into a pure unit test or the proxy bundle.
 */
export * from "./context"
export * from "./errors"
export * from "./event"
export * from "./http"
export * from "./ids"
export * from "./logger"
export * from "./redact"
