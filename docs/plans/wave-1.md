# Wave 1 — per-page port dossiers

Status: **research complete. Slices 1 (`teacher/submissions`, D2) and 2 (the auth re-skin) have shipped.** — see §D2.
Written against `dev` @ `a177868` (Wave 0 landed). Companion to
[`mockup-to-backend.md`](./mockup-to-backend.md), which this document corrects in two places.

Three read-only research passes produced field-by-field dossiers for all twelve Wave 1 pages
(grading/rubrics, code-eval/groups, student-learning/auth). This consolidates them into an
execution plan: what is ready, what each page actually needs, and the decisions that block it.

---

## 1. Corrections to the Wave 1 plan

The parent plan's Wave 1 table is wrong on two rows, and overstates one constraint. Recording
them here rather than silently fixing the table, because both were load-bearing.

### 1.1 `teacher/classes` is not a presentation port — it is a different screen

The plan lists it as "backend already complete, pure presentation port". It is not. The two pages
show **different nouns**:

|                | Real page                                                                                               | Mockup                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Primary object | Course **offering**                                                                                     | Student **roster**                                        |
| Body           | `TeacherClassesManager`                                                                                 | `DataTable<Student>`                                      |
| Content        | capacity, registration windows, publish-results (`resultsPublishedAt` — the **retention anchor**), Save | student, group, average, submitted, last active, standing |

The real page's behaviour is not decoration. `POST /api/teacher/offerings/[offeringId]/results`
sets `CourseOffering.resultsPublishedAt`, which is the clock the retention purge reads. **The
mockup design has no place for it.** Porting the mockup over this route would delete working,
tested functionality.

`docs/plans/mockup-to-backend.md` §3 Wave 1 should drop this row into a new "needs a decision"
group. See §4 decision D1.

### 1.2 `teacher/submissions` has no real page at all

The plan's table lists it as if it had backing. It does not — Wave 0 already encoded this
(`nav-config.ts` maps `/mockup/teacher/submissions` to `null`, because the real submissions UI is a
component _inside_ the assignments page). Porting it therefore means **creating a route**, which
reverses a Wave 0 invariant:

- `tests/nav-scope.test.ts` asserts `navHref("/mockup/teacher/submissions", "app") === null`
- and asserts the teacher app nav is exactly `mockupCount - 3`

Both must change (`-3` → `-2`, and the href moves out of the orphan list). That is expected and is
the right place to update, but it is not a "no backend work" row.

### 1.3 The "no name" constraint is narrower than I stated

When summarising Wave 0 I wrote that _"the app cannot show a person's name at all."_ That was
wrong, and it matters for these dossiers. Verified:

- `User` has only `id` / `email` (`prisma/schema.prisma:39-48`) — **the signed-in account** genuinely
  has no name. The design system and the code comments say exactly this, and they are accurate.
- `StudentProfile.fullName` (`:53`) and `StaffProfile.fullName` (`:86`) **exist** and are already
  selected by the real queries (`lib/gradebook-db.ts:205`, `lib/course-ratings.ts:124`).

So every roster, submission and rating table in these dossiers **can** show a real person's name.
Only the shell's own account label is limited to the email, which Wave 0 already handles via
`lib/user-identity.ts`. The practical consequence is the opposite of what I implied: none of the
Wave 1 pages is blocked on a name column.

---

## 2. Cross-cutting prerequisites

Do these before or alongside the first port; each is small and unblocks several pages.

