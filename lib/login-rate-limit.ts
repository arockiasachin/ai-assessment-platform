import { createHash } from "node:crypto"

/**
 * In-memory login throttling for `POST /api/auth/login`.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before this module, a login request performed an unbounded bcrypt comparison
 * against a known email: an attacker could guess passwords as fast as the
 * process could hash them. This module adds a bounded sliding-window throttle
 * over two independent dimensions:
 *
 *  - the **normalized identifier** (email, lowercased + trimmed), so a single
 *    account cannot be guessed repeatedly even from many addresses; and
 *  - the **client IP** (when the request carries a forwarding header), so one
 *    address cannot guess across many accounts.
 *
 * A request is rejected once either dimension has recorded `maxFailures`
 * failures inside the window.
 *
 * NO ACCOUNT-EXISTENCE LEAK
 * -------------------------
 * The throttle is consulted *before* the database lookup and records failures
 * for unknown identifiers exactly like wrong passwords. Locked responses are
 * therefore indistinguishable whether or not the account exists, and the
 * generic invalid-credentials message is unchanged.
 *
 * PER-PROCESS ONLY (DOCUMENTED LIMIT)
 * -----------------------------------
 * This store lives in the Node.js process' heap. `next start` (and each
 * serverless/Container instance) has its own copy, so N instances admit roughly
 * N x `maxFailures` attempts per window. It is a real mitigation for the
 * single-process deployment this app targets, NOT a distributed guarantee. A
 * multi-instance deployment must move the counters to shared state (Redis,
 * Postgres, or an edge/WAF throttle). See `docs/security/hardening.md`.
 *
 * BOUNDED STORE
 * -------------
 * At most `maxEntries` buckets are retained per dimension. On insert, expired
 * buckets are pruned first; if the map is still at capacity the oldest inserted
 * bucket is evicted (insertion order). A bucket keeps at most `maxFailures`
 * timestamps, so per-key memory is O(maxFailures). The map can therefore never
 * grow without bound.
 */

/** Environment-driven limits. Every value is clamped to a safe positive range. */
export type LoginRateLimitConfig = {
  /** Failures allowed inside the window before the key is rejected. */
  maxFailures: number
  /** Sliding-window length in milliseconds. */
  windowMs: number
  /** Maximum buckets retained per dimension. */
  maxEntries: number
}

const DEFAULTS = {
  maxFailures: 5,
  windowSeconds: 15 * 60,
  maxEntries: 10_000,
} as const

function positiveInt(value: string | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback
  const parsed = Number.parseInt(value.trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, max)
}

/** Read the throttle configuration from the environment with safe defaults. */
export function resolveLoginRateLimitConfig(
  env: Record<string, string | undefined> = process.env,
): LoginRateLimitConfig {
  return {
    maxFailures: positiveInt(env.LOGIN_RATE_LIMIT_MAX_FAILURES, DEFAULTS.maxFailures, 10_000),
    windowMs:
      positiveInt(env.LOGIN_RATE_LIMIT_WINDOW_SECONDS, DEFAULTS.windowSeconds, 24 * 60 * 60) * 1000,
    maxEntries: positiveInt(env.LOGIN_RATE_LIMIT_MAX_ENTRIES, DEFAULTS.maxEntries, 1_000_000),
  }
}

export type SlidingWindowOptions = {
  maxFailures: number
  windowMs: number
  maxEntries: number
  /** Injectable clock (ms since epoch). Defaults to `Date.now`. */
  now?: () => number
  /** Injectable bucket store, so tests can inspect/seed it. */
  store?: Map<string, number[]>
}

/**
 * A generic, bounded sliding-window failure counter.
 *
 * `recordFailure` appends the current timestamp and drops anything older than
 * the window. `isBlocked` reports whether `maxFailures` failures are currently
 * inside the window. No background timer is used: expiry is computed lazily on
 * each access, so an idle process holds no scheduled work.
 */
export class SlidingWindowCounter {
  private readonly buckets: Map<string, number[]>
  private readonly now: () => number
  readonly maxFailures: number
  readonly windowMs: number
  readonly maxEntries: number

  constructor(options: SlidingWindowOptions) {
    this.maxFailures = Math.max(1, options.maxFailures)
    this.windowMs = Math.max(1, options.windowMs)
    this.maxEntries = Math.max(1, options.maxEntries)
    this.now = options.now ?? Date.now
    this.buckets = options.store ?? new Map<string, number[]>()
  }

  /** Number of retained buckets (test/observability aid). */
  get size(): number {
    return this.buckets.size
  }

  private prune(key: string, at: number): number[] {
    const existing = this.buckets.get(key)
    if (!existing) return []
    const cutoff = at - this.windowMs
    let first = 0
    while (first < existing.length && existing[first]! <= cutoff) first += 1
    const pruned = first === 0 ? existing : existing.slice(first)
    if (pruned.length === 0) this.buckets.delete(key)
    else if (pruned !== existing) this.buckets.set(key, pruned)
    return pruned
  }

