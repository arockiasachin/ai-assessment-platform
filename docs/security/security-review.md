# Phase 3 — Security review and hardening

Date: 2026-09-12
Branch: `p3/security-review` (worktree `.worktrees/security-review`; not pushed or merged)
Base: `b9d8242` (`Merge p2/code-sandbox into dev`)
Scope: the API surface (`app/api/**`, ~57 route handlers), the Phase 2 feature
modules (`lib/code-eval/**`, `lib/groups/**`, `lib/lms-export/**`,
`lib/analytics/**`, `lib/rubric-grading/**`, `lib/quiz-generation/**`), the
shared security foundations (`lib/session.ts`, `lib/authz.ts`, `lib/grading/**`),
and the frozen boundary (`prisma/schema.prisma`, `prisma/migrations/**`).

This pass starts from
[`bugfix-run-1.md`](../verification/bugfix-run-1.md) and
[`bugfix-run-2.md`](../verification/bugfix-run-2.md) and does not re-report
anything they fixed.

## Environment

| Item                | Value                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------- |
| OS / shell          | macOS 27 (aarch64), zsh                                                                |
| Runtime             | Node v25.9.0, Next.js 16.3.0, Prisma 7.9.1                                             |
| Postgres            | 18.4 (Homebrew), `localhost:5432`                                                      |
| Test database       | `assessment_security_test` (name contains `test`, created and owned by this pass)      |
| Docker              | 29.7.2, with `python:3.12-slim` and `node:22-slim` pre-pulled                         |
| LLM provider        | `mock` (offline; no network calls)                                                     |
| Developer database  | `assessment_dashboard` — **never** read, reset, migrated, or written by this pass      |

`prisma/schema.prisma` and `prisma/migrations/**` are unchanged.
`package.json`/`package-lock.json` are unchanged; no dependency was added.
`node_modules` is the shared symlink to the main install; no install was run.

## Commands and outcomes

| Command                                                                            | Result                                                       |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `npm test` with `TEST_DATABASE_URL=…assessment_security_test`, before fixes        | **exit 0** — 51 files, 321 passed, 5 skipped                 |
| `npm test` after fixes                                                             | **exit 0** — 54 files, **332 passed**, 5 skipped (+11 new)   |
| `npx tsc --noEmit` (after `prisma generate`)                                       | **exit 0**                                                   |
| `npm run verify` (typecheck + lint + format:check)                                 | **exit 0** — 0 errors, 9 warnings (unchanged from baseline)  |
| `DATABASE_URL=…:59999/ci SESSION_SECRET=x LLM_PROVIDER=mock npm run build`         | **exit 0** — compiled, all routes emitted                    |
| `npx vitest run tests/code-eval-docker.test.ts` (real containers)                  | **exit 0** — 5 passed (network denied, timeout kill, memory kill, per-test isolation) |
| `docker ps -a --filter name=code-eval-` after the sandbox runs                     | **0 containers** — no cleanup leak                           |

The 9 lint warnings are exactly run 1's residual list (fetch-on-mount effects and
two deliberate `window.location` assignments); no warning was added or removed, and
no gate, rule, or test was weakened, skipped, or disabled. No `@ts-ignore`,
`@ts-expect-error`, or new `any` was introduced.

## What was verified and held

### Grade integrity — the non-negotiable rule

Only human `accept`/`override` set `Grade.publishedAt`. Verified by exhaustive
search of every `Grade` write:

- The only module that writes `Grade` is `lib/grading/review-service.ts`.
  `recordAiSuggestion` refreshes an **unpublished** draft and refuses to touch a
  published row (`existingGrade?.publishedAt != null`); `submitReviewDecision`
  sets `publishedAt` only for `accept` and `override`. Every other action
  (`flag`, `reject`, `reopen`) leaves it null.
- `lib/quiz-grading.ts` computes a score and returns it; it persists no grade.
- `lib/rubric-grading/**`, `lib/groups/**`, `lib/analytics/**` and
  `lib/code-eval/**` never write `Grade` or `GradeReview`. Group analysis returns
  `suggestedIndividualGrades` only; contribution data is stamped `gradeBasis:false`.