| #   | Prerequisite                                                              | Why                                                                                                                                                                                                                                                                                                                  | Detail                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | **Move `app/mockup/teacher/_lib/labels.ts` into `lib/`**                  | Eighteen exported mappings (`ASSESSMENT_KIND_LABEL`, `SUBMISSION_STATE_TO_STATUS`, `TEST_RUN_STATE_TO_STATUS`, `MILESTONE_STATE_TO_STATUS`, `AUTO_ACCEPT_CONFIDENCE_FLOOR`, …) live in a tree the plan schedules for **deletion**. A real page that imports them inherits a dangling dependency.                     | No real page currently imports the mockup tree (verified — the only matches are comments in `theme-toggle.tsx`). Move them now, while nothing depends on either location. |
| P2  | **Extract the query from the route handler where one exists only inline** | `student/assessments` and `student/courses` have their Prisma query trapped inside `export async function GET()`, and the **only** consumer is a client `useEffect`. Without extraction, a server-rendered port cannot reuse the query, and the page would be forced into a new client fetch — which §8.3.1 forbids. | Mirror `listStudentQuizzes` (`lib/quiz-attempts/service.ts:255`). This also gives two currently-untested read paths a unit-testable surface.                              |
| P3  | **Agree the per-page shape before writing**                               | Several mockups are read-only reports while the real page is an editor (rubrics, peer-evaluation, code-submissions), or vice versa. "Replace the component" would silently delete a working write path.                                                                                                              | Each dossier names the specific affordance at risk. See §4.                                                                                                               |

---

## 3. Readiness by page

Twelve pages. "Backend" = does the read path exist and is it tested.

| Page                          | Backend                                                       | Shape                                                    | Risk       | Verdict                                                                                        |
| ----------------------------- | ------------------------------------------------------------- | -------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------- |
| `student/peer-evaluation`     | Complete, tested                                              | Mockup read-only, real is a **form**                     | Low        | **Merge** — keep the form, add the reporting cards; use the server's 3-rater threshold (D5)    |
| `student/quizzes`             | Complete, tested                                              | Rebuild presentation                                     | Low        | **Best-backed.** Sitting renders from the read-only retake (D4); no persisted practice attempt |
| `teacher/reports`             | Ratings half complete + tested; report-card half **no query** | Re-skin + new work                                       | Low/Med    | **Ship the ratings half first**; drop "At risk" and "Completion" (D3)                          |
| `teacher/rubrics`             | Complete; `listRubricsForTeacher` **untested**                | Mockup read-only vs real **editor**                      | Low        | Add a read-only summary panel; render weight as relative, no sum claim (D8)                    |
| `auth/login`, `auth/register` | Working, tested                                               | Pure re-skin                                             | **Lowest** | **SHIPPED** (`08ac76a`, fixes `46a4a58`)                                                       |
| `teacher/code-tasks`          | Complete, tested                                              | Real = list + client detail; mockup = single-task detail | Med        | Server-fetch the detail; keep mutations as a client island                                     |
| `student/code-submissions`    | Complete, tested                                              | Mockup read-only vs real **editor**                      | Med        | Merge, don't replace; one small contract extension                                             |
| `student/courses`             | Complete, **GET untested**                                    | Rebuild presentation                                     | Med        | Drop the Materials card (no reader); rating **distribution only** (D7) needs a new aggregate   |
| `teacher/groups`              | Complete, tested                                              | Rebuild presentation                                     | Med        | Keep all five queries; pair matrix becomes a reviewed contract addition (D6)                   |
| `student/assessments`         | Complete, **GET untested**                                    | Rebuild presentation                                     | Med        | Preserve the submission editor; expose `published`                                             |
| `teacher/classes`             | Complete, tested                                              | **Different screen**                                     | **High**   | **SHIPPED** (`a11c73c`, fixes `04f698b`)                                                       |
| `teacher/submissions`         | Data layer exists as a route only                             | **No page**                                              | **High**   | **SHIPPED** (`6069f08`, fixes `d293685`)                                                       |

---

## 4. Decisions, ranked

Each of these blocks at least one page. None is a coding question.

### D1 — Where does offering administration go? _(RESOLVED — option A)_

The route and the mockup only share a name. The real page administers **course offerings** —
`studentLimit`, `registrationOpenAt`/`CloseAt`, and a "Publish results" button per offering. The
mockup is a **student roster** (Student, Group, Average, Submitted, Last active, Standing). One is
course configuration, the other is the people in the course.

