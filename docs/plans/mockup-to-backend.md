# Connecting the mockups to the backend

Status: **plan, not started.** Written against `dev` @ `2bc51b5` (after the UI mockup work
merged and CI passed).

The mockup tree (`app/mockup/**`, 38 routes) is a finished design deliverable backed by typed
fixtures in `lib/mock/`. This plan is how it becomes the real product.

---

## 1. The decision that shapes everything

**Port the mockup _presentation_ onto the existing real pages. Do not add data fetching to
`/mockup`.**

The reason is that the backend side already exists. There are **31 real page routes** under
`app/(dashboard)/` with **69 API route handlers** behind them, server-side `requireRole`
authorization, a working seed (`prisma/seed-demo.ts`), and **93 test files** including an
end-to-end spine (`tests/demo-spine.test.ts`). The mockups are not a prototype of pages that
don't exist — for most domains they are a _redesign of pages that already work_.

So the work is not "build a backend". It is "replace the presentation layer of pages whose data
layer is already tested."

### Why not the alternatives

| Approach                            | Why not                                                                                                                                                                                                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wire `/mockup` to real data         | Duplicates every query, and needs its own authorization. `proxy.ts:115-125` deliberately does **not** match `/mockup`, and `app/mockup/layout.tsx` says _"There are no auth guards here — do not add any."_ We'd be building a second, untested frontend. |
| Rewrite the real pages from scratch | Throws away working server data loading and would invalidate `tests/demo-spine.test.ts`, the main proof that grading works.                                                                                                                               |
| Keep both trees permanently         | Two frontends to maintain, guaranteed to drift.                                                                                                                                                                                                           |

### What "port" means, per page

A real page **keeps**:

- the Server Component + `export const dynamic = "force-dynamic"` where needed
- `requireRole(...)` / `getSessionUser()` and its error path
- the existing Prisma query or `lib/*` service call
- its place under `proxy.ts`'s matcher (so auth keeps working)

A real page **gains**:

- the mockup's composition: `AppShell`/nav, `PageHeader`, KPI row, `SectionCard`, `DataTable`,
  `PageTabs`, `FilterBar`, and the primitives (`Callout`, `StatusPill`, `StatCard`,
  `TruncatedText`, `CodeBlock`)
- real data mapped into the view-model types in `lib/mock/types.ts`

`lib/mock/types.ts:5-14` already states this intent: its string unions mirror Prisma enums _"so
a later wiring pass maps 1:1 without translation tables."_ That file becomes the seam.

---

## 2. The seam: how data flows

```
server component (real page)
  → requireRole / query (unchanged)
  → map real row → view model from lib/mock/types.ts
  → render mockup composition with real props
```

Two rules that make this safe, both from the existing design system:

1. **`null` means "no value yet" and renders as `—`, never `0`.** (`docs/ui/design-system.md:122-124`.)
   This is load-bearing: `Grade.percentage` is `Float?`, `QuizAttempt.score` is `Decimal?`, and
   item analysis deliberately withholds `difficultyIndex` below threshold
   (`tests/demo-spine.test.ts:385-391` asserts the withholding). Any wiring that defaults nulls
   to `0` breaks documented behaviour.
2. **Do not re-fetch on the client what the server already has.** The known P1 a11y/perf finding
   (`docs/quality/a11y-perf-audit.md:33-34,49`) is that `GradebookProvider` fetches in a client
   `useEffect` on mount. The port is the opportunity to fix it by passing server-fetched props,
   not the moment to add more client fetching.

### The `lib/mock` rules that this plan supersedes

`docs/ui/design-system.md:410-429` currently forbids fetch, Prisma, and touching
`app/(dashboard)/**`. Those rules describe the _static_ phase and are superseded by this plan.
They should be amended when the first page ports, so the doc doesn't contradict the code.

---

## 3. Waves

Sequenced by dependency and risk. Each wave ends green (`npm run verify`, `npm test`, CI) and is
mergeable on its own.

### Wave 0 — foundations (do once, unblocks everything)