- `lib/lms-export/final-grade.ts` excludes any modern `Grade` with
  `publishedAt === null` from the weighted final grade (and from the LTI payloads
  via `lib/lms-export/lti.ts`, which throws `LtiUnpublishedGradeError` otherwise).
- `upsertRubricForTeacher` refuses to edit a rubric once any grade is published.

### Authorization / IDOR

- Every route calls `requireRole(...)` / `requireUser()` except the four
  intentionally public auth routes (`login`, `register`, `logout`, a read-only
  `me`). `proxy.ts` is an optimistic pre-check only; the API matcher is absent, so
  handlers are the boundary.
- Object-level ownership is enforced on every teacher resource via a per-module
  `authz.ts` (`loadOwnedAssessment` / `loadOwnedOffering` / `loadOwnedCodeTask` /
  `assertTeacherOwnsGroup` / `assertTeacherOwnsMilestone` / etc.), all keyed on the
  signed session, never a body value. `getReviewDetailForTeacher` and
  `setStudentRun` deliberately answer 404 to hide existence.
- Students are always scoped to their own profile (`resolveStudentProfileId` /
  `resolveStudentProfile`); code runs are matched by `studentId`, retake/export
  require active enrollment, and the student gradebook payload carries only the
  caller's row.

## Findings

### CONFIRMED (reproduced with a failing-then-passing test)

| #     | Severity | Area      | Summary                                                                                                   | Fix                                                                                   | Test                                              |
| ----- | -------- | --------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------- |
| SEC-1 | High     | code-eval | Untrusted student code could forge its own per-test pass/fail evidence in the sandbox harness             | Captured writer/serializer/intrinsics + fail-closed parser in `harness.ts`/`results.ts` | `tests/code-eval-harness-integrity.test.ts` (9)   |
| SEC-2 | High     | code-eval | Submission cap was check-then-act; concurrent requests exceeded `maxSubmissions` and each cost a container | Atomic slot reservation under a `CodeTask` row lock in `submissions.ts`               | `tests/code-eval-submission-race.test.ts` (1)     |
| SEC-3 | Medium   | legacy    | Course enrollment capacity was check-then-act; two students could both take the last seat                 | Capacity decision under a `CourseOffering` row lock in the enroll route               | `tests/course-enroll-race.test.ts` (1)            |

#### SEC-1 — Student code can forge sandbox test results (High)

**Evidence (before the fix).** The in-container harness appended its result JSON
to the container's stdout as one `__CODE_EVAL_RESULT__…` line. Because `unit`
tests execute the student's code **in the harness process**, a student controlled
that stream. Three independent reproductions:

1. A `setTimeout` registered by the student module wrote a second, forged sentinel
   after the real one. `parseHarnessOutput` scanned from the bottom and returned
   the forged block: the real result (`passed:false`) became `passed:true`.
2. `process.stdout.write = () => true` plus a direct `fs.writeSync(1, …)` forged a
   single result line, suppressing the harness's own.
3. `Array.prototype.push` (and `Object.prototype.toJSON` / `JSON.stringify`)
   pollution flipped `passed` as the harness assembled its results, producing one
   legitimate-looking sentinel with `passed:true`.

In all three the stored `TestRun` reports `PASSED`. The product spec requires the
sandbox to report accurate per-test evidence for a human to judge.

**Root cause.** The result-emitting process was also the process running
arbitrary code, and the parser trusted the last sentinel it found. There was no
separation between "the harness's opinion" and "anything the student's process
wrote".

**Fix.**

- `lib/code-eval/results.ts`: `parseHarnessOutput` now requires **exactly one**
  sentinel line with **no non-empty output after it**. A second sentinel or any
  trailing write is treated as tampering and the parse fails closed (every test
  is reported "Not executed"), so added output can never be read as evidence.
