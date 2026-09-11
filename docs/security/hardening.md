# Phase 4 — Security hardening: closing the Phase 3 decisions

Date: 2026-09-12
Branch: `p4/security-hardening` (based on `dev` @ `85fee42`)
Scope: the three Phase 3 items that were recorded as **DECISIONS**, not defects, in
[`security-review.md`](./security-review.md): login rate limiting (S-1), session role
staleness (S-2), and in-process `unit` code execution (S-4). The CONFIRMED findings
(SEC-1, SEC-2, SEC-3) were already fixed in Phase 3 and were **not** re-audited or
re-fixed.

`prisma/schema.prisma` and `prisma/migrations/**` are unchanged and still frozen.
No dependency was added; `package.json` and `package-lock.json` are unchanged.

---

## 1. Login rate limiting / lockout (was S-1, Medium)

**What changed**

- New module `lib/login-rate-limit.ts`.
- `app/api/auth/login/route.ts` consults the throttle before the database lookup and
  records a failure for every rejected attempt.

**How it works**

- A sliding window over two independent dimensions: the **normalized identifier**
  (`email.trim().toLowerCase()`, exactly as the database lookup normalizes it) and the
  **client IP** when a forwarding header is present (`x-forwarded-for`, then
  `x-real-ip`). Keys are SHA-256 hashed, so the raw email/address is never retained.
- A request is rejected with `429` + `Retry-After` once **either** dimension has
  `maxFailures` failures inside the window. A `429` before the lookup means an
  attacker cannot learn whether the account exists.
- Failed attempts for **unknown** identifiers are recorded exactly like wrong
  passwords, and a bcrypt comparison is still spent on the unknown-account path, so
  neither the lockout response nor the response time distinguishes a real account
  from a non-existent one.
- A **successful** login clears the identifier dimension. The IP dimension is
  deliberately _not_ cleared on success: one valid credential must not reset abuse
  protection for every account tried from the same address.
- Checking does not record a failure, so hammering while locked does not extend the
  lockout; the window expires relative to the original failures.

**Configuration** (safe defaults; invalid values fall back, values are clamped)

| Env var                           | Default | Meaning                              |
| --------------------------------- | ------- | ------------------------------------ |
| `LOGIN_RATE_LIMIT_MAX_FAILURES`   | `5`     | failures per window before rejection |
| `LOGIN_RATE_LIMIT_WINDOW_SECONDS` | `900`   | sliding-window length (15 minutes)   |
| `LOGIN_RATE_LIMIT_MAX_ENTRIES`    | `10000` | max buckets retained per dimension   |

**Bounded store / eviction policy.** Each bucket holds at most `maxFailures`
timestamps (`O(maxFailures)` per key). On inserting a new bucket, expired buckets are
pruned first; if the map is still at capacity the **oldest inserted** bucket is
evicted (Map insertion order). The store therefore cannot grow without bound.

**Testability.** `SlidingWindowCounter` and `LoginAttemptThrottle` take an injected
`now` clock and (for the counter) an injected store, so every assertion is
deterministic. `configureLoginAttemptThrottle` is the test seam for the process
singleton. Coverage: `tests/login-rate-limit.test.ts` (unit + route-level with the
database mocked).

**Residual risk / explicit limits**

- **Per-process only.** The counters live in the Node.js process heap. `next start` is
  a single process, so this is a real mitigation there; a multi-instance / serverless
  deployment has one copy per instance and admits roughly `instances × maxFailures`
  attempts per window. **A multi-instance deployment needs shared state** (Redis,
  Postgres, or an edge/WAF throttle). Cluster/multi-instance is common in production,
  so this must be revisited before scaling out.
- State is lost on restart, and the window is a fixed process lifetime.
- The IP dimension trusts proxy headers. Behind a proxy that sets
  `x-forwarded-for` this is meaningful; if the app is directly exposed, a client can
  spoof the header and evade only the IP dimension — the identifier dimension still
  applies. Bind the app behind a header-rewriting proxy.
- The throttle does not (and cannot) stop a distributed botnet from trying one
  password each across many addresses; it bounds per-identifier and per-address
  guessing only.

---

## 2. Session role staleness (was S-2, Medium)

**What changed**

- New module `lib/authz-actor.ts` with `lookupActorById` and
  `createSessionActorRevalidator`.
- `lib/authz.ts` `requireRole` / `requireUser` now re-validate the actor against the
  database after the signed session and the role gate pass.

**How it works**

- The re-validator performs a single indexed lookup by primary key
  (`User.id`) selecting `{id, email, role}`. If the row is gone, or its role does not
  match the role the session claims, the re-validator returns `null` and the guard
  responds **401** (not 403 — the session itself is stale).
- Authorization returns the **current** actor (fresh email/role), not the session
  claim.
- **Fail closed:** a lookup error is treated as "not confirmed" (`401`) and is never
  cached, so a database outage denies rather than trusting a stale role.
- The check lives in `requireRole` / `requireUser`, **not** in `proxy.ts`; the proxy
  stays a cheap signature-verified redirect layer. Nothing here runs on the Edge
  path.