| Item                             | Detail                                                                                                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adopt the shell in the real tree | `AppShell`/`SideNav`/`TopBar` currently only wrap `/mockup`. Real pages still use `components/dashboard-header.tsx` + `components/role-*.tsx`. Decide and do the swap once. |
| View-model mapping helpers       | Pure functions `Prisma → lib/mock/types.ts`. Unit-testable without a DB. Start with the domains in Wave 1.                                                                  |
| Resolve the two-nav problem      | `components/shell/nav-config.ts` (mockup nav) vs the real `dashboard-header` nav. One must win.                                                                             |
| Amend `docs/ui/design-system.md` | Remove the "never fetch / don't touch `(dashboard)`" rules; state the mapping rule instead.                                                                                 |

### Wave 1 — backend already complete (pure presentation port, no backend work)

These domains have a working endpoint or service **today**. The work is composition + mapping.

| Mockup page                                | Real backing                                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `teacher/reviews`                          | `GET /api/teacher/reviews`, `/[assessmentId]/[studentId]` + POST decision                           |
| `teacher/rubrics`                          | `/api/teacher/rubrics`, `/[assessmentId]`                                                           |
| `teacher/submissions`                      | `GET`/`PUT /api/teacher/assessments/submissions`                                                    |
| `teacher/code-tasks`                       | `listTeacherCodeTasks`, test-case CRUD, runs, similarity (9 routes)                                 |
| `teacher/groups`                           | `/api/teacher/groups` + `/analysis`, `/contributions`, `/form`, `/milestones`, `/roster` (9 routes) |
| `teacher/classes`                          | `/api/gradebook` (roster) + `/api/teacher/groups/roster`                                            |
| `teacher/reports`                          | `GET /api/teacher/reports/ratings` → `lib/course-ratings.ts:108`                                    |
| `student/assessments`                      | `GET /api/student/assessments` + submission POST                                                    |
| `student/quizzes`                          | `/api/student/quiz-attempts`, `/[attemptId]`, `/submit`                                             |
| `student/code-submissions`                 | `listStudentCodeTasks`, `getStudentRun`, `submitCodeForStudent`                                     |
| `student/peer-evaluation`                  | `GET`/`POST /api/student/peer-evaluation`                                                           |
| `student/courses`                          | `/api/student/courses`, `/enroll`, `/rating`                                                        |
| `auth/login`, `auth/register` (standalone) | `app/(auth)/login`, `/register` already work                                                        |

**This is the highest value-to-risk wave and should go first.** Zero schema change, zero new
endpoints, and the data is already covered by tests.

### Wave 2 — models exist, readers missing

Three features have a Prisma model but **no query, route, or real page**. The corresponding real
pages are literally stubs (`FuturePagePlaceholder` — verified, exactly 3):

| Real page                | Mockup              | Model exists                                         | Missing                                                                                      |
| ------------------------ | ------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `student/resources`      | `student/resources` | `Material` (schema `:383`), `MaterialChunk` (`:405`) | **Landed in Wave 2** (`lib/materials.ts`, S1) — no longer a reader gap.                      |
| `student/events` (stub)  | `student/events`    | `CalendarEvent` (`schema:268`)                       | A calendar query/route. Only the 4–5 "upcoming" rows leak out via `gradebook-db.ts:242,402`. |
| `teacher/planner` (stub) | `teacher/planner`   | `CalendarEvent`                                      | Calendar CRUD.                                                                               |

Two of these three mockup pages are still **design ahead of the backend** — the only ones where the
backend must be built, and only as readers over models that already exist.

### Wave 3 — needs derivation, not new tables

The data exists; the aggregations don't.

| Need                                                | Reality                                                                                                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Score-trend series, sparklines                      | `lib/analytics` has no trend aggregation. The overview contract returns only per-assessment `attemptCount/average/passRate` + `alerts` (`lib/contracts/analytics.ts:208-218`). |
| Topic mastery                                       | Not produced anywhere.                                                                                                                                                         |
| At-risk student roster                              | `alerts` exist; the roster view needs a query.                                                                                                                                 |
| Teacher/student dashboard KPI tiles                 | Must be computed from existing reads.                                                                                                                                          |
| `RetakeRecommendation` (per-topic mastery + reason) | The real retake contract returns failed/unanswered question ids only (`analytics.ts:277-291`).                                                                                 |

Each of these is a decision about **what the number means**. The mockups currently assert a
number with no derivation — e.g. `completionPercent: 62` matches neither 58% (submitted/expected)
nor 69% (released assessments). Prefer deriving, or label it honestly.

### Wave 4 — admin

