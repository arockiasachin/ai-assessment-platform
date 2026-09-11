# Phase 0 — Foundations

## Goal

Make the repository buildable, reviewable, and secret-free before any product work starts. The
pre-rebuild tree was archived as-is so it can be referenced later, and a green CI pipeline was put
in place so every later change is verified automatically.

## Scope

### In

- `git init` and the GitHub repository, with the existing tree committed as an archive baseline.
- Secret hygiene: `.env`, `pass`, and scratch directories ignored before product work begins.
- The CI pipeline: install, Prisma generate and validate, typecheck, lint, format check, build.
- ESLint flat config and Prettier.
- Removal of `typescript.ignoreBuildErrors` from `next.config.mjs`.
- `zod` added as the foundation for the Phase 1 API contract.
- `.env.example` documenting every environment variable.
- `docs/product-spec.md` as the scope source of truth.
- Standardizing on one package manager (npm) and one lockfile.

### Out

- Product features. Phase 0 ships no user-facing change.
- Schema redesign. The assessment spine is Phase 1.
- Auth hardening and the test harness. Both are Phase 1.
- Deleting the legacy models (attendance, streams, ratings, `ExternalReference`, `noSqlRefId`, and
  so on). Deletion is deferred to the Phase 4 cutover so the legacy tree keeps building.

## Deliverables

| Artifact                    | Path                                                              |
| --------------------------- | ----------------------------------------------------------------- |
| Ignore rules for secrets    | `.gitignore`                                                      |
| CI pipeline                 | `.github/workflows/ci.yml`                                        |
| ESLint flat config          | `eslint.config.mjs`                                               |
| Prettier config and ignores | `.prettierrc`, `.prettierignore`                                  |
| Env template                | `.env.example`                                                    |
| Product spec                | `docs/product-spec.md`                                            |
| Verification scripts        | `package.json` (`typecheck`, `lint`, `format:check`, `verify`, …) |
| Archive tag                 | `legacy-archive-v1`                                               |

## Acceptance criteria

Phase 0 is an engineering phase, so the criteria are the repository-level invariants that
[`product-spec.md`](../product-spec.md) requires:

- The repository contains no secrets. `.env` and `pass` are ignored and have never been committed.
- `next.config.mjs` no longer sets `typescript.ignoreBuildErrors`; the project typechecks.
- `npm run typecheck`, `npm run lint`, and `npm run format:check` pass.
- The production build succeeds without a live database and without an LLM API key.
- CI runs the full gate list on every pull request and on pushes to `main` and `dev`.

## Status

**Complete.** All Phase 0 commits are in the history; see Evidence.

## Key decisions and why

- **Archive the legacy tree as the first commit and tag it `legacy-archive-v1`.** The rebuild is a
  cutover, not a fork. Keeping the pre-rebuild tree reachable at a tag lets Phase 4 diff behaviour
  and confirm that nothing still depends on legacy code.
- **npm instead of pnpm.** A single committed `package-lock.json` is what CI installs with. The
  earlier tree carried both lockfiles plus a `pnpm.overrides` block that npm ignores. Standardizing
  removed a class of "works locally, fails in CI" drift.
- **ESLint flat config.** Next 16 removed `next lint`; `eslint.config.mjs` composes
  `eslint-config-next` core-web-vitals and typescript, with `eslint-config-prettier` last so
  formatting rules never fight Prettier.
- **Remove `typescript.ignoreBuildErrors` outright.** The prior tree hid type errors at build time.
  Removing the flag makes `tsc --noEmit` the real contract, which later phases depend on.
- **Keep `react-hooks/set-state-in-effect` as a warning, not an error.** The legacy client
  components fetch on mount and store the result in state. Failing the build on those would block
  all work; Phase 2 replaces them with Server Components, at which point the rule returns to
  `error`. New code must not add violations.
- **`force-dynamic` on the database-backed admin pages.** They run Prisma queries at page scope, so
  Next tried to statically prerender them and the build needed a live database. CI has none.
- **`LLM_PROVIDER=mock` in CI.** No API key, no network, deterministic output.

## Evidence

Commits, newest first, from `git log --oneline`:

| Commit    | Subject                                                                             |
| --------- | ----------------------------------------------------------------------------------- |
| `62953d8` | `fix(build): force dynamic rendering for admin dashboards`                          |
| `62df570` | `fix(ci): align hono lockfile entry with the npm override`                          |
| `d31818f` | `docs: add product spec and CI pipeline`                                            |
| `26c67ee` | `chore: add lint, format, typecheck and env scaffolding`                            |
| `82a48fc` | `chore: archive baseline of pre-rebuild Assessment-Dashboard` (`legacy-archive-v1`) |

Two defects were caught and fixed during Phase 0:

- `62df570` — the `hono` override lived in the pnpm-only block, which npm ignores, so the lockfile
  resolved `hono@4.13.0` while `package.json` required `4.12.25`. `npm ci` rejects that mismatch;
  the lock was regenerated so both agree.
- `62953d8` — the production build reached for a database. Four admin pages were marked
  `force-dynamic`; the build then succeeded against an unreachable `DATABASE_URL`.

Commands used to verify (re-run on 2026-09-11 against `22f608b`):

```bash
npm ci
npx prisma generate
npx prisma validate
npm run typecheck      # 0 errors
npm run lint           # 0 errors, 13 warnings
npm run format:check   # clean
git log --all --oneline -- .env pass   # empty: secrets never committed
git ls-files | rg -i 'pass$|\.env'     # only .env.example is tracked
```

## Risks and open questions

The items below were open at the end of Phase 0; their resolution is noted inline.

- **Branch protection is deferred.** _Resolved._ The repository is public and branch protection is
  enabled on `main` and `dev` (required `Verify` check; 0 required approvals on `main`;
  `enforce_admins: false`). See
  [`development-workflow.md`](../development-workflow.md#branch-protection).
- **Thirteen lint warnings remain.** _Mostly resolved._ The count was 13 at `22f608b` and 9 at
  `b9d8242`; the residual warnings are the demoted React effect rule in the remaining fetch-on-mount
  views plus two deliberate `window.location` assignments. The rule returns to `error` once those
  views are server-seeded. The exact count at the current tip is unverified.
- **CI does not yet run tests, a migration drift check, or Playwright.** _Partly resolved._ CI now
  runs `npm test` against a `pgvector/pgvector:pg16` service (commit `f54b2f0`); the test harness
  provisions its database by applying the committed migrations, which is the migration drift check.
  Playwright is still not present (no `playwright.config.*`). See
  [`development-workflow.md`](../development-workflow.md#ci-gates).
- **The plan lists the `MOCK` LLM provider under Phase 0.** It actually landed in Phase 1 in commit
  `f0088ef`. The CI workflow was already written to assume it.

## Dependencies on other phases

None. Phase 0 is the first phase and every later phase depends on it.
