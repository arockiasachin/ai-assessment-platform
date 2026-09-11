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
  featNode["feat/slice"] -->|"PR: install, prisma generate, prisma validate, typecheck, lint, format, build"| devNode["dev: integration"]
  devNode -->|"phase boundary: acceptance criteria met and CI green"| mainNode["main: always deployable"]
  mainNode -.->|"only phase-boundary merges"| devNode
```

A phase boundary merge is a deliberate gate, not a routine push: `dev` is verified green, the
phase's acceptance criteria are met, and only then is `dev` merged into `main`.

### Current branch state (at `8f00a5f`)

- Local `dev` and `origin/dev` both point at `8f00a5f` (`fix(instrumentation): stop bundling
Node-only code into the Edge runtime`). All of Phases 0–3 are on `dev`.
- Local `main` is at `22f608b` (`fix(vector): report configured provider for empty queries`), the
  Phase 1 boundary. It has not received the Phase 2 or Phase 3 boundary merges.
- `origin/main` is at `62953d8` (`fix(build): force dynamic rendering for admin dashboards`), the
  Phase 0 boundary — four commits behind local `main` (the four Phase 1 commits) and 40 behind
  `dev`. `dev` is 36 commits ahead of local `main` (`git rev-list --count main..dev`) and 40 ahead
  of `origin/main` (`git rev-list --count origin/main..dev`).
- Nothing has been tagged except `legacy-archive-v1` (the pre-rebuild archive commit).

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

`tests/` is a single Vitest suite (`npm test` = `vitest run`). At `8f00a5f` it is **65 test files**
(`ls tests/*.test.ts`) spanning Phases 1–3. It mixes:

- **Pure unit tests** — the majority, no database required (e.g. `tests/llm-mock.test.ts`,
  `tests/quiz-scoring.test.ts`, `tests/analytics-item-analysis.test.ts`,
  `tests/code-eval-sandbox.test.ts`).
- **Database-backed tests** — about 18 files, identified by importing `tests/helpers/db.ts` (e.g.
  `tests/spine.test.ts`, `tests/quiz-generation-pipeline.test.ts`,
  `tests/quiz-attempts-pipeline.test.ts`, `tests/rubric-grading-pipeline.test.ts`,
  `tests/groups-peer-evaluation.test.ts`, `tests/lms-export-service.test.ts`,
  `tests/analytics-scoping.test.ts`). They need a pgvector Postgres.
- `tests/code-eval-docker.test.ts` additionally needs the Docker daemon and the pinned
  `python:3.12-slim` / `node:22-slim` images; it skips itself (never fails) when either is missing.

Provisioning lives in `tests/helpers/provision.ts`: it drops and recreates `public` on the guarded
test database and then applies the committed migration history with `prisma migrate deploy` — never
`migrate reset` or `migrate dev`. `tests/global-setup.ts` skips provisioning when
`TEST_DATABASE_URL` is unset, so the pure unit tests still run offline.

Note: `tests/README.md` still describes a one-or-two-file suite; it predates the Phase 2/3 test
growth and is outside this documentation pass's `docs/**` scope.

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

Verified on 2026-09-11 against commit `22f608b`, and re-run during the Phase 3 security review
against `b9d8242` (both exit 0):

- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 errors; 9 warnings at `b9d8242` (the Phase 1 verification recorded 13 at
  `22f608b`). The residual warnings are the demoted `react-hooks/set-state-in-effect` fetch-on-mount
  effects plus two deliberate `window.location` assignments. The rule stays a warning until the
  remaining fetch-on-mount views are server-seeded (see the deferred P1/P2 items in
  [`quality/a11y-perf-audit.md`](./quality/a11y-perf-audit.md)).
- `npx prettier --check .` — clean.

The exact lint warning count at the current tip `8f00a5f` is **unverified**: this documentation pass
did not re-run the gates. The most recent recorded run is the Phase 3 security review
([`security/security-review.md`](./security/security-review.md): 9 warnings at `b9d8242`).

`npm run build` is not reproduced here: the build writes `.next/` and this repository had
concurrent writers in the tree. The build gate is enforced by CI, and commit `62953d8` records it
passing against an unreachable `DATABASE_URL`.
