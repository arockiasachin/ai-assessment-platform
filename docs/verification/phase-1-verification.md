# Phase 1 — Pre-Phase-2 Verification Report

Date: 2026-09-11
Branch: `dev`
Tree verified at: `9ab0b64` (`docs: record server-authoritative quiz grading`) plus the
gradebook-scoping fix committed by this campaign.

This report records a local, network-offline verification and bug-fixing pass over the Phase 1
contracts before Phase 2 fans out. It states exactly what was run, what passed, what failed, and
what could **not** be verified.

## Executive summary

- All three gates are green: `npm run verify` (0 errors, 13 warnings), `npm run build` with an
  unreachable database, and `npm test` (9 files, 37 tests) against a real pgvector Postgres.
- **One real application defect was found and fixed: High severity.** A student's `GET /api/gradebook`
  returned every classmate's identity and every classmate's marks. Fixed and covered by a DB-backed
  regression test.
- **One operational finding:** the local Postgres had no `pgvector` extension, so the baseline
  migration could not be applied locally at all. Documented; resolved for this run by installing
  `pgvector` locally (not a repository change).
- The developer's `assessment_dashboard` database was **never** reset, dropped, migrated, or
  otherwise modified. All runtime work used separate databases.
- **Important caveat — concurrent writers.** This tree was not single-writer during the campaign.
  `HEAD` advanced from `f427663` → `a5f70db` → `8128b97` → `63e642a` → `9ab0b64` while this pass ran,
  and a concurrent writer landed the server-authoritative quiz pod (see "Concurrent changes").
  Gate results are therefore point-in-time; this report says which tree each result came from.

## Environment

