/**
 * Pure analytics helpers.
 *
 * This barrel intentionally exports only database-free modules: the legacy
 * mark-map helpers, item analysis, cohort distribution, intervention alerts,
 * adaptive retake selection, and the pod error type. Existing client
 * components import `@/lib/analytics`, so pulling `./service` (which imports
 * Prisma) in here would drag the database client into the browser bundle. The
 * DB-backed service is imported directly from `@/lib/analytics/service` by
 * route handlers.
 */
export * from "./legacy"
export * from "./item-analysis"
export * from "./cohort"
export * from "./alerts"
export * from "./settings"
export * from "./retake"
export * from "./errors"
