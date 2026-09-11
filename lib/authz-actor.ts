import { prisma } from "@/lib/prisma"
import type { AuthRole, AuthUser } from "@/lib/session"

/**
 * Session role re-validation (Phase 3 item S-2).
 *
 * A signed session carries `{id, email, role}` for up to seven days. Without a
 * check, a user who is demoted (teacher → student) or deleted keeps their old
 * role until the cookie expires. {@link revalidateSessionActor} closes that hole
 * by confirming, on the authorization path, that the actor still exists and that
 * the database role matches the role the session claims. Anything else is a
 * `null` (→ 401 at the caller).
 *
 * This is deliberately *not* in `proxy.ts`: the proxy stays a cheap redirect
 * layer, and the database check happens in `requireRole` / `requireUser` where
 * the authorization decision is actually made.
 *
 * CACHE TRADE-OFF
 * ---------------
 * A lookup on every request would be correct but expensive, so a short-lived
 * cache (default 30s, `SESSION_REVALIDATION_TTL_SECONDS`) absorbs a burst. The
 * cost is a bounded staleness window: a demoted or deleted user can keep acting
 * for at most the TTL. 30 seconds is small relative to the 7-day session and
 * still removes the per-request query; set the TTL to 0 to disable caching
 * entirely. The cache is per process and bounded (`maxEntries`, oldest evicted).
 *
 * FAIL CLOSED
 * -----------
 * A lookup error is treated as "not confirmed" (401) and is never cached, so a
 * brief database outage denies access rather than trusting a stale role.
 */

const DB_ROLE: Record<string, AuthRole> = {
  ADMIN: "admin",
  TEACHER: "teacher",
  STUDENT: "student",
}

export const DEFAULT_SESSION_REVALIDATION_TTL_MS = 30_000
const DEFAULT_MAX_ENTRIES = 10_000

/** Load the actor's current id/email/role, or null when the row is gone. */
export async function lookupActorById(id: string): Promise<AuthUser | null> {
  const row = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true },
  })
  if (!row) return null
  const role = DB_ROLE[row.role]
  if (!role) return null
  return { id: row.id, email: row.email, role }
}

export type SessionActorRevalidatorOptions = {
  /** Injectable data source. Defaults to a single indexed `User.id` lookup. */
  lookup?: (id: string) => Promise<AuthUser | null>
  /** Cache lifetime in milliseconds; 0 disables caching. */
  ttlMs?: number
  /** Maximum cached actors; the oldest entry is evicted at capacity. */
  maxEntries?: number
  /** Injectable clock, for deterministic tests. */
  now?: () => number
}

type CacheEntry = { expiresAt: number; user: AuthUser | null }

/**
 * Build a re-validator. Returns the current actor when the session is still
 * valid (row exists and role matches), otherwise `null`.
 */
export function createSessionActorRevalidator(
  options: SessionActorRevalidatorOptions = {},
): (claimed: AuthUser) => Promise<AuthUser | null> {
  const lookup = options.lookup ?? lookupActorById
  const ttlMs = Math.max(0, options.ttlMs ?? DEFAULT_SESSION_REVALIDATION_TTL_MS)
  const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES)
  const now = options.now ?? Date.now
  const cache = new Map<string, CacheEntry>()

  const remember = (id: string, user: AuthUser | null, at: number) => {
    if (ttlMs <= 0) return
    if (cache.has(id)) cache.delete(id)
    if (cache.size >= maxEntries) {
      const oldest = cache.keys().next()
      if (!oldest.done) cache.delete(oldest.value)
    }
    cache.set(id, { expiresAt: at + ttlMs, user })
  }

  return async (claimed: AuthUser): Promise<AuthUser | null> => {
    const at = now()
    const cached = cache.get(claimed.id)
    if (cached && cached.expiresAt > at) {
      if (!cached.user) return null
      return cached.user.role === claimed.role ? cached.user : null
    }

    let current: AuthUser | null
    try {
      current = await lookup(claimed.id)
    } catch {
      // Fail closed, and never cache an infrastructure failure.
      return null
    }

    remember(claimed.id, current, at)
    if (!current) return null
    return current.role === claimed.role ? current : null
  }
}

/** Resolve the TTL override from the environment; 0 disables the cache. */
export function resolveRevalidationTtlMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.SESSION_REVALIDATION_TTL_SECONDS?.trim()
  if (!raw) return DEFAULT_SESSION_REVALIDATION_TTL_MS
  const seconds = Number.parseInt(raw, 10)
  if (!Number.isFinite(seconds) || seconds < 0) return DEFAULT_SESSION_REVALIDATION_TTL_MS
  return Math.min(seconds, 300) * 1000
}

/** Process-wide re-validator used by `lib/authz.ts`. */
export const revalidateSessionActor = createSessionActorRevalidator({
  ttlMs: resolveRevalidationTtlMs(),
})