- `lib/code-eval/harness.ts` (both languages): the sentinel is written through a
  writer reference captured before student code loads (`fs.writeSync` bound to
  fd 1 / `os.write`), so it cannot be suppressed by rebinding
  `process.stdout.write` / `sys.stdout`. Results are appended with index
  assignment and serialized with a captured `JSON.stringify` over null-prototype
  objects, so prototype pollution of `push`/`toJSON`/`JSON.stringify` cannot
  change them; `json.dumps` is captured and restored on the Python side. After
  each student call the harness restores the intrinsics its comparison and
  serialization rely on (`String.prototype.replace/split/trim/slice/startsWith`,
  `Array.prototype.map/join/push`, `Number.isInteger/isFinite/isNaN`,
  `RegExp.prototype[Symbol.replace]`, the `toJSON`s and `JSON.stringify`), so a
  poisoned prototype cannot force a passing comparison.

**Regression test.** `tests/code-eval-harness-integrity.test.ts` runs the real
harness (Node and Python) and proves: a trailing forged sentinel, a suppressed
`stdout.write`, `push` pollution, `toJSON`/`JSON.stringify` poisoning, poisoned
comparison methods, Python `atexit` writes, and a patched `json.dumps` all fail to
produce a passing result, while a legitimate submission still passes and the real
Docker integration suite stays green.

**Residual (documented, not claimed fixed).** In-process execution of untrusted
code is a defense-in-depth arms race: a determined submission could still patch
intrinsics the harness does not restore. The structural fix is to run `unit`
execution out-of-process (the parent owning fd 1) and treat the container
wall-clock kill as the outer backstop; that changes a documented sandbox
behaviour and the Docker test's intent, so it is called out for a human decision
rather than done in this pass.

#### SEC-2 — Submission cap could be bypassed under concurrency (High)

**Evidence (before the fix).** With `maxSubmissions = 1`, two concurrent
`submitCodeForStudent` calls both counted zero runs, both passed the eligibility
check, and both invoked the injected executor: two sandbox runs for one allowed
submission. Reproduced 3/3.

**Root cause.** `submitCodeForStudent` counted `TestRun` rows and then created a
new one as separate statements with no lock, so the cap (and the cost of each
container) was only enforced for non-concurrent traffic.

**Fix.** The eligibility re-check, the `Submission` upsert and the `TestRun`
creation run in one transaction that first takes a `SELECT … FOR UPDATE` lock on
the owning `CodeTask` row. The loser now sees the winner's committed run and is
rejected with 429 before any container starts; the executor still runs outside
the transaction so the row lock is never held during a sandbox run.

**Regression test.** `tests/code-eval-submission-race.test.ts`: two concurrent
submissions with `maxSubmissions = 1` invoke the executor at most once, one
resolves, the other rejects 429, and exactly one `TestRun` exists.

#### SEC-3 — Enrollment capacity could be exceeded under concurrency (Medium)

**Evidence (before the fix).** With `studentLimit = 1`, two students enrolling
concurrently both read `activeCount = 0`, both inserted an active enrollment, and
the offering ended with two active students. Reproduced 3/3. (Carried as an
unconfirmed suspicion from runs 1 and 2 — now confirmed.)

**Root cause.** `POST /api/student/courses/enroll` read the offering (with its
enrollments), decided capacity, then wrote, as separate statements.

**Fix.** The whole decision (existence, existing enrollment, registration window,
capacity, and the resulting active/waitlisted write) runs in one transaction that
first takes a `SELECT … FOR UPDATE` lock on the `CourseOffering` row. Concurrent
enrollments serialize, so the second sees the first's committed row.

**Regression test.** `tests/course-enroll-race.test.ts`: two concurrent
enrollments on a 1-seat offering through the real route handler leave exactly one
active and one waitlisted enrollment.

### SUSPECTED (code-visible, not reproduced end-to-end; deliberately not changed)