**Short-lived cache and the staleness trade-off**

| Env var                            | Default | Meaning                              |
| ---------------------------------- | ------- | ------------------------------------ |
| `SESSION_REVALIDATION_TTL_SECONDS` | `30`    | cache lifetime; `0` disables caching |

- The cache is keyed by user id, holds at most 10 000 entries per process, and evicts
  the oldest at capacity. Cached `null` (deleted user) results are also cached.
- **Trade-off:** a demoted or deleted user can keep acting for **at most the TTL**
  (30 s by default) after the change, because the previous row is served from cache
  until it expires. This is the price of not issuing a query on every request. 30 s is
  small relative to the 7-day session and still removes the per-request query; set the
  TTL to `0` for zero staleness at one query per request.

**Residual risk / explicit limits**

- The staleness window above: up to `SESSION_REVALIDATION_TTL_SECONDS` for a demotion
  or deletion to take effect.
- The cache is per process, so different instances may briefly disagree during the
  window.
- The frozen schema has no token-version column, so this does not invalidate sessions
  on password change or logout elsewhere; it addresses **role staleness** only, which
  is the recorded S-2 decision. A token-version column remains the clean fix for
  global session revocation and would need a migration.
- Some route-unit tests use synthetic sessions with no database row; they stub the
  re-validator (`tests/*-route-auth.test.ts`) because they exercise role gating. The
  real behavior is covered by `tests/session-role-revalidation-wiring.test.ts`,
  `tests/session-role-revalidation.test.ts` (deterministic cache/TTL), and
  `tests/session-role-revalidation-db.test.ts` (real database).

---

## 3. Sandbox residual: `unit` execution moved out-of-process (was S-4, Low)

**What changed**

- `lib/code-eval/harness.ts`: `unit` mode no longer imports the student's module into
  the harness process. The harness writes the source to `/tmp`, then spawns a **fresh
  child interpreter** (`node -e` / `python3 -c`) that imports the student code, calls
  the requested function, and reports the observed value back on a dedicated pipe
  (fd 3) as one JSON frame carrying a per-run random nonce.
- `lib/code-eval/results.ts`: the parser anchors the sentinel at its **first**
  occurrence on the line, so captured student output embedded in the JSON payload
  cannot be mistaken for the harness's own framing.

**Why this closes the demonstrated forgery class**

The Phase 3 review's forgeries all relied on the student's process writing the
container's stdout (a trailing `setTimeout`/`atexit` sentinel, a suppressed
`stdout.write` plus a raw fd write, and prototype/`JSON.stringify` pollution). The
harness is now the **only** writer of container fd 1 and the only process that builds
the `results` array, so those writes land in the child's private stdout pipe and are
recorded as untrusted test output — they can neither suppress the real result line nor
add a second sentinel. The parent fails closed on any framing violation (missing,
unreadable, duplicated, or nonce-mismatched frame).

**Isolation guarantees are unchanged.** The container is still created by
`buildSandboxRunArgs` with `--network none`, memory/swap ceilings, `--cpus`,
`--pids-limit`, `--read-only`, the noexec tmpfs, non-root user, `--cap-drop ALL`,
`no-new-privileges`, ulimits, `--init`, and unconditional `docker rm -f`. The child
inherits those limits. `tests/code-eval-sandbox.test.ts` still asserts every flag; the
per-test results contract (`{id, passed, stdout, stderr, message, signal, durationMs}`)
is unchanged. The executor's memory-kill detection is preserved: an OOM-killed child
is reported with `signal: "SIGKILL"`.

**Evidence (real Docker runs).** See the commands section below; the new
`tests/code-eval-unit-isolation.test.ts` reproduces the forgery attempts inside real
containers and asserts the container stdout contains exactly one sentinel line and no
test passes, while a correct solution passes and an incorrect one fails.

**Deliberate behavior change.** A hanging `unit` function used to hang the harness and
be stopped only by the container wall-clock kill. It now still hangs the child, which
the parent blocks on, so the container wall-clock kill remains the outer backstop —
the existing Docker test's intent is preserved.

**Residual risk / explicit limits (not claimed fixed)**

- The child reports the value its own process observed. A determined submission could
  try to lie about its **own function's return value** from inside the child — e.g. a
  `toJSON` on the returned object, or (in Python) frame introspection to read the
  nonce. The parent independently owns the pass/fail evidence and fails closed on
  framing violations, but "the function actually returned this" is not provable against
  an arbitrary in-child adversary. The structural boundary stops forgery of the
  _result set_ and the container output; it does not turn the child into a trusted
  computer.
- The sandbox model is unchanged and remains namespaces + cgroups + seccomp over a
  shared host kernel, not a VM/gVisor/Kata; the Docker daemon is trusted; there is no
  per-student disk quota beyond the read-only root and the 64 MB tmpfs.
- Container cleanup still depends on the daemon being reachable for the final
  `docker rm -f` (S-5, not in scope here; operational).

---

## Verification

