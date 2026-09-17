# Development workflow

How work moves from a feature branch to `main`, what "done" means, and how to run the gates
locally. Grounded in the committed repository, not in aspiration.

## Branch model

Three kinds of branch:

- **`main`** — always green, always deployable. `main` only receives merges at phase boundaries.
  It never takes feature work directly.
- **`dev`** — the integration branch. All phase work lands here first.
- **`feat/<slice>`** — short-lived branches cut from `dev` for individual workstreams. Used heavily
  in Phase 2, where each feature pod works on its own slice.

The flow:

```mermaid
flowchart LR
  featNode["feat/slice"] -->|"PR: install, prisma generate, prisma validate, typecheck, lint, format, test, build"| devNode["dev: integration"]
  devNode -->|"phase boundary: acceptance criteria met and CI green"| mainNode["main: always deployable"]
  mainNode -.->|"only phase-boundary merges"| devNode
```

A phase boundary merge is a deliberate gate, not a routine push: `dev` is verified green, the
phase's acceptance criteria are met, and only then is `dev` merged into `main`.

### Current branch state (at `12e45be`)

- Local and remote both point at the same commit: `main`, `dev`, `origin/main` and `origin/dev` are
  all `12e45be` (`Merge branch 'p4/verify-unified' into dev`). All of Phases 0–4 are on both
  branches.
- `git rev-list --count main..dev` is **0** and `git rev-list --count origin/main..dev` is **0**;
  every phase-boundary merge (including the Phase 4 cutover work) is on `main` as well as `dev`.
- Two tags exist: `legacy-archive-v1` (the pre-rebuild archive commit) and
  `archive/quiz-generation-duplicate` (the preserved, deliberately unmerged quiz-generation
  implementation; see [`archive/duplicate-quiz-generation.md`](./archive/duplicate-quiz-generation.md)).

### Branch protection

