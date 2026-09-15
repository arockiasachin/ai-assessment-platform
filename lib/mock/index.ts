/**
 * Typed mock-data layer for the mockup tree.
 *
 * Everything here is static, deterministic and free of I/O: a page can import
 * exactly what it needs from `@/lib/mock` and render on the server with no
 * fetch, no effect and no database. String unions mirror the Prisma enums, and
 * every numeric field that can legitimately be absent is nullable.
 *
 * Module map:
 *  - `types`         every UI view model
 *  - `format`        pure formatting helpers (UTC dates, fixed mock clock)
 *  - `session`       current user per role + the notification feed
 *  - `course`        course, roster, assessments, rubric, shared marks table
 *  - `quizzes`       quiz questions, attempts, item analysis
 *  - `submissions`   teacher submission rows + the demo student's own rows
 *  - `reviews`       AI suggestions, review queue, published/unpublished grades
 *  - `groups`        teams, CATME peer evaluations, milestones, contributions
 *  - `code-tasks`    sandboxed task, test cases, runs, similarity verdicts
 *  - `analytics`     distribution, trend, topic mastery, ratings, at-risk
 *  - `lms`           export/integration rows and the audit trail
 *  - `admin`         users, offerings, datasets
 *  - `dashboards`    KPI sets, sparkline series, calendar events
 */

export * from "./types"
export * from "./format"
export * from "./session"
export * from "./course"
export * from "./quizzes"
export * from "./submissions"
export * from "./reviews"
export * from "./groups"
export * from "./code-tasks"
export * from "./analytics"
export * from "./resources"
export * from "./lms"
export * from "./admin"
export * from "./dashboards"
