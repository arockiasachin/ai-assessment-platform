# Phase 3 — Hardening

## Goal

Make the built spine trustworthy: secure, accessible, fast enough, observable, documented, and with
a measured grading-agreement number rather than a claim that the AI grades well.

## Scope

### In

- Security review of the whole application surface, including auth, authorization, and the sandbox.
- Accessibility and performance audit and the resulting fixes.
- Observability: structured logging, error tracking, and metrics for the grading and retrieval
  pipelines.
- Documentation completion.
- A human-labeled grading-agreement report: the accuracy of AI suggestions against teacher-approved
  grades, reported as an agreement metric.

### Out

- New product features. Hardening does not add scope.
- The cutover itself. Retiring the legacy tree is Phase 4.
- Rebuilding the sandbox. It was hardened by design in Phase 2; Phase 3 reviews it.

## Deliverables

- A written security review with findings and their resolution status.
- An a11y and performance audit with fixes applied.
- Observability instrumentation wired into the grading, embedding, and code-execution paths, using
  the explainability envelope (`provider`, `model`, `usage`, `latencyMs`, `promptVersion`) that
  Phase 1 already carries.
- Completed developer and operator documentation.
- A grading-agreement report over a human-labeled fixture set.

## Acceptance criteria

- **Security:** no unauthenticated or unauthorized path reaches graded data; object-level
  authorization verified on every route; the sandbox cannot reach the network or the app host; no
  secrets in the repository or client bundles.
- **Accessibility and performance:** audited against the agreed standard with findings either fixed
  or explicitly waived with a reason.
- **Observability:** grading and retrieval runs are traceable end to end, and failures are visible.
- **Grading agreement:** an agreement metric is reported over a human-labeled fixture set. The value
  is a finding, not a target; the point is that it is measured and reproducible.
- **Definition of Done** from [`development-workflow.md`](../development-workflow.md#definition-of-done)
  holds for every change.

## Status

**Complete (three hardening pods).** All three hardening workstreams are implemented and merged to
`dev`:

| Pod                           | Landing commit | Merge     | Report                                                             |
| ----------------------------- | -------------- | --------- | ------------------------------------------------------------------ |
| Security review and hardening | `7360b16`      | `ddbb30f` | [`../security/security-review.md`](../security/security-review.md) |
| Accessibility and performance | `ebeaa1a`      | `0e04764` | [`../quality/a11y-perf-audit.md`](../quality/a11y-perf-audit.md)   |
| Observability                 | `af4ce83`      | `ac2c911` | [`../observability.md`](../observability.md)                       |

Two Phase 3 deliverables are **not** shipped:

- The human-labeled grading-agreement report (deliverable 5) does not exist and no agreement number
  should be quoted.
- Documentation completion is only partly met: these phase documents and the three reports are
  current, but the grading-agreement report is missing.

The security review additionally left four items deliberately unfixed (S-1, S-2, S-4, S-5); see
[Known gaps and open decisions](../README.md#known-gaps-and-open-decisions).

## Key decisions and why

- **The sandbox is reviewed, not rewritten.** It is isolated by construction (Docker containers with
  no network and resource limits; the plan's Piston worker was not used). A rewrite in a hardening
  phase would re-open the highest-risk component late.
- **Grading quality is measured against human labels.** Unit tests cannot prove grading quality. A
  small human-labeled fixture set and a reported agreement score mirrors the dissertation's
  evaluation-metrics requirement and replaces opinion with a number.
- **Observability reuses the explainability envelope.** Every AI result already carries provider,
  model, usage, latency, and prompt version, so instrumentation does not need a new data path.

## Evidence

`git log --oneline dev` contains the three landing commits and their merges listed under Status. The
three reports are committed under `docs/`:

- [`../security/security-review.md`](../security/security-review.md) — the security review
  (`7360b16`, merge `ddbb30f`; the report was reformatted in `cd9badc`). It records the three
  CONFIRMED fixes (SEC-1 harness integrity, SEC-2 submission-cap race, SEC-3 enrollment-cap race)
  and the five SUSPECTED/decision items.
- [`../quality/a11y-perf-audit.md`](../quality/a11y-perf-audit.md) — the accessibility and
  performance audit (`ebeaa1a`, merge `0e04764`).
- [`../observability.md`](../observability.md) — the observability policy and instrumentation
  (`af4ce83`, merge `ac2c911`).

There is no grading-agreement report.

## Risks and open questions

- **Security findings may force a return to Phase 2.** _Materialized._ The review's three CONFIRMED
  findings touched Phase 2 code (`lib/code-eval/**` and the enroll route), not just hardening code,
  and were fixed in `7360b16`. Four items remain as SUSPECTED or product decisions (S-1, S-2, S-4,
  S-5).
- **The agreement metric needs labeled data that does not yet exist.** _Still open._ Producing the
  fixture set is work in its own right and needs a teacher or domain expert to label. No report was
  produced.
- **Performance budgets are undefined.** No target for page latency or grading throughput has been
  set, so "fast enough" remains unmeasurable. The a11y/perf audit's performance findings are
  structural (where data is fetched), not measured milliseconds.

## Dependencies on other phases

- **Depended on Phase 2.** The spine is end to end, and the review, audit, and observability work
  all landed against it.
- **Phase 4 depends on this phase.** The security review and the a11y/perf audit are in hand; the
  grading-agreement report is not, so the cutover gate is only partly satisfied.