Admin is structurally different: **there are no admin API routes** (only 2 handlers, both dev
tools: retention purge and offering rebalance). The real admin pages read Prisma **directly in
Server Components** via `lib/admin-db.ts` and `app/(dashboard)/admin/data/page.tsx:27-144`.

So porting the admin mockups reuses that pattern — no API routes needed. But it drags in gaps
with no model at all: `AdminDataset` (retention/rowCount/source), `AdminTool` run history,
`FeatureFlag`, institution settings.

### Wave 5 — the decision list

See §4. Each item needs a call before it can be built.

---

## 4. The decision list

Fixture fields the mockups render that **have no schema backing**. Each needs one of:
**derive** (compute from real data), **drop** (remove from the UI), or **migrate** (add a column).

| Fixture field                                               | Reality                                                                                                                                                               | Recommendation                                                                                                                                                                                            |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `QuizInProgressAttempt.kind: "GRADED" \| "PRACTICE"`        | `QuizAttempt` has **no `kind` column** (verified; it has `status: QuizAttemptStatus` only). Adaptive retake is read-only and persists nothing.                        | **Decide:** is a practice attempt a real attempt? If yes → migrate a column. If no → drop the distinction from the UI, or model practice runs outside `QuizAttempt`. This is the biggest single decision. |
| `Assessment.weightPercent`                                  | `Assessment` has `maxMarks` and `maxAttempts` but **no weight** (verified). Weights exist only inside the LMS export request body (`lib/contracts/lms-export.ts:42`). | **Migrate** if weights are meant to be persistent course config; otherwise **drop** from assignment UI and keep them export-only.                                                                         |
| `Student.lastActiveAt`, `AdminUser.lastLoginAt`             | No activity/login timestamp anywhere.                                                                                                                                 | **Derive** from `AuditLog` if it records login, else **drop**. Don't add a column just to fill a table.                                                                                                   |
| `ExportRow` (target/platform/mappedUsers/totalUsers/issues) | No export-job model; only `LtiRegistration` + `LtiUserMapping`.                                                                                                       | **Derive** partially; **drop** `issues`. An "export history" needs a model — only worth it if multiple exports must be tracked.                                                                           |
| `AdminDataset`, `AdminTool`, `FeatureFlag`                  | No models.                                                                                                                                                            | **Drop** feature flags from the UI (no settings surface exists). Keep `AdminDataset` read-only as a _view over real tables_, not a new entity.                                                            |
| `MockNotification`                                          | No `Notification` model.                                                                                                                                              | **Drop** the notification popover, or build it as a real model. It is currently 4 hardcoded rows.                                                                                                         |
| `MaterialView.indexed/chunks/state/sizeLabel`               | `Material` exists; nothing reads it.                                                                                                                                  | **Derive** (count `MaterialChunk` rows) in Wave 2.                                                                                                                                                        |
| `SubmissionRow.versionCount`                                | `SubmissionVersion` exists but only the retention purge touches it.                                                                                                   | **Derive** — it's a `count()` away.                                                                                                                                                                       |
| `TeacherAnalyticsSummary` trend/mastery                     | No aggregation.                                                                                                                                                       | **Derive** in Wave 3, or cut the charts.                                                                                                                                                                  |

---

## 5. Auth reconciliation

**Today:** `/mockup` is outside `proxy.ts` (verified — the matcher lists `/`, `/login`,
`/register`, `/quiz`, `/admin`, `/teacher`, `/student`, `/api`, but **not `/mockup`**) and has no
guards by design. Identity comes from `MOCK_CURRENT_USER` in `lib/mock/session.ts:7-38`, consumed
by `components/shell/top-bar.tsx:16,136`. `components/gradebook-provider.tsx:137-141` explicitly
skips its fetch on `/mockup` routes.

**After the port:** this resolves itself. Porting into `app/(dashboard)/**` means the real
`proxy.ts` gate and `requireRole` apply automatically; `MOCK_CURRENT_USER` is replaced by the
real session from `lib/session.ts`; the gradebook-provider mockup skip can be deleted.

**Consequence:** the mockup tree's reason to exist ends at the port. Recommendation: **keep
`/mockup` until the ported pages are verified, then delete the tree** (except as a design
reference in git history). Decide at the end of Wave 1, not now.

---

## 6. Risks

