# Feature: sandboxed code and debugging evaluation (Phase 2, pod 6)

Student code is executed against teacher-authored (or LLM-drafted) test cases in a
locked-down Docker container — never on the app host. Results are reported
PrairieLearn-style, per test, with output. A `TestRun` is **evidence** for a
teacher; it never publishes a `Grade`.

Merged to `dev` in `b9d8242` (`Merge p2/code-sandbox into dev`), landing `cfad031` plus the
follow-up `eb73b68` (`fix(phase-2): partial update, CSV injection, group roster, offline mock`); the
`p2/code-sandbox` branch was deleted after merging.

## Goal and product rules

This pod implements product-spec §4 (code and debugging evaluation) and keeps the
two rules it touches intact:

- **Nothing is graded automatically.** A `TestRun` records pass/fail evidence and
  is surfaced to the teacher. Publishing stays in the human approval flow
  (`lib/grading/review-service.ts`); nothing in this pod writes to `Grade` or
  `GradeReview`.
- **A student sees only their own work.** Runs are scoped to the signed-in
  student; the API for another student's run responds `404`.

## API surface

All teacher routes are `requireRole("teacher")` plus an object-level ownership
check (`Assessment.createdById === staffId` or `offering.teacherId === staffId`).
All student routes are `requireRole("student")` plus an active-enrollment check.

### Teacher — `app/api/teacher/code-tasks/**`

| Method + path                                                         | Purpose                                                               |
| --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `GET /api/teacher/code-tasks`                                         | Own CODE assessments with code-task / run counts                      |
| `POST /api/teacher/code-tasks`                                        | Create or replace the code task (language, limits, cap, instructions) |
| `GET /api/teacher/code-tasks/[assessmentId]`                          | One owned task and its test cases (draft/active flagged)              |
| `POST /api/teacher/code-tasks/[assessmentId]/test-cases`              | Add a hand-authored, immediately active test case                     |
| `PATCH/DELETE /api/teacher/code-tasks/[assessmentId]/test-cases/[id]` | Edit / remove a test case                                             |
| `POST /api/teacher/code-tasks/[assessmentId]/generate-tests`          | LLM-draft test cases (**drafts** until published)                     |
| `POST /api/teacher/code-tasks/[assessmentId]/publish-tests`           | Publish generated drafts                                              |
| `GET /api/teacher/code-tasks/[assessmentId]/runs`                     | Sandbox evidence, newest first; `?studentId=`                         |
| `GET/POST /api/teacher/code-tasks/[assessmentId]/similarity`          | Read / re-scan cohort similarity pairs                                |
| `PATCH /api/teacher/code-tasks/[assessmentId]/similarity/[checkId]`   | Human verdict (`FLAGGED` / `CLEARED`)                                 |

### Student — `app/api/student/code-submissions/**`

