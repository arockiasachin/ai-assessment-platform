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

**Not started.** No Phase 3 work exists in the repository. The grading-agreement report, in
particular, does not exist and no agreement number should be quoted.

## Key decisions and why

- **The sandbox is reviewed, not rewritten.** It is designed to be isolated by construction (Piston
  worker, no network, limits). A rewrite in a hardening phase would re-open the highest-risk
  component late.
- **Grading quality is measured against human labels.** Unit tests cannot prove grading quality. A
  small human-labeled fixture set and a reported agreement score mirrors the dissertation's
  evaluation-metrics requirement and replaces opinion with a number.
- **Observability reuses the explainability envelope.** Every AI result already carries provider,
  model, usage, latency, and prompt version, so instrumentation does not need a new data path.

## Evidence

None. There are no Phase 3 commits. The `docs/` tree currently contains the product spec, the
development workflow, and the phase documents; the Phase 3 deliverables above are unwritten.

## Risks and open questions

- **Security findings may force a return to Phase 2.** A serious finding in the review queue or the
  sandbox would reopen feature code, not just hardening code.
- **The agreement metric needs labeled data that does not yet exist.** Producing the fixture set is
  work in its own right and needs a teacher or domain expert to label.
- **Performance budgets are undefined.** No target for page latency or grading throughput has been
  set, so "fast enough" is currently unmeasurable.

## Dependencies on other phases

- **Depends on Phase 2.** There is nothing to harden until the spine is end to end.
- **Phase 4 depends on this phase.** The cutover should happen only after the security review and the
  agreement report are in hand.
