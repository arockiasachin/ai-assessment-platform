import { prisma } from "@/lib/prisma"

/**
 * A **database-backed** sliding-window throttle for the free sample Run.
 *
 * "Free" must not mean "unthrottled": the Run path starts a Docker container, so
 * an unlimited Run button is a cheap way to exhaust the host even though it
 * consumes no graded attempt. The login throttle (`lib/login-rate-limit.ts`)
 * solves the same shape with an in-process `Map`, which is explicitly documented
 * as unsafe across instances (N instances admit ~N x the limit) — and the audit
 * flagged that as the platform's statelessness blocker. A free Run that a
 * multi-instance deployment multiplies by instance count would not be throttled
 * in the deployment the platform targets, so this counter is shared state.
 *
 * The store is the existing append-only `AuditLog`, keyed by `entityType`
 * (`CodeFreeRun`) and the student's profile id, which its
 * `(entityType, entityId, createdAt)` index serves directly. One row is written
 * per accepted run and the window is a `createdAt > cutoff` count — no schema
 * change, no counter row to keep consistent, and expiry is implicit (old rows
 * simply fall out of the window; there is no background job). The
 * `getRecentGradeActivityForTeacher` reader filters to grade-pipeline entity
 * types, so these rows never surface as grade activity.
 *
 * `pg_advisory_xact_lock` serializes concurrent runs for the same student across
 * *all* instances, so two requests cannot both read "under the limit" and both
 * start a container. The lock is scoped to the transaction and released with it.
 *
 * A dedicated throttle table is the right long-term home (program plan Track 2's
 * shared rate-limit store); until that exists, reusing the indexed audit table
 * keeps the guarantee without an unowned schema change.
 */

export const FREE_RUN_ENTITY_TYPE = "CodeFreeRun"
export const FREE_RUN_ACTION = "code_free_run.requested"

export type FreeRunThrottleConfig = {
  /** Accepted runs per window, per student. */
  maxRuns: number
  /** Window length in milliseconds. */
  windowMs: number
}

const DEFAULTS = { maxRuns: 20, windowSeconds: 60, maxRunsCeiling: 1_000, maxWindowSeconds: 86_400 }

function positiveInt(value: string | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback
  const parsed = Number.parseInt(value.trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, max)
}

/** Read the throttle configuration from the environment, with safe defaults. */
export function resolveFreeRunThrottleConfig(
  env: Record<string, string | undefined> = process.env,
): FreeRunThrottleConfig {
  return {
    maxRuns: positiveInt(
      env.CODE_FREE_RUN_MAX_PER_WINDOW,
      DEFAULTS.maxRuns,
      DEFAULTS.maxRunsCeiling,
    ),
    windowMs:
      positiveInt(
        env.CODE_FREE_RUN_WINDOW_SECONDS,
        DEFAULTS.windowSeconds,
        DEFAULTS.maxWindowSeconds,
      ) * 1000,
  }
}

export type FreeRunThrottleDecision =
  { allowed: true; remaining: number } | { allowed: false; retryAfterSeconds: number }

/**
 * Reserve one free-run slot for a student, or refuse with a retry delay.
 *
 * The slot is consumed by an accepted request *before* Docker starts, so a
 * refused request never reaches the sandbox and an accepted one is counted even
 * if the sandbox then fails (a failing run still used the host). Injectable
 * `now`/`config` keep the tests deterministic.
 */
export async function consumeFreeRunSlot(
  studentId: string,
  options: { now?: Date; config?: FreeRunThrottleConfig } = {},
): Promise<FreeRunThrottleDecision> {
  const now = options.now ?? new Date()
  const config = options.config ?? resolveFreeRunThrottleConfig()
  const cutoff = new Date(now.getTime() - config.windowMs)
  const lockKey = `${FREE_RUN_ENTITY_TYPE}:${studentId}`

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`

    const window = {
      entityType: FREE_RUN_ENTITY_TYPE,
      entityId: studentId,
      createdAt: { gt: cutoff },
    } as const

    const used = await tx.auditLog.count({ where: window })
    if (used >= config.maxRuns) {
      const oldest = await tx.auditLog.findFirst({
        where: window,
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      })
      const retryMs = oldest
        ? Math.max(0, oldest.createdAt.getTime() + config.windowMs - now.getTime())
        : config.windowMs
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)) }
    }

    await tx.auditLog.create({
      data: {
        entityType: FREE_RUN_ENTITY_TYPE,
        entityId: studentId,
        action: FREE_RUN_ACTION,
        actorId: null,
        actorRole: "student",
      },
    })
    return { allowed: true, remaining: config.maxRuns - used - 1 }
  })
}