  /** True when `key` already has `maxFailures` failures inside the window. */
  isBlocked(key: string): boolean {
    return this.prune(key, this.now()).length >= this.maxFailures
  }

  /**
   * Milliseconds until the oldest in-window failure for `key` expires, or 0 when
   * the key is not blocked. Used for the `Retry-After` header.
   */
  retryAfterMs(key: string): number {
    const at = this.now()
    const failures = this.prune(key, at)
    if (failures.length < this.maxFailures) return 0
    const oldest = failures[failures.length - this.maxFailures]!
    return Math.max(0, oldest + this.windowMs - at)
  }

  /** Record one failure. Keeps at most `maxFailures` timestamps per key. */
  recordFailure(key: string): void {
    const at = this.now()
    const failures = this.prune(key, at)
    failures.push(at)
    // Only the most recent failures can ever matter, so cap the bucket.
    if (failures.length > this.maxFailures) failures.splice(0, failures.length - this.maxFailures)
    if (!this.buckets.has(key)) this.makeRoom()
    this.buckets.set(key, failures)
  }

  /** Clear a key's history (called after a successful login). */
  reset(key: string): void {
    this.buckets.delete(key)
  }

  /** Evict expired then oldest buckets when at capacity, so the map stays bounded. */
  private makeRoom(): void {
    if (this.buckets.size < this.maxEntries) return
    const at = this.now()
    const cutoff = at - this.windowMs
    for (const [key, failures] of this.buckets) {
      if (failures.length === 0 || failures[failures.length - 1]! <= cutoff)
        this.buckets.delete(key)
    }
    while (this.buckets.size >= this.maxEntries) {
      const oldest = this.buckets.keys().next()
      if (oldest.done) break
      this.buckets.delete(oldest.value)
    }
  }
}

/** Stable, privacy-preserving key: the raw identifier is never retained. */
function keyFor(prefix: "id" | "ip", value: string): string {
  return `${prefix}:${createHash("sha256").update(value).digest("hex").slice(0, 32)}`
}

export type LoginThrottleDecision =
  { limited: false } | { limited: true; retryAfterSeconds: number }

/**
 * Login-specific facade over two {@link SlidingWindowCounter}s (identifier and
 * IP). A successful login clears the identifier dimension; the IP dimension is
 * deliberately left intact, because knowing one valid credential must not reset
 * abuse protection for every account tried from the same address.
 */
export class LoginAttemptThrottle {
  constructor(
    private readonly identifiers: SlidingWindowCounter,
    private readonly addresses: SlidingWindowCounter,
  ) {}

  static create(config: LoginRateLimitConfig, now: () => number = Date.now): LoginAttemptThrottle {
    const shared = { ...config, now }
    return new LoginAttemptThrottle(
      new SlidingWindowCounter(shared),
      new SlidingWindowCounter(shared),
    )
  }

  /** Consult before any database work. Rejecting here never reveals account state. */
  check(identifier: string, clientIp: string | null): LoginThrottleDecision {
    let retryMs = 0
    for (const { counter, key } of this.keys(identifier, clientIp)) {
      retryMs = Math.max(retryMs, counter.retryAfterMs(key))
    }
    if (retryMs <= 0) return { limited: false }
    return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)) }
  }

  /** Record one failed attempt against both dimensions. */
  recordFailure(identifier: string, clientIp: string | null): void {
    for (const { counter, key } of this.keys(identifier, clientIp)) counter.recordFailure(key)
  }

  /** A successful login clears the identifier dimension only. */
  recordSuccess(identifier: string): void {
    this.identifiers.reset(keyFor("id", identifier))
  }

  private keys(
    identifier: string,
    clientIp: string | null,
  ): { counter: SlidingWindowCounter; key: string }[] {
    const keys = [{ counter: this.identifiers, key: keyFor("id", identifier) }]
    if (clientIp) keys.push({ counter: this.addresses, key: keyFor("ip", clientIp) })
    return keys
  }
}

let singleton: LoginAttemptThrottle | null = null

/** Process-wide throttle, created lazily from the environment. */
export function getLoginAttemptThrottle(): LoginAttemptThrottle {
  if (!singleton) singleton = LoginAttemptThrottle.create(resolveLoginRateLimitConfig())
  return singleton
}

/**
 * Test seam: replace (or clear) the process-wide throttle. Production code never
 * calls this; tests use it to inject a deterministic clock and small limits.
 */
export function configureLoginAttemptThrottle(throttle: LoginAttemptThrottle | null): void {
  singleton = throttle
}

/**
 * Normalize the request identifier exactly as the login route does, so the
 * throttle key matches the database lookup key.
 */
export function normalizeLoginIdentifier(raw: string): string {
  return raw.trim().toLowerCase()
}

/**
 * Best-effort client address. Only proxy headers are consulted: Next.js has no
 * stable `request.ip`, and a direct socket address is not exposed to route
 * handlers. Returns `null` when no forwarding header is present, in which case
 * the identifier dimension still applies.
 */
export function clientIpFromHeaders(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim()
    if (first) return first
  }
  const realIp = headers.get("x-real-ip")?.trim()
  if (realIp) return realIp
  return null
}
