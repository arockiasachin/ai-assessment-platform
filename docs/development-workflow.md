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

### Current branch state

- Local `dev` and local `main` both point at `22f608b` (`fix(vector): report configured provider for
empty queries`).
- `origin/main` is at `62953d8` (`fix(build): force dynamic rendering for admin dashboards`), four
  commits behind local `dev`.
- The reflog shows the four Phase 1 commits were authored on `main` before `dev` was checked out at
  the same commit. The Phase 1-to-`main` boundary merge has not happened on the remote yet.
- Nothing has been tagged except `legacy-archive-v1` (the pre-rebuild archive commit).

### Branch protection

Branch protection on `main` is **deferred until after Phase 1**. It also requires the repository to
be public: GitHub Free does not offer branch protection on private repositories. Until protection is
enabled, the no-direct-pushes-to-`main` rule is a convention enforced by review, not by GitHub.

## Definition of Done

A change is done only when all of the following hold:

1. Acceptance criteria met (drawn from [`product-spec.md`](./product-spec.md)).
2. Tests added.
3. Contract validated (the `zod` schemas for the changed surface).
4. No type suppressions (`@ts-ignore`, `@ts-expect-error`, `as any` used to silence the compiler).
5. Reviewed.
6. CI green.

The test, contract, and type-suppression clauses become fully enforceable once the Phase 1 test
harness and `zod` contract land; at the time of writing they are partly aspirational.

## CI gates

[`../.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every pull request and on
pushes to `main`. The `verify` job runs on Node 24 with `npm ci`, a cached npm store, and
placeholder environment values so that Prisma and the build work without secrets:

```yaml
DATABASE_URL: postgresql://postgres:postgres@localhost:5432/ci
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
7. Build — `npm run build`

`LLM_PROVIDER=mock` keeps CI offline and deterministic: the mock provider needs no API key and makes
no network calls.

**Test gating is landing concurrently.** The committed workflow above (through `22f608b`) has no test
step. A concurrent workstream has an uncommitted change to `ci.yml` that adds a
`pgvector/pgvector:pg16` service plus two steps, `npm run test:db:migrate` and `npm test`, and adds
`test`, `test:watch`, and `test:db:migrate` scripts with a `vitest` devDependency. Until that change
lands, CI does not run tests, and a Prisma migration drift check and the Playwright spine test remain
planned.

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

Verified on 2026-09-11 against commit `22f608b`:

- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 errors, 13 warnings (all `react-hooks/set-state-in-effect` in legacy
  client components; the rule is demoted to `warn` in `eslint.config.mjs` and returns to `error`
  once Phase 2 replaces the fetch-on-mount pattern with Server Components).
- `npx prettier --check .` — clean.

`npm run build` is not reproduced here: the build writes `.next/` and this repository had
concurrent writers in the tree. The build gate is enforced by CI, and commit `62953d8` records it
passing against an unreachable `DATABASE_URL`.