**Why it blocked rather than being a cosmetic choice:** "Publish results" sets
`CourseOffering.resultsPublishedAt`, which the schema calls _"Retention anchor. Null means results
not published, so no student work for this offering may be purged."_ It is the only way the retention
purge clock ever starts, it is **set once and cannot be un-set**, and the nav copy already promises
both halves ("Offerings, sections, and enrolled rosters"). Dropping the screen to fit the roster in
would leave the retention policy with no way to trigger it from the UI.

**Decision: A.** `/teacher/classes` becomes the roster; offering administration moves to a new
`/teacher/offerings` with its own nav item. Both survive, each on a page that names what it is. Cost:
one new route, one nav entry, and "Classes" loses the subtitle _"Manage enrollment limits and
registration windows"_.

#### What option A costs that the plan did not anticipate

**The nav model has no concept of an app-only page.** `NavItem` is `{ label, href, icon, description }`
and the nav is a single definition shared by both trees. `/teacher/offerings` would be the first page
that exists in the real app with **no mockup counterpart**, which breaks three things unless the model
is extended:

1. `tests/nav-scope.test.ts` asserts _every mockup nav href has a mockup page on disk_. A new item
   pointing at `/mockup/teacher/offerings` would fail it — correctly, since no such mockup exists.
2. `app/mockup/page.tsx:67` derives the index's "total pages" from `allNavItems().length`, which would
   be inflated by a page the mockup index cannot link to.
3. The teacher app-nav arithmetic in the same test (`mockup - 2`) changes again.

**The extension to make:** add `appOnly?: boolean` to `NavItem`, with the item's `href` set to the
**real** path (`/teacher/offerings`) rather than a mockup one. Then:

- `navSectionsFor(role, "mockup")` filters app-only items out, so no mockup page ever links to one;
- `navSectionsFor(role, "app")` keeps them, and `navHref` passes a non-`/mockup` href through
  unchanged — so it resolves with no override entry;
