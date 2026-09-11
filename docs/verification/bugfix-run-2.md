# Bug-fix run 2 of 3 — verification report

Date: 2026-09-12
Branch: `bugfix/run-2` (based on `dev` @ `9117b2e`, not pushed or merged)
Scope: main working tree only. The nested worktree `.worktrees/code-sandbox`
(branch `p2/code-sandbox`) was never entered, read, modified, or cleaned.

This is the second of three real-time bug-fixing passes before Phase 3. It starts
from [`bugfix-run-1.md`](./bugfix-run-1.md) and does not restate anything that
report already fixed. The hunting ground is the five Phase-2 modules that landed
after run 1 (`lib/rubric-grading/**`, `lib/quiz-generation/**`, `lib/groups/**`,
`lib/analytics/**`, `lib/lms-export/**`) plus everything they integrate with.

## Environment

| Item                | Value                                                                            |
| ------------------- | -------------------------------------------------------------------------------- |
| OS / shell          | macOS 27 (aarch64), zsh                                                          |
| Node                | v25.9.0                                                                          |
| Next.js             | 16.3.0                                                                           |
| Postgres            | 18.4 (Homebrew), `localhost:5432`                                                |
| `pgvector`          | 0.8.6                                                                            |
| LLM provider        | `mock` (offline; no external calls)                                              |
| App / seed database | `assessment_bugfix2_dev` (created for this run)                                  |
| Test database       | `assessment_bugfix2_test` (name contains `test`, created for this run)           |
| Dev server          | `next dev` on port 3210, `DATABASE_URL=…assessment_bugfix2_dev`                  |
| Developer database  | `assessment_dashboard` — **never** read, reset, migrated, or written by this run |

### Database-safety method

Two databases were created and owned by `assessment_user`:

- `assessment_bugfix2_test` — used only by Vitest; `TEST_DATABASE_URL` contains `test`, so the
  harness guard accepts it. `tests/global-setup.ts` drops and rebuilds `public` from the baseline
  migration on every run.
- `assessment_bugfix2_dev` — used only by the dev server and `prisma db seed`. Its name does **not**
  contain `test`, so the harness can never be pointed at it.

`DATABASE_URL` was passed explicitly on every command, so the repo `.env`
(`assessment_dashboard`) could never win. No `prisma migrate reset`, `migrate dev`, schema edit, or
migration edit was performed. `prisma/schema.prisma`, `prisma/migrations/**`, `package.json`, and
`package-lock.json` are unchanged.

## Commands and outcomes

| Command                                                                                  | Result                                                                 |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `npm run verify` (baseline, before fixes)                                                | **exit 0** — 0 errors, 18 warnings (9 unique; see lint triage)         |
| `npx tsc --noEmit` (baseline)                                                            | **exit 0**                                                             |
| `TEST_DATABASE_URL=…assessment_bugfix2_test npm test` (baseline)                         | **exit 0** — 39 files, 246 tests passed                                |
| `npm run verify` (after fixes)                                                           | **exit 0** — 0 errors, 18 warnings (unchanged)                         |
| `npx tsc --noEmit` (after fixes)                                                         | **exit 0**                                                             |
| `TEST_DATABASE_URL=…assessment_bugfix2_test npm test` (after fixes)                      | **exit 0** — 44 files, **261 tests passed** (+15, all new regressions) |
| `DATABASE_URL=…:59999/ci SESSION_SECRET=x LLM_PROVIDER=mock npm run build` (no-DB build) | **exit 0** — compiled, all routes emitted                              |
| Dev server booted against `assessment_bugfix2_dev`, routes exercised with `curl`         | booted clean; results below                                            |

### Runtime role matrix (dev server, new routes)

| Endpoint (representative)                       | anon | admin | teacher | student |
| ----------------------------------------------- | ---- | ----- | ------- | ------- |
| `GET /api/teacher/export`                       | 401  | 403   | 200     | 403     |
| `GET /api/teacher/export/oneroster`             | 401  | 403   | 200     | 403     |
| `POST /api/teacher/export/lti`                  | 401  | 403   | 422\*   | 403     |
| `GET /api/teacher/analytics`                    | 401  | 403   | 200     | 403     |
| `GET /api/teacher/analytics/items`              | 401  | 403   | 200     | 403     |
| `GET /api/teacher/groups` + `analysis`/`roster` | 401  | 403   | 200     | 403     |
| `POST /api/teacher/groups/form`                 | 401  | 403   | 200     | 403     |
| `GET /api/teacher/rubrics` / `reviews`          | 401  | 403   | 200     | 403     |
| `GET /api/teacher/quiz-generation`              | 401  | 403   | 200     | 403     |
| `POST /api/teacher/quiz-generation`             | 401  | 403   | 200     | 403     |
| `GET /api/student/export` (`/oneroster`)        | 401  | 403   | 403     | 200     |
| `GET /api/student/analytics/retake`             | 401  | 403   | 403     | 200     |
| `GET /api/student/peer-evaluation`              | 401  | 403   | 403     | 200     |

