# Phase 2 — Feature pods

## Goal

Build the seven feature workstreams that turn the Phase 1 contracts into the end-to-end spine: from
teacher authoring, through AI generation and evaluation, to teacher review, then analytics and LMS
export. Phase 2 is not complete until that whole path works for one real course.

## Scope

### In

Seven pods, each a build-and-test pair:

1. **Quiz generation** — LLM generation from course material with distractors and difficulty
   calibration.
2. **Quiz grading** — server-authoritative scoring with partial credit for short-answer rationales.
3. **Rubric grading** — descriptive grading against weighted rubrics with evidence, confidence, a
   teacher review queue, and override calibration.
4. **Code sandbox** — sandboxed code and debugging evaluation on a Piston worker, with test cases,
   coverage, and similarity checks.
5. **Groups and peer evaluation** — group formation, CATME-style peer evaluation with adjustment
   factors, contribution tracking, and milestones.
6. **Analytics** — item analysis, intervention alerts, adaptive retake, and teacher dashboards.
7. **LMS export** — OneRoster-shaped CSV first, then LTI 1.3 Assignment and Grade Services.

### Out

- Hardening work (security review, a11y and performance, observability). That is Phase 3.
- Retiring the legacy tree and the seeded demo course. That is Phase 4.
- Anything not in [`product-spec.md`](../product-spec.md). The spec is the scope contract.

## Deliverables

- Working behaviour for all seven pods, each behind the `zod` API contract established in Phase 1.
- Server Components replacing the legacy fetch-on-mount client components, so the demoted
  `react-hooks/set-state-in-effect` rule returns to `error` in `eslint.config.mjs`.
- The Piston sandbox worker, isolated, with no network access and resource and time limits, never
  publicly exposed.
- Contract tests per pod; a pod merges only after its contract tests pass.

## Acceptance criteria

The criteria are the per-feature acceptance criteria in
[`product-spec.md`](../product-spec.md#in-scope-for-the-first-release). Summarized:

- **Quiz generation** — N requested questions returned with 4-5 options, exactly one correct answer,
  a subtopic tag, and a difficulty value; distractors target plausible misconceptions; generation
  produces drafts until the teacher publishes.
- **Quiz grading** — multiple-choice scoring exact and server-side; partial credit only with an
  explicitly configured threshold and reference explanation; per-question correctness, the student's
  answer, the correct answer, and an explanation returned; teacher dashboard updates per-question
  metrics.
- **Rubric grading** — per-criterion scores (never one opaque number), each citing student text;
  low-confidence and statistical outliers flagged for review; nothing published before teacher
  sign-off; overrides stored with reason and used to influence later batches; a second-marker
  sampling workflow.
- **Code evaluation** — isolated execution with no network and enforced CPU, memory, and time limits;
  per-test pass/fail with output, not a bare score; test categories covering unit, input/output, code
  quality, and structure; resubmission until the deadline with limits to prevent test brute-forcing;
  cohort similarity flags for human review.
- **Collaboration** — instructor-controlled, visible formation weights; confidential peer evaluation
  across five behaviourally-anchored dimensions; adjustment factors computed with and without
  self-ratings; free-riders and struggling teams surfaced to the instructor; contribution metrics
  presented as evidence, never as the sole basis for a grade.
- **Analytics** — per-question difficulty and discrimination indices from real attempts; alerts on
  configurable thresholds visible to the owning teacher; adaptive retake targeting a student's failed
  questions.
- **LMS export** — configurable, sum-checked category weights; OneRoster 1.2 gradebook-shaped CSV
  (line items, results, score scales); LTI AGS creates line items and posts scores only after teacher
  approval.

## Status

**Not started.** No Phase 2 code, branches, or commits exist. Everything above is planned, not
built.

## Key decisions and why

- **Each pod works in its own git worktree.** Parallel agents in one tree stomp each other. Isolating
  each pod in a worktree (the `best-of-n-runner` pattern) is what makes fan-out safe.
- **Frozen interfaces before fan-out.** The pods build against the Phase 1 schema, LLM interface, and
  `zod` contract. Reopening those mid-pod is what the phase gate is meant to prevent.
- **A hard cap of about six concurrent writers.** Thirty simultaneous agents on one small Next.js app
  produces merge conflicts and half-products.
- **A pod merges only after its contract tests pass.** Contract tests, not unit counts, are the merge
  gate.
- **The code sandbox pod lands last.** Untrusted code execution is the highest-risk component; it
  gets the most review time.

## Evidence

None. There are no Phase 2 commits, branches, or tags in the history. The branch list is `dev`,
`main`, and `origin/main` only.

## Risks and open questions

- **The code sandbox is the highest risk.** Mitigations are a dedicated Piston worker, no network,
  resource and time limits, and never exposing it publicly. It is also the pod most likely to slip.
- **Grading quality cannot be proven by unit tests.** The plan calls for a small human-labeled
  fixture set and a reported agreement score. That is a Phase 3 deliverable but must be designed for
  now.
- **Scope creep.** Twenty pages of schema ideas will tempt additions. The cut list in the spec is the
  contract; anything not on it needs an explicit decision.
- **Phase 1 gaps are a blocking dependency**, not a parallel risk. The contract and harness must land
  first.

## Dependencies on other phases

- **Depends on Phase 1** for the schema spine, the LLM adapter, the `zod` API contract, the grade
  review state machine, signed sessions, and the test harness.
- **Phase 3 depends on this phase**: the spine must exist end to end before it can be reviewed,
  measured, and hardened.
