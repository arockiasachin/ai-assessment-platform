# Project documentation

An LLM-assisted assessment platform in which teachers keep final grading authority, grading is
server-authoritative, and group projects receive fair per-student assessment.

This directory is the documentation index for the greenfield rebuild. The status below reflects the
Phase 1 work landed through commit `22f608b`.

## Start here

- [`product-spec.md`](./product-spec.md) — the product scope and acceptance criteria. If a feature
  is not in the spec, it is not in the product.
- [`development-workflow.md`](./development-workflow.md) — the branch model, the phase-gated merge
  flow, the Definition of Done, CI gates, commit conventions, and the local verification commands.

## Phase documents

| Phase | Document                                                             | Status      |
| ----- | -------------------------------------------------------------------- | ----------- |
| 0     | [`phases/phase-0-foundations.md`](./phases/phase-0-foundations.md)   | Complete    |
| 1     | [`phases/phase-1-contracts.md`](./phases/phase-1-contracts.md)       | In progress |
| 2     | [`phases/phase-2-feature-pods.md`](./phases/phase-2-feature-pods.md) | Not started |
| 3     | [`phases/phase-3-hardening.md`](./phases/phase-3-hardening.md)       | Not started |
| 4     | [`phases/phase-4-cutover.md`](./phases/phase-4-cutover.md)           | Not started |

## Changelog

[`../CHANGELOG.md`](../CHANGELOG.md) records what actually landed, in Keep a Changelog format.

## Status at a glance

- **Phase 0, foundations — complete.** Git repository and GitHub remote, secret hygiene, the CI
  pipeline, ESLint flat config and Prettier, removal of `typescript.ignoreBuildErrors`, `zod`,
  `.env.example`, and `docs/product-spec.md`. Two build-breaking defects were caught by CI and
  fixed (the `hono` lockfile/override mismatch and admin pages that needed `force-dynamic`).
- **Phase 1, contracts — in progress.** Landed: the additive Prisma assessment spine, the baseline
  migration with the `pgvector` extension and an HNSW cosine index, the pluggable LLM adapter with
  a deterministic mock provider, the pgvector chunk/embed/search module, and the Vitest harness
  (`tests/`, `vitest.config.mts`), which provisions its database by applying the committed
  migrations. Open: auth and session hardening and the `zod` API contract with the grade review
  state machine.
- **Phase 2, feature pods — not started.** Seven pods: quiz generation, quiz grading, rubric
  grading, code sandbox, groups and peer evaluation, analytics, LMS export.
- **Phase 3, hardening — not started.** Security review, a11y and performance, observability, docs,
  grading-agreement report.
- **Phase 4, cutover — not started.** A seeded demo course exercising the whole spine, then the
  legacy tree is retired.

Known outstanding infrastructure item: branch protection on `main` is deferred until after Phase 1
and requires the repository to be public (GitHub Free does not offer protection on private
repositories). See [`development-workflow.md`](./development-workflow.md#branch-protection).