\* 422 is the intended "LTI 1.3 AGS is not configured" response, not an authorization failure.

Object-level IDOR was re-checked with a second seeded teacher (`samuel.brooks@school.edu`): export,
OneRoster, LTI, analytics, item analysis, groups analysis/roster, `?groups?offeringId=`, and
`GET /api/teacher/rubrics/[assessmentId]` all returned **403**, and the review-detail route returned
**404** (it deliberately hides existence), never another teacher's data.

## Bugs found and fixed

### BUG-1 — A partial `PUT /api/teacher/offerings/[id]` wiped every schedule date (High, data loss)

**Evidence (before the fix, live dev server).** The offering had
`registrationOpenAt=2025-12-01`, `registrationCloseAt=2026-01-01`, `startsOn=2026-01-18`,
`endsOn=2026-06-10`. `PUT` with `{ "studentLimit": 30 }` returned
`200 {"success":true,"message":"Offering settings updated."}` and the row became
`30 | NULL | NULL | NULL | NULL`. Every date was destroyed by a request that never mentioned one.

**Root cause.** `app/api/teacher/offerings/[offeringId]/route.ts` used
`parseDateOrNull(value)` which returned `null` for both an omitted field and an invalid one, then
wrote all four fields unconditionally. Run 1 fixed the _invalid string_ case at the contract
boundary but left the _omitted field_ case, which is the more likely request.

**Fix.** The route now distinguishes the three states: `undefined` (omitted → do not write), `null`
(explicit clear → write `null`), and a parsed `Date`. The Prisma `data` object only includes the
fields the caller supplied.

**Regression test.** `tests/offering-partial-update.test.ts` (4 tests): an omitted field is
preserved, an explicit `null` clears only that field, a supplied date updates only that field, and
an unparseable date is still rejected with 400 without touching the row. The route is called with a
signed session cookie and the real database.

### BUG-2 — OneRoster CSV export was vulnerable to spreadsheet formula injection (Medium, security)

**Evidence (before the fix, live dev server).** A teacher created an assessment titled
`=cmd|'/C calc'!A0` through `POST /api/gradebook/assessments`, then downloaded
`GET /api/teacher/export/oneroster?file=lineItems`. The CSV cell was emitted verbatim:

```
lineitem-…,active,…,=cmd|'/C calc'!A0,,2026-12-01T00:00:00.000Z,…
```

Excel/Sheets/LibreOffice evaluate a leading `=`, `+`, `-`, `@` (or tab/CR) cell as a formula when
the file is opened, so exported free text (assessment titles, comments, descriptions) could
execute.

**Root cause.** `lib/lms-export/csv.ts` `escapeCsvField` only applied RFC-4180 quoting. Quoting does
not neutralise a formula, so the standard CSV-injection vector was unhandled; the feature doc only
documented RFC-4180 escaping.

**Fix.** `escapeCsvField` now prefixes string cells that begin with `=`, `+`, `-`, `@`, tab, or CR
with an apostrophe (the OWASP-recommended mitigation; a spreadsheet reads the rest as literal text).
Numeric cells are exempt so a negative number stays a number. RFC-4180 quoting is applied after the
prefix, so quotes/commas/newlines still escape correctly.

**Regression test.** `tests/lms-export-csv-injection.test.ts` (4 tests): each trigger character is
neutralised, a formula cell that also contains a comma/quote is still RFC-4180 escaped, numbers and
benign text are untouched, and a formula title is neutralised in the serialized OneRoster CSV.

Live re-check: the same title now appears as `'=cmd|'/C calc'!A0`.

### BUG-3 — Instructor group analysis still scored soft-removed members (Medium)

**Evidence.** A three-member group had one member soft-removed (`GroupMember.leftAt` set). Calling
`getOfferingAnalysisForTeacher` returned that member in `analysis.memberIds`, `withoutSelf`,
`withSelf`, `freeRiders`, and (with a group grade) `suggestedIndividualGrades` — so a former member
would receive a suggested individual grade, and their retained peer ratings still counted toward the
team norm that scales every remaining member's factor. A DB-backed probe failed before the fix and
passes after.