| Risk                                          | Detail                                                                                                                                                                                                                                 | Mitigation                                                                                                                                                                          |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Two frontends drift**                       | If the port stalls mid-way, `/mockup` and the real pages both exist and diverge.                                                                                                                                                       | Move page by page and delete each mockup route as its real counterpart lands. Don't leave a half-ported domain.                                                                     |
| **Time source / hydration**                   | `lib/mock/format.ts:15` pins `MOCK_NOW`, and mockup pages are forbidden from calling `new Date()` in render. Real data means real clocks → **hydration mismatch risk**, which this repo has already hit once (`docs/demo.md:157-167`). | Use explicit locale + a single server-provided timestamp; never `new Date()` / unlocalized `toLocale*` in render. (One such call was found and fixed in `components/ui/chart.tsx`.) |
| **Null → 0 regression**                       | See §2 rule 1.                                                                                                                                                                                                                         | Assert it in tests per domain; the demo spine already does for item analysis.                                                                                                       |
| **`QuizAttempt.kind` blocks student quizzes** | Cannot render GRADED vs PRACTICE without a decision.                                                                                                                                                                                   | Resolve §4 item 1 before starting `student/quizzes`.                                                                                                                                |
| **Two Wave 1 rows were wrong**                | `teacher/classes` is a different screen (offering admin vs roster), and `teacher/submissions` has no real page at all. Both were decisions, not oversights.                                                                            | **RESOLVED and shipped** — [`wave-1.md`](./wave-1.md) §D1 and §D2. Kept for the record.                                                                                             |
| **Similarity unique constraint**              | `SimilarityCheck`'s dedupe key has two nullable columns; in Postgres NULL makes unique rows non-conflicting, so duplicate pairs can insert.                                                                                            | Confirm before surfacing `MOCK_SIMILARITY` for real.                                                                                                                                |
| **Missing index**                             | `Assessment` is filtered by `createdById` (`lib/gradebook-db.ts:170`) with no index on that column.                                                                                                                                    | Add when the port touches that query path.                                                                                                                                          |
| **Docker required**                           | Code execution shells out to `docker run` (`lib/code-eval/executor.ts`); 2 tests self-skip without it.                                                                                                                                 | Expected, not a blocker — but code-submission pages need Docker to demo.                                                                                                            |
| **LTI is external**                           | No real AGS call without platform registration + egress.                                                                                                                                                                               | Keep the dry-run; don't promise live LTI.                                                                                                                                           |
| **"Missing reader" is not "missing model"**   | Materials/calendar have models, so this looks easier than it is — the query + derivation is the work.                                                                                                                                  | Budget Wave 2 properly.                                                                                                                                                             |

---

## 7. Verification

Per wave, all must hold:

1. `npm run verify` exits 0.
2. `npm test` — 390 passing today; **no regressions**. New mapping helpers get unit tests that
   need no database.
3. `tests/demo-spine.test.ts` still passes — it is the proof that grading, publishing, and the
   published-only export invariant survive the port.
4. **Real-browser check in both themes** at 390 / 768 / 1440 px, with a screenshot. Static checks
   missed real defects on this project twice; the browser is mandatory, not optional.
5. The specific null-vs-zero edge cases render `—`, not `0`.
6. CI green on `dev`.

---

## 8. Definition of done

- Every Wave 1–4 real page renders the mockup design with real data, behind real auth.
- `lib/mock/*` is reduced to test fixtures, or deleted.
- The `/mockup` tree is deleted (or explicitly kept as a tagged design reference).
- `docs/ui/design-system.md` describes the shipped state, not the static phase.
- `docs/README.md` "Known gaps" reflects reality.
- No page renders a number that nothing derives.

---

## 9. Explicitly out of scope

- Redesigning anything. The design is settled; this plan only connects it.
- Fixing the deferred P1 client-fetch-on-mount for its own sake (though a ported page should not
  add new instances of it).
- The calibration / grading-agreement report (deferred separately).
- Live LTI/AGS, which needs an external platform registration.
- A notification system, feature flags, and institution settings — unless promoted out of §4.

---

## 10. Recommended first step

Wave 0 (shell adoption + mapping helpers + doc amendment), then **`teacher/reviews`** as the
pilot: its endpoint, its decision endpoint, and its invariants are the best-tested area in the
repo (`tests/demo-spine.test.ts:196-323`), and it is the flagship screen of the product. If the
port pattern works there, it works everywhere; if the pattern is wrong, we learn it on the one
page where the correctness bar is unambiguous.