Environment: macOS, Node v25.9.0, Next 16.3.0, Prisma 7.9.1, Postgres 18.4
(`assessment_security_hardening_test`, created for this pass — the developer
`assessment_dashboard` database was never touched), Docker 29.7.2 with
`python:3.12-slim` and `node:22-slim` pre-pulled, `LLM_PROVIDER=mock`.

| Command                                                                                | Result                                                             |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `npm run verify` (typecheck + lint + format:check)                                     | **exit 0** — 0 errors, 9 pre-existing warnings, Prettier clean     |
| `DATABASE_URL=…:59999/ci SESSION_SECRET=x LLM_PROVIDER=mock npm run build`             | **exit 0** — compiled; all routes emitted                          |
| `npm test` with `TEST_DATABASE_URL=…assessment_security_hardening_test`                | **exit 0** — 71 files passed, 2 skipped; **440 passed**, 5 skipped |
| `npx vitest run tests/code-eval-unit-isolation.test.ts tests/code-eval-docker.test.ts` | **exit 0** — 13 passed (real containers)                           |

**Forgery attempts in real containers.** `tests/code-eval-unit-isolation.test.ts`
reproduces the Phase 3 vectors and asserts a single sentinel line in the container
stdout and no passing result. Observed output (parsed per-test evidence):

| Case (language)                        | kind        | sentinel lines | parsed result                                    |
| -------------------------------------- | ----------- | -------------- | ------------------------------------------------ |
| normal correct (python / javascript)   | `completed` | 1              | `t1 passed=true "returned the expected value"`   |
| normal incorrect (python / javascript) | `completed` | 1              | `t1 passed=false "returned an unexpected value"` |
| a — trailing sentinel                  | `completed` | 1              | `t1 passed=false "returned an unexpected value"` |
| b — stdout suppression + raw fd write  | `completed` | 1              | `t1 passed=false "returned an unexpected value"` |
| c — prototype/`JSON.stringify`/`dumps` | `completed` | 1              | `t1 passed=false "returned an unexpected value"` |

In every forgery case the child's forged sentinel was captured as _untrusted test
output_ and never reached the container's fd 1; the harness's own evidence reported the
real (wrong) return value.

Lint warnings are the same 9 pre-existing fetch-on-mount warnings as the Phase 3
baseline; none was added or removed. No gate, rule, or test was weakened, skipped, or
disabled, and no `@ts-ignore` / `@ts-expect-error` / `any` was introduced.

**Failing-then-passing evidence.** Temporarily restoring each pre-fix file made the new
regression tests fail, and they pass again with the fix in place:

| Reverted file                 | Test run                                          | Red result           |
| ----------------------------- | ------------------------------------------------- | -------------------- |
| `app/api/auth/login/route.ts` | `tests/login-rate-limit.test.ts`                  | 4 failed / 13 passed |
| `lib/authz.ts`                | `tests/session-role-revalidation-db.test.ts`      | 2 failed / 3 passed  |
| `lib/code-eval/harness.ts`    | `tests/code-eval-unit-isolation.test.ts` (Docker) | 4 failed / 4 passed  |

The four login-route failures are exactly lockout, non-enumeration, reset-on-success,
and IP throttling; the two authz failures are the demoted and deleted user being
authorized; the four Docker failures are both container-stdout forgery vectors (a and
b) in both languages.

**Pre-existing gate failure fixed.** `docs/archive/duplicate-quiz-generation.md` (added
by the base commit `85fee42` and not part of this pass) failed `prettier --check` on
`dev`. `npm run verify` cannot pass while it is unformatted, so it was reformatted
(whitespace-only, a Markdown table). No content changed.

## Files touched

- New: `lib/login-rate-limit.ts`, `lib/authz-actor.ts`,
  `tests/login-rate-limit.test.ts`, `tests/session-role-revalidation.test.ts`,
  `tests/session-role-revalidation-wiring.test.ts`,
  `tests/session-role-revalidation-db.test.ts`, `tests/code-eval-unit-isolation.test.ts`,
  this document.
- Modified: `app/api/auth/login/route.ts`, `lib/authz.ts` (shared),
  `lib/code-eval/harness.ts`, `lib/code-eval/results.ts`, `docs/features/code-eval.md`,
  `CHANGELOG.md` (shared), and nine route-unit tests that stub the new re-validator
  (`tests/analytics-route-auth.test.ts`, `tests/authorization.test.ts`,
  `tests/code-eval-route-auth.test.ts`, `tests/groups-route-auth.test.ts`,
  `tests/lms-export-route-auth.test.ts`, `tests/observability-audit-route-auth.test.ts`,
  `tests/quiz-attempts-route-auth.test.ts`, `tests/quiz-generation-route-auth.test.ts`,
  `tests/route-error-handling.test.ts`).
- Modified for a pre-existing gate failure: `docs/archive/duplicate-quiz-generation.md`
  (Prettier table alignment only — the file failed `format:check` on the base commit).
- **Not** modified: `lib/api.ts` (listed as shared but not needed),
  `prisma/schema.prisma`, `prisma/migrations/**`, `package.json`,
  `package-lock.json`.