**Root cause.** `getOfferingAnalysisForTeacher` built `memberIds` from
`group.members` without filtering `leftAt === null`, even though the display serializer
`serializeGroupSummary` already hides removed members. `resolveUniformGroupGrade` and
`recomputeAdjustmentFactorsForGroup` had the same omission, so the persisted factors were computed
against a stale roster too.

**Fix.** All three code paths now score only the current roster (`leftAt === null`). Removed members'
rows and historical evaluations are retained for audit; they are simply no longer part of the
computed team.

**Regression test.** `tests/groups-removed-members.test.ts`: after a soft removal, `memberIds`,
both factor arrays, `freeRiders`, and `suggestedIndividualGrades` all exclude the removed member
while the two active members remain.

### BUG-4 — Rubric evaluation always answered 502 under the offline `mock` provider (Medium, offline/dev)

**Evidence (before the fix).** With `LLM_PROVIDER=mock` (the documented offline mode and the test
default), `POST /api/teacher/reviews/evaluate` had no successful path: the mock had no branch for
`task === "rubric-grading"`, so it returned the generic JSON
`{ mock: true, …, echo: … }`, which `parseCriterionEvaluation` rejects (no `score`/`rationale`/
`evidence`/`confidence`) and the route maps to **502** `CriterionParseError`. The pod's own tests
always injected a provider, so the gap was invisible in CI. After the fix, the same live request
returns 200 with two explainable per-criterion suggestions.

**Root cause.** `lib/llm/providers/mock.ts` synthesized only the `quiz-generation` task; it declared
`rubric-grading` in `LlmTask` but never implemented it, so the flagship rubric flow could not run in
the offline environment at all.

**Fix.** The mock now synthesizes a deterministic, schema-valid `rubric-grading` response: it reads
the criterion ceiling and the quoted submission from the prompt, scores 75% of the ceiling, and uses
the opening words of the submission as the evidence span (so `evidenceVerified` is true). It stays
offline and byte-deterministic.

**Regression tests.** `tests/llm-mock-tasks.test.ts` proves the generic JSON fails the criterion
contract (documenting the pre-fix behaviour) and that the new response parses with verified
evidence, deterministically and within the ceiling. `tests/rubric-grading-offline-mock.test.ts` runs
the whole DB-backed evaluation with **no injected provider** and asserts two suggestions, an
unpublished draft, and `source: AI_SUGGESTED`.

### BUG-5 — Mock quiz synthesis leaked the prompt's material section into subtopic tags (Low, offline/dev)

**Evidence (before the fix).** `createMockProvider().generate({ task: "quiz-generation", json: true })`
parsed the subtopic block by taking every non-empty line after `Subtopic tags to use:`, which
includes the `Course material (ground every question in this content):` heading and every retrieved
source line. Generated drafts therefore persisted `Question.subtopic` values such as
`"Course material (ground every question in this content):"`, which then surfaces in the teacher
review view and analytics. A probe failed before the fix.

**Root cause.** `mockQuizResponse` did not stop at the blank-line boundary between the subtopic
section and the material section, and accepted non-bullet lines as tags even though the prompt
renders tags as `- <tag>`.

**Fix.** Only the first blank-line-delimited section is read and only `- ` bullet lines become tags;
when no tags are supplied it falls back to `<topic> fundamentals` as before.

**Regression test.** `tests/llm-mock-tasks.test.ts`: supplied bullet tags are used exactly, a
non-bullet material heading supplied as source text never becomes a tag, and the no-tags fallback is
`"<topic> fundamentals"`.

## Confirmed vs suspected

### CONFIRMED (reproduced by a failing-then-passing test or a reproduced request)

| #     | Severity | Area            | Summary                                                              |
| ----- | -------- | --------------- | -------------------------------------------------------------------- |
| BUG-1 | High     | legacy route    | Partial offering update erased all schedule dates                    |
| BUG-2 | Medium   | lms-export      | CSV formula injection in exported cells                              |
| BUG-3 | Medium   | groups          | Soft-removed members scored and suggested for individual grades      |
| BUG-4 | Medium   | rubric + llm    | Rubric evaluation 502s under the offline mock provider               |
| BUG-5 | Low      | quiz-generation | Mock subtopic parser leaked the material section into persisted tags |

### SUSPECTED (code-visible, not reproduced end-to-end; deliberately not changed)