- `allNavItems()` excludes them, which matches its documented meaning (_"Every page in the mockup
  tree"_) and keeps the index count and the mockup-page assertion honest;
- the teacher app-nav assertion becomes `mockup - 2 + 1`, i.e. `mockup - 1`.

This is a genuine widening of the shared primitive, so it belongs in its own reviewed commit rather
than folded into a page port.

#### Two roster columns cannot be served

Per the dossier (§3.3), of the mockup's six columns:

| Column                             | Verdict                                                                                                                                                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Student, Group, Average, Submitted | **DERIVE** — roster and groups from existing reads; average from published marks (`studentAverage` already returns `null` for no marks, so the em-dash rule holds); submitted/missing needs one grouped `Submission` count |
| **Last active**                    | **GAP** — no activity or login timestamp exists on any model                                                                                                                                                               |
| **Standing**                       | **GAP** — real alerts are _offering-level_ (`lib/analytics/alerts.ts:36-38`), with no per-student flag and no column                                                                                                       |

Both are dropped from the ported roster rather than faked, per the plan's rule that no page renders a
number nothing derives. They can return when Wave 3 defines a per-student rule and a real activity
source.

The KPI row was replaced for the same reason. The mockup's "At risk" and "Course completion" have no
derivation (the second matches nothing at all), so the tiles now count what the table proves:
Enrolled, Groups formed, Not placed, Marked. On the seeded data every tile agrees with the table — 5
enrolled, 3 marked matching 3 averages and 2 em-dashes, 2 not placed matching 2 "Not placed" cells.

#### Shipped — both halves

Part 1 (`c9e53a0`): the `appOnly` nav flag, and `/teacher/offerings` rendering the existing
`TeacherClassesManager` unchanged. Offerings was also added to the **old** nav
(`components/role-routes-menu.tsx`), which the 22 unported pages still use, so the admin screen stays
reachable from both shells during the transition.

Part 2 (`a11c73c`): `/teacher/classes` is the roster, with a pure mapper under test and no client
fetch. `resolveTeacherStaffId` was consolidated into `lib/teacher-staff.ts` rather than becoming a
ninth copy.

### D2 — Does `teacher/submissions` become a real page? _(RESOLVED — option A)_

**Decision: yes, as a read-only queue.** `/teacher/submissions` becomes a browse-and-filter view
over the same rows; the grading editor (`components/teacher-submissions-manager.tsx`) **stays where
it works**, inside `/teacher/assignments`, and the queue's per-row action links into it. Nothing
moves on the write path, so `PUT /api/teacher/assessments/submissions` keeps its only client and the
partial-update guard (`tests/teacher-submissions-partial-update.test.ts` + the custom ESLint rule)
keeps covering it.

Known wart, accepted deliberately: submissions then appear in two places — browse on one page, grade
on another. Fixing that is an information-architecture change, not a presentation port, and deserves
its own reviewed commit. Revisit once the page exists.

Mechanical consequence: `tests/nav-scope.test.ts` must change. The href leaves the `null` orphan
list, and the teacher app nav goes from `mockupCount - 3` to `mockupCount - 2`.

**Slice plan (files):**

| File                                               | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/labels.ts`                                    | **New** — the canonical home. Moves `ASSESSMENT_KIND_LABEL`, `SUBMISSION_STATE_TO_STATUS` and their 16 siblings out of `app/mockup/teacher/_lib/labels.ts`, which becomes a re-export shim. This is prerequisite **P1**; a real page must not import from a tree scheduled for deletion.                                                                                                                                                                                            |
| `lib/teacher-submissions.ts`                       | **New** — `listSubmissionsForTeacher(user)`, plus a **pure** `toTeacherSubmissionRow(row)` so the projection is unit-testable without a database.                                                                                                                                                                                                                                                                                                                                   |
| `app/api/teacher/assessments/submissions/route.ts` | **Left untouched, deliberately.** It serves the inline editor and its shape diverges on purpose — it collapses the kind, and hides unpublished marks. The queue needs the opposite of both, so forcing one projection to serve both would bloat the row with fields the queue never renders. Two reads over one table, each for its own consumer; the duplicated ownership predicate (both filter on `offering.teacherId`) is the thing to watch, and unifying them is a follow-up. |
| `app/(dashboard)/teacher/submissions/page.tsx`     | **New** — guard, `AppShell scope="app"`, `PageHeader`, `force-dynamic`. Server-fetches; no client fetch.                                                                                                                                                                                                                                                                                                                                                                            |
| `components/teacher-submissions-table.tsx`         | **New** — KPI row + table, client component receiving rows as props (filters loaded rows locally, fetches nothing).                                                                                                                                                                                                                                                                                                                                                                 |
| `components/shell/nav-config.ts`                   | `/mockup/teacher/submissions` → `/teacher/submissions`; delete the orphan comment.                                                                                                                                                                                                                                                                                                                                                                                                  |
| `tests/nav-scope.test.ts`                          | `-3` → `-2`; drop the href from the null-assertion list.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `tests/teacher-submissions-mapping.test.ts`        | **New** — pure, no database. The GET read path has **no test today**; this is where it gets one.                                                                                                                                                                                                                                                                                                                                                                                    |

**Blocker found while building it — the filter bar. RESOLVED: extend it.** `FilterBar` was
documented as _"Inert by design — there is no state and no submit handler"_, so its search box and
four selects did nothing. Porting that onto a real page is the **dangling-affordance** problem
already fixed once in Wave 0 (the top-bar search was hidden in app scope for the same reason).
`FilterBar` now takes **opt-in controlled props** — `searchValue` / `onSearchChange`, and a
per-select `onValueChange` — with every control defaulting to the original inert behaviour, so the
13 mockup pages that render it are untouched. A control is therefore either inert or fully
controlled, never half-wired.

**The slice shipped.** Verified in the browser against the seeded demo data: 3 submissions, KPIs
reading Submitted 3 / Late 0 / Marked 1 / Marked, withheld 1, and a **withheld mark visible** — the
state the old route hid. Row kinds render truthfully (`Code`, `Descriptive`) instead of the route's
collapse to "Assignment". Typing a register number narrowed the table to one row and the count read
"1 submission" (singular), which is the plural fix doing its job. `verify` exit 0, 426 tests (up 10),
build 78/78, all 38 mockup routes still 200.

**Deliberate wart to revisit:** the KPI tiles describe the whole set, not the filtered view, matching
the mockup's behaviour. If the tiles should track the filters, that is a small change to the same
component.

### D3 — "At risk" has no per-student backing _(RESOLVED — keep it dropped)_

Real alerts are **offering-level** (`lib/analytics/alerts.ts:36-38`: class-average-below-threshold,
contribution-imbalance, pending-reviews). There is no per-student flag and no column.

**Decision: keep it dropped.** The classes roster already ships without it, and the reports page
takes the same treatment. A per-student rule would have to invent a threshold and choose between
marks, submissions and contribution as the signal — none of which the product has agreed — so
rendering one would be exactly the "number nothing derives" failure the plan forbids.

It returns in Wave 3 as a real feature if wanted: a definition, a threshold, and its own tests.

### D4 — `QuizAttempt.kind` (GRADED vs PRACTICE) _(RESOLVED — practice does not consume a graded attempt)_

**Decision: a practice attempt must not count against the attempt cap.**

Verified first, because the answer changes what has to be built:

- `QuizAttempt` has **no `kind` column** (`grep -c 'kind'` on the model → 0). The only thing distinguishing attempts today is `status`.
- The cap is **status**-based, not kind-based:
  `COUNTED_STATUSES = ["IN_PROGRESS", "SUBMITTED", "GRADED", "EXPIRED"]`, counted in three
  places in `lib/quiz-attempts/service.ts` (the summary, the eligibility gate, and the start path).
- The adaptive retake is **read-only**: it persists nothing.

So excluding practice **cannot be expressed by status alone** — "practice but counted" is
indistinguishable from "graded and counted" under that rule. Honouring the decision therefore has two
possible shapes, and the cheap one is the right one for Wave 1:

**Chosen: do not persist practice attempts.** Nothing is written, so nothing can be counted, and the
cap is correct by construction with the existing logic untouched. No migration, no new enum, and the
cap's safety properties (which `tests/quiz-attempts-eligibility.test.ts` and
`tests/quiz-attempts-adversarial.test.ts` pin) stay exactly as verified.

**Deferred, if practice should ever be a real persisted sitting** (resumable, with its own history):
that needs a `kind` column, and then `COUNTED_STATUSES` must become kind-aware — counting only
`kind = "GRADED"` rows — rather than being extended. It also needs `QuizAttempt.expiresAt` to actually
be written (it is currently never set) and a place to store per-question flags, neither of which
exists. That is Wave 3 work alongside the retake surface, not a presentation port, and it touches a
security-relevant control, so it wants its own reviewed change.

**Consequence for the port:** `student/quizzes` renders the sitting card from the **read-only retake**
data, and does not show a persisted practice attempt — the mockup's `QuizInProgressAttempt` shape
(`lib/mock/types.ts`, fields `kind`, `expiresAt`, `flaggedQuestionIds`, `timeSpentMs`) is not
servable today and is not faked.

### D5 — Peer-rating disclosure threshold: 2 or 3? _(blocks `student/peer-evaluation`)_

The mockup says **2** (`MIN_RESPONSES_TO_AGGREGATE = 2`, and its copy says "at least 2 teammates").
The server says **3** (`MIN_RATERS_FOR_DISCLOSURE`, `lib/groups/student-service.ts:32`), and
`tests/groups-peer-evaluation.test.ts` asserts 3. **The server wins** — the mockup number must not
be ported, and its copy must be regenerated from the server constant rather than hardcoded.

### D6 — May a teacher see the evaluator↔evaluatee pair matrix? _(RESOLVED — yes, for teachers)_

**Decision: teachers may see who rated whom.** Standard CATME practice: an instructor needs the pair
matrix to spot collusion and free-riding, and the anonymity promise is **student-to-student**, not
student-to-instructor.

This is a **contract addition, not an accident of the port**. `GroupAnalysisResponse` carries only
aggregates (`withoutSelf` / `withSelf` / `freeRiders` / `completion` / `contributionEvidence`), while
the raw `PeerEvaluation` rows are already read inside `getOfferingAnalysisForTeacher` and consumed by
`analyzeGroup` — so the work is serializing them, not querying them. It touches a confidentiality
surface, so it gets its own reviewed change rather than riding along with a page port.

Note the distinction the implementation must keep: the **teacher** payload gains the pair matrix; the
**student** payload must not (`tests/groups-peer-evaluation.test.ts` stringifies `received` to prove
it carries no rater identity — that assertion stays).

### D7 — May a student see peers' course ratings? _(RESOLVED — distribution only)_

**Decision: no names, no comments.** `student/courses` ports with the rating **distribution** and the
student's own rating, which is what `docs/features/course-ratings.md:88-89` already documents as
deliberate ("students see aggregate + own only"). Porting the mockup's peer table would have widened
an existing privacy decision by accident.

**Cost to note:** the mockup's distribution donut is fed by `MOCK_COURSE_RATINGS`, and the student
payload returns only `averageRating` plus the caller's own row — so the distribution needs a new
aggregate (counts per rating value) before that donut can render. Without it, the card shows the
average and the student's own rating only.

### D8 — Rubric weight unit _(RESOLVED — drop the sum claim)_

**Decision: drop "weights total 100%".** `RubricCriterion.weight` is `Float @default(1)` and
validation only requires positive, finite, ≤1000 — no unit is fixed and no sum is enforced, so the
mockup's validity claim would assert a rule the backend does not have.

The port renders weight as a **relative** number and drops the "100%" framing and the validity pill.
Enforcing a sum would need new validation plus a migration for existing rubrics; that is a real
option, but it is a schema decision under a presentation task, so it is not taken here.

### D9 — Smaller GAPs to drop or migrate

| Item                               | Pages                               | Recommendation                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CompletionPercent` (fixture `62`) | classes, reports, courses           | Drop — matches nothing derivable                                                                                                                                                                                                                                                                                                                     |
| `Last active` / `lastLoginAt`      | classes                             | **Drop — confirmed dead end.** Nothing records a login or activity time, and `AuditLog` is not a substitute: its actions are all domain events (`grade.published`, `code_test_case.created`, `course_offering.results_published`, …) with no login action, so the column cannot be derived from it either. Needs a real column before it can return. |
| `room` on `ClassRoom`              | courses                             | Drop, or migrate a column                                                                                                                                                                                                                                                                                                                            |
| `Notification`, `FeatureFlag`      | (already dropped in Wave 0's shell) | Keep dropped                                                                                                                                                                                                                                                                                                                                         |
| Search field                       | shell                               | Already hidden in app scope pending real search                                                                                                                                                                                                                                                                                                      |

---

## 5. Recommended slice order

Each slice is independently shippable and leaves the tree green.

1. **Slice 1 — auth re-skin.** `login` + `register`. The only purely presentational pair. Four
   mockup-only affordances must **not** be carried over: the login **role selector** (no backend,
   would let a user pick a workspace they have no account in), **forgot-password** (dead end),
   **remember-me** (no cookie parameter), and the register **"Full name"** field
   (`registerRequestSchema` accepts no name). Also: `MIN_PASSWORD_LENGTH = 12` is client-only today
   and the "Pending verification" state does not exist — the route signs the user in immediately.
2. **Slice 2 — `student/peer-evaluation`.** Merge, don't replace. Fixes D5 by using the server
   constant. Needs a small contract addition for per-teammate completion and `role`.
3. **Slice 3 — `student/quizzes`.** Best-backed data layer; needs the `getStudentAttempt` payload
   addition and a decision on D4.
4. **Slice 4 — `teacher/reports`** (ratings half). Straight re-skin that _fixes_ a fetch-on-mount.
5. **Slice 5 — `teacher/rubrics`** (read-only panel beside the editor).
6. Then code-eval, groups, and the two decision-gated pages once D1/D2 resolve.

---

## 6. Seed fixes needed before demoing

Two concrete gaps make ported pages render `—` against the demo seed. Both are cheap.

1. **`TestRun` evidence is the wrong shape.** `prisma/seed-demo.ts:661-672` writes
   `resultsJson: { cases: [{ name, passed }] }`, but `readRunEvidence` requires `record.results` to
   be a `TestResult[]` (`lib/code-eval/serialize.ts:31-48`). It therefore parses to `results: []`,
   `earnedPoints: 0`. The row also sets **no `finishedAt` and no `coverage`** — so Finished,
   Coverage, Diagnostics and per-test rows all render `—`, and a `PASSED` run reports "not finished".
   Fix: write `toRunEvidenceJson`-shaped evidence plus `finishedAt`/`coverage`.
2. **The peer-evaluation aggregate is never demonstrable.** `Team Alpha` has **3** members
   (`seed-demo.ts:689`), so each student receives **2** non-self ratings — below
   `MIN_RATERS_FOR_DISCLOSURE = 3`, so `received.withheld === true` always. The "how your teammates
   rated you" card cannot be shown without a 4+ member team.

---

## 7. Test impact

Reassuring, and verified: **no test renders any of these pages**, and no test imports their client
components. A presentation-only port cannot break the suite. The data layers are a different story:

- **Untested read paths:** `student/assessments` GET and `student/courses` GET have **no test at
  all**; `listRubricsForTeacher` has none. These are the pages where a port has no safety net —
  add a mapping unit test (no DB needed) with the port.
- **The end-to-end proof:** `tests/demo-spine.test.ts` covers grading, publishing, the
  published-only export invariant, and the answer-key invariant. Two assertions are hard
  constraints on any payload change:
  - a pre-submission payload must contain no `isCorrect` / `correctOptionId` / `rationale` / `explanation`;
  - item analysis withholds `difficultyIndex` below threshold.
- **Contract changes** (`studentCodeTaskSchema`, `rubricResponseSchema`, `courseRatingItemSchema`,
  `StudentPeerEvaluationGroup`) are invisible to most tests because several route-auth tests
  `vi.mock` the service — so re-run the full suite rather than trusting a green subset.
- **`tests/nav-scope.test.ts`** is the one test a page creation _should_ change (D2).

---

## 8. What the dossiers could not verify

Stated plainly, because each affects a decision above.

- Whether `AuditLog` records logins — decides whether "last active" can be derived or must be
  dropped (D9).
- Whether the demo seed's `Group`/`PeerEvaluation` rows are the only ones, i.e. whether a 4-member
  team is needed to demo the aggregate (§6.2) — the 3-member team is confirmed, the absence of any
  larger one is inferred.
- Whether `Grade.percentage` is populated anywhere; the student assessments route recomputes from
  points/maxPoints instead of reading it.
- Whether `RoleGuard`'s `cookies()` alone keeps `student/assessments` and `student/courses` dynamic
  in this Next version. Recommendation: declare `force-dynamic` explicitly when the port moves data
  server-side, matching every sibling page.
- Live rendering of any of these pages — all three dossiers are read-only analyses of code, not
  browser observations.