| #   | Severity | Area      | Suspicion                                                                                                                                                                                    | Why it is only suspected / why it was not fixed                                                                                                       |
| --- | -------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-1 | Medium   | auth      | `POST /api/auth/login` has no rate limiting or lockout. An attacker can make unlimited bcrypt attempts against a known email.                                                                | Needs shared state (Redis/DB) or edge middleware to be meaningful; adding an in-process throttle would be a false guarantee and touches shared tooling. |
| S-2 | Medium   | session   | A signed session carries the role for up to 7 days and is not re-validated against the DB, so a demoted or deleted user keeps their old role until expiry (`/api/auth/seed` re-checks; other admin routes do not). | Session invalidation needs a token-version column or per-request lookup — a schema/product decision. `proxy.ts`/`requireRole` are otherwise correct.    |
| S-3 | Low      | lms-export | An unpublished modern `Grade` deliberately pre-empts the legacy `AssessmentGrade` fallback, so an AI draft can exclude a human-entered legacy mark from the final-grade export.               | Documented product precedence in `final-grade.ts`; resolving it is a product decision, not a code defect.                                             |
| S-4 | Low      | code-eval | In-process `unit` execution can still be tampered with through intrinsics the harness does not restore (e.g. descriptor-level tricks).                                                        | See SEC-1 residual. Fully closing it requires moving execution out-of-process, which changes a documented behaviour and its Docker test.              |
| S-5 | Low      | code-eval | Container cleanup depends on the Docker daemon being reachable for the final `docker rm -f`; if the daemon dies mid-request, a container can leak.                                             | Not reproducible locally (0 leaked after the suite); an orphan reaper needs operational tooling.                                                       |

## Could not verify

- **Browser/UI behaviour.** No browser automation; all changes are server-side and
  covered by route/service tests plus type-check, lint, and build.
- **Login brute-force resistance (S-1)** was reasoned about, not load-tested.
- **Session invalidation latency (S-2)** was reasoned about, not driven with a
  demoted user over a live server.
- **GitHub Actions CI.** Not run (nothing was pushed).
- **Environments other than Postgres 18.4 Homebrew and Docker 29.7.2.** Only the
  local instance was available.
- **The in-container harness beyond `python:3.12-slim` / `node:22-slim`.** Other
  images are not pinned by `sandbox.ts`, so no other runtime was exercised.
- **A full adversarial audit of every intrinsic patch** against the in-process
  harness (SEC-1 residual). The demonstrated vectors are closed; completeness is
  not proven.

## Schema / dependency changes

None. The frozen `prisma/schema.prisma` and `prisma/migrations/**` are untouched,
and no dependency was added or upgraded. The two race fixes use `SELECT … FOR
UPDATE` row locks, which need no schema change. No schema gap blocked a fix.

## Prioritized residual risk

1. **Login rate limiting (S-1)** — highest practical exposure: unbounded online
   password guessing against a bcrypt hash. Recommend a shared-store or
   edge-level throttle before release.
2. **Session role staleness (S-2)** — a compromised/demoted account keeps its role
   for up to seven days. Recommend a token version bumped on role change.
3. **In-process harness tampering (S-4)** — the demonstrated forgeries are closed;
   a determined submission still warrants moving `unit` execution out-of-process.
4. **Legacy/modern grade precedence (S-3)** — decide whether an AI draft should
   block a human legacy mark in the export.
5. **Container orphan cleanup (S-5)** — operational, not exploitable by a student.

## Branch status

`p3/security-review` is green:

- `npm test` with `TEST_DATABASE_URL` → **332 passed, 5 skipped**.
- `npm run verify` → exit 0 (0 errors, 9 pre-existing warnings).
- `npx tsc --noEmit` → exit 0.
- no-DB build → exit 0.
- Real Docker sandbox suite → 5 passed; no leaked containers.

No gate, lint rule, or test was weakened, skipped, or disabled; no `@ts-ignore`,
`@ts-expect-error`, or new `any` was introduced. Shared files touched are limited
to one `[Unreleased]` bullet in `CHANGELOG.md`; no other shared file changed.