| #   | Suspicion                                                                                                                                                                                                                                                                                                                                        | Why it is only suspected                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-1 | `PUT /api/teacher/assessments/submissions` is a full replace: a body that omits `score` sets it to `null`, reverts `GRADED` → `SUBMITTED`, and clears `gradedAt`/`feedback`. Only feedback-only requests would trigger it.                                                                                                                       | The only client (`components/teacher-submissions-manager.tsx`) always sends `score` and `feedback` together, so no user-visible failure was reproduced. Changing legacy PUT semantics needs a product decision; flagged only. |
| S-2 | The review-queue grouping key (`criterionId → criterionLabel → submissionId → id`) differs from the grade-dedup key (`criterionId → quizResponseId → submissionId → criterionLabel → overall`). A suggestion with `submissionId` + `criterionLabel` but no `criterionId`/`quizResponseId` would be grouped differently by the UI and the totals. | No current producer emits that shape (rubric suggestions carry `rubricCriterionId`, quiz suggestions carry `quizResponseId`), so it cannot be triggered through an API today.                                                 |
| S-3 | `POST /api/student/courses/enroll` counts active enrollments then writes without a transaction or lock, so two concurrent requests at capacity can over-enrol.                                                                                                                                                                                   | Unchanged from run 1 (S-3); needs a race harness, and the check-then-act did not fail under single-threaded curls. Not re-fixed here.                                                                                         |

## Lint warnings — 18 reported, 9 unique, 0 real defects

`eslint .` walks into the sibling worktree `.worktrees/code-sandbox`, which contains a second checkout
of the same components, so every main-tree warning is reported twice: 9 in the main tree and 9
identical copies under `.worktrees`. `.prettierignore` already excludes `.worktrees`
("the parent gate must not format them"), but `eslint.config.mjs` does not.

The 9 unique main-tree warnings are exactly run 1's residual list and none indicate a defect:

- 5× `react-hooks/set-state-in-effect` (`gradebook-provider`, `student-assessments-view`,
  `student-courses-view`, `teacher-classes-manager`, `teacher-submissions-manager`) — fetch-on-mount
  loaders; no synchronous `setState` in the effect body.
- 2× `@next/next/no-location-assign-relative-destination` (`dashboard-header.tsx`) — deliberate full
  navigation after logout.
- 2× `react-hooks/exhaustive-deps` (`gradebook-provider.tsx`) — captured closures only touch stable
  setters.

No new warning was added by the Phase-2 modules or by this pass. I deliberately did **not** add
`.worktrees/**` to the ESLint ignores: that is shared tooling another pod is actively working in, the
change would only hide a gate-hygiene issue rather than fix product code, and the instruction was to
avoid gate changes. It is recorded here for the owner to decide.

## Could not verify

- **The 18-warning count is inflated by the sibling worktree.** I confirmed `.worktrees/code-sandbox`
  is the source of the duplicate 9 warnings via ESLint's JSON output, but did not touch that
  directory or its configuration.
- **BUG-4's route-level 502 was reproduced at the parse boundary**, not by reverting the provider on
  disk: `parseCriterionEvaluation` on the generic mock JSON is directly tested to throw, and the route
  maps that error to 502. The fixed path is reproduced live (200).
- **S-1, S-2, S-3** could not be reproduced (see the table).
- **Browser hydration / client console.** No browser automation; changed code is server-side only for
  this pass, and client components were type-checked and linted.
- **GitHub Actions CI.** Not run (nothing was pushed).
- **`POST /api/auth/seed` and `POST /api/admin/dev/rebalance-offerings`.** Not re-exercised; unchanged
  by this pass.
- **The blank-`DATABASE_URL`/blank-`SESSION_SECRET` runtime boot.** Only the no-DB _build_ was run
  (exit 0); run 1's blank-env build result still stands.
- **Environments other than Postgres 18.4 Homebrew.** Only the local instance was available.

## Schema and dependency changes

None were made and none are required for these fixes. `prisma/schema.prisma`,
`prisma/migrations/**`, `package.json`, and `package-lock.json` are unchanged. No dependency was
added. The only shared file touched outside the five new modules is
`app/api/teacher/offerings/[offeringId]/route.ts` (BUG-1) plus `lib/llm/providers/mock.ts` (BUG-4/5),
which the quiz-generation pod also edits; both changes are additive and commented.

## Branch status

`bugfix/run-2` is green:

- `npm run verify` → exit 0 (0 errors, 18 warnings = 9 unique + 9 duplicates from the sibling worktree).
- `npx tsc --noEmit` → exit 0.
- `npm test` with `TEST_DATABASE_URL` → 44 files, 261 tests passed.
- no-DB build → exit 0.
- Dev server role and IDOR matrices all as intended.
- No gate, lint rule, or test was weakened, skipped, or disabled; no `@ts-ignore`, `@ts-expect-error`,
  or new `any` was introduced.