| Method + path                               | Purpose                                                                |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| `GET /api/student/code-submissions`         | Own enrolled code tasks + submission budget; `?assessmentId=` for runs |
| `POST /api/student/code-submissions`        | Submit code; runs the sandbox and returns own per-test results         |
| `GET /api/student/code-submissions/[runId]` | One own run (another student's run → `404`)                            |

Error mapping follows the shared convention: domain errors keep their status
(400/403/404/409/429/502/503), zod errors are 400, database errors are logged and
reduced to a generic 500 (bug-fix run 1, BUG-4).

## Isolation guarantees and their exact flags

Student code runs via the `docker` CLI, invoked from `node:child_process`. The
**only** code allowed to assemble the argument vector is
`buildSandboxRunArgs` in `lib/code-eval/sandbox.ts`, so every guarantee is
reviewable in one place. `SANDBOX_ISOLATION_FLAGS` documents the guarantees and
is asserted against the builder in `tests/code-eval-sandbox.test.ts`.

| Guarantee                     | Flag(s)                                                       |
| ----------------------------- | ------------------------------------------------------------- |
| No network egress (in or out) | `--network none`                                              |
| Memory ceiling, swap disabled | `--memory <n>m --memory-swap <n>m`                            |
| CPU ceiling                   | `--cpus 1`                                                    |
| Fork-bomb ceiling             | `--pids-limit 128`                                            |
| Non-root execution            | `--user 65534:65534`                                          |
| Read-only root filesystem     | `--read-only`                                                 |
| Minimal noexec scratch        | `--tmpfs /tmp:rw,noexec,nosuid,nodev,size=64M`                |
| No Linux capabilities         | `--cap-drop ALL`                                              |
| No privilege escalation       | `--security-opt no-new-privileges`                            |
| FD / core-dump ceiling        | `--ulimit nofile=128:128 --ulimit core=0`                     |
| Zombie reaping                | `--init`                                                      |
| Wall-clock kill               | executor timer: `docker kill` + `SIGKILL` on `docker run`     |
| No leaked container           | unconditional `docker rm -f <name>` in the executor `finally` |

The payload (student source + test cases) is streamed over **stdin**; nothing is
bind-mounted. Images are pinned to `python:3.12-slim` / `node:22-slim`, and the
executor refuses to run (and refuses to pull) if the image is not already
present, so a build/test run never reaches the network unexpectedly.

Memory exhaustion is detected two ways: the container's `State.OOMKilled` flag,
or the harness reporting that its child program was `SIGKILL`ed at the cgroup
boundary. Both map to a `memoryExceeded` run.

## Results contract and categories

`TestRun.resultsJson` stores `{ results, timedOut, memoryExceeded, killMessage }`,
where each entry of `results` is a contract-validated `TestResult`:

```
{ testCaseId, name, description, category, points, earnedPoints, passed,
  stdout, stderr, message, durationMs }
```

Points are recomputed from per-test results (the `TestRun` table has no points
columns). Test cases the harness never reported are emitted as failures, never as
passes.

Categories (`TestCase.category` is a free string; values are normalized):

- **`input-output`** — run the program with `input` on stdin, compare stdout to
  `expectedOutput` with trailing-whitespace normalization.
- **`unit`** — import the source as a module and call `input.function` with
  `input.args`; compare the JSON return value.
- **`structure`** — static rules from an `input` JSON object (`mustContain`,
  `mustNotContain`, `minLines`, `maxLines`, `maxLineLength`).
- **`code-quality`** — quality signals (`minComments`, `maxLineLength`,
  `mustContain`), reported as pass/fail evidence.

Run status: `TIMEOUT` on a wall-clock kill, `ERROR` on a memory kill or sandbox
infrastructure failure, `PASSED` only when every test passed, otherwise
`FAILED`. `coverage` is an execution-coverage proxy (executed tests / total
tests), explicitly not line coverage.

## Test-case generation (optional, LLM-assisted)

`POST /api/teacher/code-tasks/[id]/generate-tests` builds a versioned prompt
(`code-eval-v1`), calls the provider with `task: "code-eval"`, and validates the
response strictly (`lib/code-eval/parsing.ts`). Generated test cases are persisted
as **drafts**: their ids are recorded in `CodeTask.metadata.draftTestCaseIds`
(the schema is frozen, so the state lives in the existing JSON column — the
quiz-generation pod's pattern). Only `publish-tests` removes a draft id, and it
writes an `AuditLog` row per published test case. The `mock` provider synthesizes
deterministic, schema-valid drafts, so the whole prompt → generation → draft →
publish pipeline runs offline with `LLM_PROVIDER=mock`.

## Resubmission and limits

`CodeTask.metadata.maxSubmissions` (default 10) is the cap; `Assessment.dueDate`
is the deadline. Both are enforced **server-side, before the sandbox runs**, in
`submitCodeForStudent` → `evaluateSubmissionEligibility`. A capped submission is
`429`; a late one is `409`. The submission cap prevents brute-forcing the test
cases. A `GRADED` submission is immutable (`409`).

## Cohort similarity

`lib/code-eval/similarity.ts` is a **normalized-token shingling / Jaccard**
comparison (not a full MOSS implementation: no winnowing fingerprints, no AST/PDG
analysis). It strips comments, collapses string/numeric literals, tokenizes,
builds overlapping 5-gram shingles, and scores two submissions by Jaccard index.

`POST .../similarity` compares each student's latest submission against every
other in the offered cohort, persists a `SimilarityCheck` per pair with evidence,
and marks a pair `FLAGGED` at or above the threshold (`0.8`) — or `PENDING`
below. Pairs shorter than 20 tokens are never flagged. It **flags for human
review and never decides**: only a teacher action sets `CLEARED`, and students
have no route that returns similarity data.

## Security / authorization

- A student may only submit to, and read runs for, a CODE assessment on an
  offering they are actively enrolled in (`loadEnrolledCodeTask`).
- A student may only read their **own** runs (`getStudentRun` → `404` otherwise).
- A teacher only sees their own assessments' tasks, runs, and similarity pairs.
- No similarity endpoint is reachable by a student.

## Tests

| File                                 | Coverage (no Docker unless noted)                                                                                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/code-eval-sandbox.test.ts`    | isolation flag builder asserts every restriction; wall-clock budget; runtime selection                                                                                            |
| `tests/code-eval-results.test.ts`    | sentinel parsing, stray output, per-test aggregation, status mapping, category normalization                                                                                      |
| `tests/code-eval-limits.test.ts`     | submission cap and deadline policy, boundary and clamping cases                                                                                                                   |
| `tests/code-eval-similarity.test.ts` | comment stripping, tokenization, known-similar and known-different pairs, min-token guard                                                                                         |
| `tests/code-eval-parsing.test.ts`    | generated test-case validation, fenced/array JSON, category-appropriate inputs                                                                                                    |
| `tests/code-eval-pipeline.test.ts`   | DB-backed: evidence persistence, no grade, cap, deadline, cross-student/cross-teacher denial, deterministic drafts + publish, similarity flag + human verdict (injected executor) |
| `tests/code-eval-route-auth.test.ts` | route-level 401/403 before the service; malformed body 400                                                                                                                        |
| `tests/code-eval-docker.test.ts`     | **Docker integration** (skips without a daemon/image): passing run, network denial, timeout kill, memory kill                                                                     |

## Shared files touched

- `lib/contracts/index.ts` — one line: re-exports `./code-eval`.
- `lib/llm/types.ts` — adds `"code-eval"` to the `LlmTask` union.
- `lib/llm/providers/mock.ts` — deterministic code-eval draft synthesis (other
  tasks unchanged).
- `components/role-routes-menu.tsx` — two nav entries ("Code tasks", "Code").
- `next.config.mjs` — sets `turbopack.root` from the real `node_modules` location
  so worktree builds (where `node_modules` is a symlink) do not abort. A no-op in
  the main checkout, where the resolved root is the repo root.

`prisma/schema.prisma`, `prisma/migrations/**`, `package.json`, and
`package-lock.json` are unchanged.

## Deferred items and limits

- **Sandbox model limits.** Containers share the host kernel; isolation is
  namespaces + cgroups + seccomp (Docker defaults), not a VM or gVisor/Kata. The
  `docker` daemon is a trusted component. There is no per-student disk quota
  beyond the read-only root and 64 MB tmpfs; a student can still consume the
  capped 256 KB of captured output and the CPU/memory/PID budgets.
- **Unit-mode convention.** `unit` tests import the student's file and call a
  named function; the student must define it. Python modules are imported as
  `solution`; Node uses CommonJS `module.exports`. ESM student files are not
  supported for `unit` tests.
- **No line/statement coverage.** `coverage` is an execution proxy only.
- **Similarity is heuristic.** Shingling/Jaccard can be defeated by structural
  rewrites; it is a flag for humans, not proof.
- **No student-facing "run sample tests" preview.** Students submit and see the
  results of a full run; hidden test inputs/expected outputs are never returned.
- **The UI is functional, not polished.**
- **Image availability is assumed.** The executor will not pull; deployments must
  pre-pull `python:3.12-slim` and `node:22-slim` (or a registry mirror).