| Item               | Value                                                                  |
| ------------------ | ---------------------------------------------------------------------- |
| OS / shell         | macOS 27 (aarch64), zsh                                                |
| Node               | v25.9.0                                                                |
| Next.js            | 16.3.0                                                                 |
| Postgres           | 18.4 (Homebrew) on `localhost:5432`                                    |
| `pgvector`         | 0.8.6 (installed during this campaign; was absent — see Finding OPS-1) |
| LLM provider       | `mock` (offline; no external calls)                                    |
| Databases used     | `assessment_test`, `assessment_verify` (created for this run)          |
| Database untouched | `assessment_dashboard` (the developer's data)                          |

### Database-safety method

`assessment_user` can create databases, so two dedicated databases were created: `assessment_test`
(for Vitest, name contains "test") and `assessment_verify` (for the dev server and seed). The dev
server was started with an explicit `DATABASE_URL` pointing at `assessment_verify`. Because
`@next/env` does not override an already-set `process.env` value, the repo `.env`
(`…/assessment_dashboard`) could not win. This was confirmed empirically: the user ids returned by
the login API existed in `assessment_verify` and did **not** exist in `assessment_dashboard`.

## Phase A — Static and build verification

### A1. `npm run verify` (typecheck + lint + format:check)

Outcome: **pass**, exit 0. Typecheck and Prettier clean; lint reports **0 errors, 13 warnings**.

```
✖ 13 problems (0 errors, 13 warnings)
...
Checking formatting...
All matched files use Prettier code style!
```

The 13 warnings (unchanged from the pre-existing count):

| File                                         | Count | Rule                                                       |
| -------------------------------------------- | ----- | ---------------------------------------------------------- |
| `components/dashboard-header.tsx`            | 2     | `@next/next/no-location-assign-relative-destination`       |
| `components/gradebook-provider.tsx`          | 3     | 1× `react-hooks/set-state-in-effect`, 2× `exhaustive-deps` |
| `components/student-assessments-view.tsx`    | 4     | 1× `react-hooks/set-state-in-effect`, 3× `exhaustive-deps` |
| `components/student-courses-view.tsx`        | 2     | 1× `react-hooks/set-state-in-effect`, 1× `exhaustive-deps` |
| `components/teacher-classes-manager.tsx`     | 1     | `react-hooks/set-state-in-effect`                          |
| `components/teacher-submissions-manager.tsx` | 1     | `react-hooks/set-state-in-effect`                          |

**Assessment of the warnings (no code change made).** Every `set-state-in-effect` warning is the same
pattern: `useEffect(() => { void load() }, [])`, where `load` is an `async` function that only calls
`setState` after `await` (in the response handler / `finally`). The React rule flags the transitive
call, but the updates are not synchronous within the effect body, so these are not cascade-render or
stale-state bugs; they are the standard fetch-on-mount pattern. The `exhaustive-deps` warnings are
stability warnings for a mount-only loader and for inline logical expressions re-created each render
(a minor `useMemo` recomputation, not a correctness bug). The two
`no-location-assign-relative-destination` warnings are in `handleLogout`, which deliberately uses
`window.location.href = "/login"` to force a full navigation and drop client state; changing it is a
style preference, not a defect. **No lint warning was found that indicates a real bug worth fixing in
this pass.**

### A2. `npm run build` with an unreachable database

```
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:59999/ci" SESSION_SECRET=x LLM_PROVIDER=mock npm run build
```

Outcome: **pass**, exit 0. `✓ Compiled successfully`, `Finished TypeScript`, 33/33 static pages
generated. The build needs no reachable database.

### A3. `npm test`

Without a test database (i.e. no `TEST_DATABASE_URL`, ambient `DATABASE_URL` = the developer's DB):

```
 Test Files  1 failed | 5 passed (6)
      Tests  23 passed (23)
```

`tests/spine.test.ts` fails to load, verbatim:

```
Error: Refusing to run database tests against "assessment_dashboard": the database name must contain "test". Set TEST_DATABASE_URL to a dedicated test database (name must contain "test"), e.g. postgresql://postgres:postgres@localhost:5433/assessment_test. See tests/README.md.
```

This is the harness working as designed: it refuses to touch a non-test database. The side effect is
that the default `npm test` script exits non-zero without a configured test database, so the pure
suite is only green when `TEST_DATABASE_URL` is set (CI sets it). With a test database:

```
TEST_DATABASE_URL="postgresql://…/assessment_test" SESSION_SECRET=test-secret LLM_PROVIDER=mock npm test
→ Test Files  9 passed (9)   Tests  37 passed (37)
```

### A4. `npx prisma validate` / `npx prisma generate`

Both **pass**. Schema valid; client generated to `./lib/generated/prisma` (Prisma 7.9.1).

## Phase B — Runtime / operational verification

A real database was reachable, so full runtime verification was performed.

### B1. Database provisioning

- `createdb assessment_test`, `createdb assessment_verify`.
- `DATABASE_URL=…/assessment_verify npx prisma migrate deploy` → the single baseline migration
  `20260911180000_baseline` applied cleanly.
- `DATABASE_URL=…/assessment_verify npx prisma db seed` → `Seed complete`.
- Note: `prisma db seed` (tsx) needs to create an IPC pipe; it failed inside the sandbox with
  `EPERM … tsx-….pipe` and succeeded when run outside the sandbox. This is a sandbox artifact, not
  an app defect.

### B2. Server boot

`next dev -p 3100` with `DATABASE_URL=…/assessment_verify`, `SESSION_SECRET=verify-local-secret`,
`LLM_PROVIDER=mock`:

```
▲ Next.js 16.3.0 (Turbopack)
- Local:  http://localhost:3100
✓ Ready in 291ms
```

Booted cleanly. Across the whole campaign the server log contained **no 500s, no exceptions, no
unhandled rejections, and no error/warn lines** other than npm's unrelated `Unknown env config`
warning.

### B3. Authentication

| Request                               | Result                         |
| ------------------------------------- | ------------------------------ |
| `POST /api/auth/login` admin/`admin`  | 200, signed `auth-user` cookie |
| `POST /api/auth/login` teacher.math   | 200                            |
| `POST /api/auth/login` student ava.t  | 200                            |
| `POST /api/auth/login` wrong password | 401 `Invalid credentials.`     |

### B4. Page route matrix (HTTP status, redirect target)

| Route                                                                                           | admin         | teacher        | student        | anon         |
| ----------------------------------------------------------------------------------------------- | ------------- | -------------- | -------------- | ------------ |
| `/admin`, `/admin/users`, `/admin/data`, `/admin/offerings`, `/admin/tools`                     | 200           | 307→`/teacher` | 307→`/student` | 307→`/login` |
| `/teacher`, `/teacher/assignments`, `/teacher/classes`, `/teacher/planner`, `/teacher/reports`  | 307→`/admin`  | 200            | 307→`/student` | 307→`/login` |
| `/student`, `/student/assessments`, `/student/courses`, `/student/events`, `/student/resources` | 307→`/admin`  | 307→`/teacher` | 200            | 307→`/login` |
| `/quiz`                                                                                         | 200           | 200            | 200            | 307→`/login` |
| `/`                                                                                             | 307→role home | 307→role home  | 307→role home  | 307→`/login` |
| `/login`, `/register`                                                                           | 307→`/admin`  | 307→`/teacher` | 307→`/student` | 200          |

No 500s and no redirect loops were observed.

### B5. API authorization matrix

| Endpoint / method                          | anon | admin        | teacher         | student |
| ------------------------------------------ | ---- | ------------ | --------------- | ------- |
| `GET /api/gradebook`                       | 401  | 403          | 200             | 200     |
| `GET /api/student/assessments`             | 401  | 403          | 403             | 200     |
| `GET /api/student/courses`                 | 401  | 403          | 403             | 200     |
| `GET /api/teacher/offerings`               | 401  | —            | 200             | 403     |
| `GET /api/teacher/assessments/submissions` | 401  | —            | 200             | 403     |
| `GET /api/teacher/reports/ratings`         | 401  | —            | 200             | 403     |
| `POST /api/admin/dev/rebalance-offerings`  | 401  | (admin-only) | 403             | 403     |
| `POST /api/gradebook/marks`                | 401  | 200          | 200 (own)       | 403     |
| `POST /api/teacher/quiz`                   | 401  | —            | 400 on bad body | 403     |
| `POST /api/gradebook/assessments`          | —    | —            | 400 on bad body | 403     |

### B6. Object-level authorization (writes)

With real records from the seeded `assessment_verify` database:

| Scenario                                                         | Result                                                |
| ---------------------------------------------------------------- | ----------------------------------------------------- |
| Teacher writes a mark for their own offering                     | 200                                                   |
| Teacher B writes a mark for Teacher A's assessment               | **403 `Forbidden`**                                   |
| Admin writes any mark                                            | 200                                                   |
| Teacher writes a mark for a student not enrolled in the offering | **400 `Student not enrolled in assessment offering`** |
| Teacher writes to a non-existent assessment                      | **404 `Assessment not found`**                        |

### B7. Seed endpoint safety

| Caller / body                        | Result                                           |
| ------------------------------------ | ------------------------------------------------ |
| anon, no body                        | 401                                              |
| student, no body                     | 403                                              |
| teacher, no body                     | 403                                              |
| admin, no body                       | 400 (missing `confirm`)                          |
| admin, wrong `confirm`               | 400                                              |
| admin, `{ "confirm": "RESET-SEED" }` | 200, `seededEmails` only (no credentials echoed) |

### B8. Forged / tampered sessions

| Cookie                                         | Request              | Result       |
| ---------------------------------------------- | -------------------- | ------------ |
| Unsigned base64 payload claiming `role: admin` | `GET /admin`         | 307→`/login` |
| Same, tampered signature                       | `GET /api/gradebook` | 401          |
| Unsigned payload                               | `GET /admin`         | 307→`/login` |

`POST /api/auth/logout` returns 200 and clears `auth-user` (`Max-Age=0; Expires=1970`).

### B9. Server-authoritative quiz grading (landed by a concurrent writer)

Verified end-to-end at runtime:

| Request                                | Result                                               |
| -------------------------------------- | ---------------------------------------------------- |
| `POST /api/quiz/grade`, anon           | 401                                                  |
| as student, own quiz                   | 200; response returns the key **only after grading** |
| as student naming another student's id | 403                                                  |
| as the owning teacher                  | 200                                                  |
| as a different teacher                 | 403                                                  |
| `GET /api/gradebook` payload           | 0 questions expose `correctIndex`                    |

## Bugs found

### BUG-1 — Student gradebook payload exposed the whole cohort (High)

**Symptom.** A signed-in student calling `GET /api/gradebook` received:

- `students`: 9 entries — the student **and 8 classmates** (name, email, register number).
- `marks`: 198 entries, of which **164 belonged to other students**; only 34 were the caller's own.
- `selectedStudentId` defaulted to the caller, but the client `StudentView` rendered a student
  selector listing every classmate and displayed the selected classmate's marks.

**Evidence (before the fix).**

```
students returned: 9
student emails: [ 'ava.t@school.edu', 'liam.c@school.edu', 'sofia.m@school.edu', … ]
mark entries returned: 198
mark entries belonging to OTHER students: 164
```

**Severity: High.** It is a straightforward object-level authorization / privacy failure: a student
could read every classmate's grades from an API the UI already offered a selector for. It directly
contradicts the Phase 1 acceptance claim that object-level checks keep "a student to their own data".

**Root cause.** In `lib/gradebook-db.ts`, `getGradebookPayloadForSessionUser` had separate teacher
and student branches, but the student branch reused the teacher-shaped payload: it fetched each
offering's full `enrollments` and built `students` from every enrollment, and built `marks` from
every `AssessmentGrade` row for the offering. The `StudentView` then computed the class average from
those raw rows, which is why the roster had been included in the first place.

**Fix.**

- `lib/gradebook-db.ts`
  - Student `students` is now exactly the signed-in student's own row.
  - Student `marks` now contains only `AssessmentGrade` rows whose `studentId` is the caller's.
  - Added a server-computed `classAverages: { [assessmentId]: percentage | null }` aggregate. This is
    the only class-level signal the payload carries.
  - Removed the nested `enrollments` include from the student query, so classmates' rows are never
    fetched, as defense in depth.
- `components/gradebook-provider.tsx` — carries `classAverages` through context.
- `components/student-view.tsx` — the trend/`vs Class average` view now reads `classAverages`
  instead of deriving an average from classmates' marks. Teacher behavior is unchanged; the teacher
  branch still returns the full cohort the teacher is authorized to see.

**Regression coverage.** `tests/gradebook-scoping.test.ts` (DB-backed, runs against the migrated
test database). It seeds the fixture student plus a classmate in the same offering with marks 15/20
and 5/20, then asserts:

- the student payload's `students` is exactly `[ownId]`;
- `marks` is exactly the single own key/value (`15`);
- `classAverages[assessmentId]` is the aggregate `50`, not any raw row;
- the serialized payload does not contain the classmate's email, id, or mark key;
- the teacher payload still contains both students and both marks.

**Verified after the fix (live server).**

```
students returned: 1 [ 'ava.t@school.edu' ]
total marks: 34
marks not belonging to self: 0
classAverages entries: 34
has any classmate email: false
GET /student HTTP 200
```

## Operational findings (not application bugs)

### OPS-1 — Local Postgres has no `pgvector`, so the baseline migration cannot apply (Medium, environment)

`pg_available_extensions` did not contain `vector`, and no `vector.control` existed under the
Homebrew Postgres 18 sharedir. The baseline migration begins with `CREATE EXTENSION IF NOT EXISTS
vector;` and creates `MaterialChunk.embedding vector(1536)` plus an HNSW index, so `prisma migrate
deploy` fails against a stock local Postgres. CI is unaffected because `ci.yml` uses the
`pgvector/pgvector:pg16` service image. Consequence: the documented claim "the migration applies
cleanly" was, before this run, true only in CI; it could not be reproduced on this machine.

Resolution: installed `pgvector` 0.8.6 via Homebrew (a machine-level change, **not** a repository
change), after which the baseline migration applied cleanly and the full DB-backed suite ran locally.
No repository file was changed for this; it is recorded here so the next local run is not surprised.
Teams should ensure `pgvector` (or a `pgvector/pgvector` container) is available before running the
DB-backed tests outside CI.

### OPS-2 — `npm test` exits non-zero with no test database (Low, by design)

Covered in A3. The harness deliberately refuses to run DB tests against a non-test database by name,
which makes the default `npm test` fail offline. Not weakened or changed; CI and local runs with
`TEST_DATABASE_URL` are green.

## Documentation corrections

`docs/phases/phase-1-contracts.md` contained claims that are no longer true and were corrected:

- The API-contract deliverables list omitted `lib/contracts/quiz.ts` (added by the concurrent quiz
  pod).
- The verification block pinned a stale commit (`e87d7bd`) and stated the DB-backed suite "still
  needs Docker". Corrected: the suite runs locally against any pgvector Postgres; the commands and
  the current verified tree are recorded, and it now links to this report.
- A risk bullet said the state-machine service test was blocked because "the current local run has no
  Docker". Corrected: the harness runs locally now; that test is deferred to the Phase 2 grading pod,
  not to the environment.

## Concurrent changes during the campaign

The task stated this working tree had a single writer, but it did not. While this pass ran, `HEAD`
advanced and the following landed from another writer:

- `63e642a fix(grading): grade quizzes server-side and stop sending answer keys`
- `8128b97 fix(auth): send the seed confirmation token from admin tools`
- `9ab0b64 docs: record server-authoritative quiz grading`

Consequences for this report:

- The "known residual" this campaign was told to confirm but not fix — `lib/gradebook-db.ts`
  returning `QuizQuestion.correctIndex` and `components/quiz-runner.tsx` grading in the browser — is
  **no longer present**. It was fixed concurrently. The current quiz runner posts selected answers to
  `POST /api/quiz/grade`, and the payload no longer carries `correctIndex` (both confirmed at
  runtime, see B9). This campaign's own fix does not touch that path.
- Phase A/B results above were re-run after the concurrent commits landed (current tree `9ab0b64`
  plus this campaign's fix), except where a result is explicitly attributed to an earlier tree.
- To avoid staging another writer's in-flight work, this campaign waited for the concurrent writer to
  commit before editing the shared `lib/gradebook-db.ts`. Only files changed by this campaign are
  staged in its commit.

## Could NOT verify (and why)

- **Client-side hydration / browser console.** The bundled browser-automation tab was unavailable in
  this context (`No browser tab available`), so no real browser session was driven. Server-rendered
  `GET /student` and `GET /quiz` returned 200 and the client payload was verified via the API, but
  runtime React hydration warnings were **not** directly observed. The fix is type-checked and the
  changed component's data path is exercised server-side; a browser smoke test remains advisable.
- **Student assignment submission object-level authorization end-to-end.** The code path in
  `app/api/student/assessments/[assessmentId]/submission/route.ts` was reviewed statically (it
  requires an `active` enrollment in the assessment's offering) but not exercised with a
  non-enrolled student, because a convenient non-enrolled assessment/student pair was not available
  in the seed without mutating data further.
- **GitHub Actions CI.** Not run (no push; offline campaign). The workflow file was read and its
  pgvector service is consistent with the local run.
- **The Docker-based harness path.** Docker was installed but not running; verification used the
  native Postgres instead, which exercises the same `prisma migrate deploy` code path.
- **Postgres environments other than 18.4 Homebrew.** Only the local instance was available.

## Branch status

Green and ready for the Phase 2 fan-out, with the caveat that a second writer was active in the same
tree:

- `npm run verify` → exit 0 (0 errors, 13 pre-existing warnings).
- `npm run build` with an unreachable DB → exit 0.
- `npm test` with `TEST_DATABASE_URL` → 9 files, 37 tests passed.
- `npx prisma validate` / `npx prisma generate` → pass.
- No gate, lint rule, or test was weakened, skipped, or disabled; no `ignoreBuildErrors`, `@ts-ignore`,
  or new `any` was introduced.