Branch protection is **enabled** on both long-lived branches (verified 2026-09-12 with `gh api
repos/arockiasachin/ai-assessment-platform/branches/<branch>/protection`); the repository is public.
`main` and `dev` both require the `Verify` status check, neither requires an approving review
(`required_approving_review_count: 0` on `main`; no review requirement on `dev`), and
`enforce_admins` is `false` on both. The no-direct-pushes-to-`main` rule therefore remains a
convention for administrators rather than an absolute GitHub block. See
[`README.md`](./README.md#branch-protection-and-ci).

## Definition of Done

A change is done only when all of the following hold:

1. Acceptance criteria met (drawn from [`product-spec.md`](./product-spec.md)).
2. Tests added.
3. Contract validated (the `zod` schemas for the changed surface).
4. No type suppressions (`@ts-ignore`, `@ts-expect-error`, `as any` used to silence the compiler).
5. Reviewed.
6. CI green.

The test, contract, and type-suppression clauses are enforceable now: the Phase 1 test harness and
the `zod` contract are landed, and CI runs the suite on every pull request and on pushes to `main`
and `dev`. The one caveat is that `react-hooks/set-state-in-effect` is still a warning rather than
an error (see [Running the gates locally](#running-the-gates-locally)).

## Parallel work: pipelining research behind validation

When a wave of work is being validated, the **research for the next wave** can run in parallel with
it. Empirical basis: the Wave 0 validation (two independent agents reproducing every claim) and the
three Wave 1 research dossiers ran concurrently with no interference and no contention.

The rule is narrow, and the boundaries matter more than the permission:

**Do pipeline: research for wave N+1 while wave N is validated.** Research needs wave N's
_artifacts_, not its _verdict_. Once wave N is committed, wave N+1 is fully researchable.

**Do not pipeline:**

- **N+2 or later.** It depends on decisions wave N+1 will surface. Researching it early produces a
  dossier that is stale before it is used — a new costume for the original "Frankenstein" failure.
- **Implementation.** Only research runs ahead. Two waves of code in flight at once is how this repo
  acquired a duplicate, unmerged `quiz-generation` implementation (see
  [`archive/duplicate-quiz-generation.md`](./archive/duplicate-quiz-generation.md)). One wave of code,
  always.
- **Across an unvalidated foundation.** An unvalidated base makes downstream research worthless.
  Validation stays on the critical path; research fills the waiting time, it does not replace it.

**Two operational rules, both learned the hard way:**

1. **Never mutate the artifact under validation.** A validator that runs `npm run build` compiles the
   working tree; editing source mid-validation silently invalidates its result. Wait for the verdict,
   then apply fixes. If a commit _message_ must change while a validator holds the sha, amend the
   message and **prove the tree hash is unchanged** (`git rev-parse HEAD^{tree}` before and after) —
   same content, new sha, prior verification still valid.
2. **Keep concurrent agents' writes disjoint.** Give parallel agents non-overlapping scopes — split
   by data source or by concern, not by page count — and have read-only researchers **return reports
   instead of writing files**, so one agent's output cannot corrupt another's `git status` check. Two
   validators should also be split by method (static review vs. live runtime), and only one should
   hold the dev server.

## CI gates

[`../.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every pull request and on
pushes to **both `main` and `dev`** (`on.push.branches: [main, dev]`). The `verify` job runs on Node
24 with `npm ci`, a cached npm store, a
`pgvector/pgvector:pg16` service, and non-secret environment values so that Prisma, the tests, and
the build work without secrets:

```yaml
DATABASE_URL: postgresql://postgres:postgres@localhost:5432/assessment_test
TEST_DATABASE_URL: postgresql://postgres:postgres@localhost:5432/assessment_test
SESSION_SECRET: ci-only-not-a-real-secret
LLM_PROVIDER: mock
```

Steps, in order:

1. Install dependencies — `npm ci`
2. Generate Prisma client — `npx prisma generate`
3. Validate Prisma schema — `npx prisma validate`
4. Typecheck — `npm run typecheck`
5. Lint — `npm run lint`
6. Check formatting — `npm run format:check`
7. Provision test database and run tests — `npm test`
8. Build — `npm run build`

`LLM_PROVIDER=mock` keeps CI offline and deterministic: the mock provider needs no API key and makes
no network calls.

`npm test`'s Vitest global setup resets the dedicated `assessment_test` database and applies the
committed migrations with `prisma migrate deploy`, so step 7 also proves that the migration history
builds the schema from an empty database. The Playwright spine test remains planned.

### Test suite

`tests/` is a single Vitest suite (`npm test` = `vitest run`). At `12e45be` it is **93 test files**
(`ls tests/*.test.ts`) spanning Phases 1–4. It mixes:

- **Pure unit tests** — the majority, no database required (e.g. `tests/llm-mock.test.ts`,
  `tests/quiz-scoring.test.ts`, `tests/analytics-item-analysis.test.ts`,
  `tests/code-eval-sandbox.test.ts`).
- **Database-backed tests** — about 35 files, identified by importing `tests/helpers/db.ts` (e.g.
  `tests/spine.test.ts`, `tests/quiz-generation-pipeline.test.ts`,
  `tests/quiz-attempts-pipeline.test.ts`, `tests/rubric-grading-pipeline.test.ts`,
  `tests/groups-peer-evaluation.test.ts`, `tests/lms-export-service.test.ts`,
  `tests/analytics-scoping.test.ts`, `tests/demo-spine.test.ts`,
  `tests/retention-purge.test.ts`). They need a pgvector Postgres.
- `tests/code-eval-docker.test.ts` and `tests/code-eval-unit-isolation.test.ts` additionally need
  the Docker daemon and the pinned `python:3.12-slim` / `node:22-slim` images; they skip themselves
  (never fail) when either is missing.

Provisioning lives in `tests/helpers/provision.ts`: it drops and recreates `public` on the guarded
test database and then applies the committed migration history with `prisma migrate deploy` — never
`migrate reset` or `migrate dev`. `tests/global-setup.ts` skips provisioning when
`TEST_DATABASE_URL` is unset, so the pure unit tests still run offline. The suite-level framing is
in [`../tests/README.md`](../tests/README.md).

## Restart the dev server after a schema or structural change

`next dev` caches the generated Prisma client and the route tree in the running process. Two
changes therefore need a restart, and both fail in ways that look like code bugs:

| Change                                | Symptom if you do not restart                                                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `prisma generate` (any schema change) | `Unknown field "<newColumn>" for select statement on model "X"` as a **500**, though `tsc` is clean and the migration applied |
| A new `layout.tsx` in a route group   | Routes under it render **without** the layout — e.g. no `id="app-main"`, no skip link — while still returning 200             |

Both have cost real debugging time in this repo. The rule: after `prisma generate`, or after
adding/removing a layout, kill and restart `npm run dev` before trusting a browser check.
`curl` against the running server is the fastest confirmation — for an app-scope page,
`grep -c 'id="app-main"'` on the response should be `1`.

## Seed a development database

There are three seed entry points, and one command a developer normally wants:

| Command                       | What it does                                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run prisma:seed:all`     | **The default.** Runs the demo seed, then the courses seed, in that fixed order. Safe to re-run whenever you want a known-good dataset.       |
| `npm run prisma:seed:demo`    | Only `prisma/seed-demo.ts`: the Phase 4 "Algebra Foundations" course that drives the whole product spine.                                     |
| `npm run prisma:seed:courses` | Only `prisma/seed-courses.ts`: the four M.Tech CSE (BDA) courses `MCSE501L/P` and `MCSE502L/P`.                                               |
| `npm run prisma:seed`         | `prisma db seed` → `prisma/seed.ts`, the legacy full-faculty fixture. It resets the **whole** database and is deliberately not part of `all`. |

Both the demo and courses seeds are **independently re-runnable and idempotent**: each deletes the
rows it owns before recreating them, so a second run replaces rather than duplicates and raises no
constraint error. They also **coexist** in one database — the demo seed's teardown is scoped to its
own ids (plus two title-scoped orphan sweeps: `Due: …` deadline events left behind by earlier runs,
and `AUDIT-…` probe events left behind by the audit harness), and the courses seed's teardown is
scoped to its `courses-` ids, so re-running either one alone leaves the other's rows untouched.
Both orphan sweeps are scoped by title deliberately rather than by "all three links are null",
because that shape is shared with the two real institution-wide holidays. `AUDIT-…` is a reserved
probe namespace: do not title a real event with it. `tests/seed-coexistence.test.ts` is the
executable proof of coexistence, and `tests/seed-probe-teardown.test.ts` pins the probe sweep and
the survival of both holidays across it.

`prisma:seed:all` fixes the order (demo, then courses) so the resulting state is deterministic.
Because both teardowns are id-scoped, either order is safe; this is simply the order the pair was
developed and documented in. Run it from a clean shell — each seed loads `.env` itself, so no
exported `DATABASE_URL` is required.

## Commit conventions

Conventional Commits, imperative mood, lowercase type. The scopes observed in this history:

- `feat(<area>):` — new capability. Examples: `feat(db)`, `feat(llm)`, `feat(vector)`.
- `fix(<area>):` — a defect fix. Examples: `fix(ci)`, `fix(build)`, `fix(vector)`.
- `chore:` — tooling and non-product changes.
- `docs:` — documentation only.

Examples from the actual history:

- `feat(db): add Phase 1 assessment spine schema and migration`
- `fix(ci): align hono lockfile entry with the npm override`
- `fix(build): force dynamic rendering for admin dashboards`

Keep commits scoped to one logical change, because several agents work in the same tree
concurrently. Stage only the paths you changed; never `git add -A` or `git add .` while other
agents have uncommitted work in the tree.

## Running the gates locally

Prerequisites: Node 24 and npm.

```bash
# One-time install
npm ci

# Prisma
npx prisma generate
npx prisma validate

# The three fast gates, in one command
npm run verify        # typecheck && lint && format:check

# Or individually
npm run typecheck     # tsc --noEmit
npm run lint          # eslint .
npm run format:check  # prettier --check .
npm run format        # prettier --write .  (writes; use carefully in a shared tree)

# Production build
npm run build
```

The lint warning count at the current tip `12e45be` is **9 warnings, 0 errors** (measured with
`npm run lint` during the 2026-09-12 documentation refresh). The count has been stable at 9 since
`b9d8242`; the Phase 1 verification recorded 13 at `22f608b`. The residual warnings are the demoted
`react-hooks/set-state-in-effect` fetch-on-mount effects plus two deliberate `window.location`
assignments. The rule stays a warning until the remaining fetch-on-mount views are server-seeded
(see the deferred P1/P2 items in [`quality/a11y-perf-audit.md`](./quality/a11y-perf-audit.md)).

`npm run typecheck`, `npm run format:check` and the build were not re-run by the 2026-09-12
documentation refresh; their most recent recorded green runs are the Phase 4 bug-fix pass
([`verification/bugfix-run-4.md`](./verification/bugfix-run-4.md): `npm run verify` exit 0 at the
`p4/verify-unified` tip, and a build against an unreachable `DATABASE_URL`). `npm run build` is not
reproduced here because it writes `.next/`; the build gate is enforced by CI.
