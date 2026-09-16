# Wave 4 — admin

Status: **Wave 4 complete (A1–A4, plus the close-out in §6–§9).** The definition of done in
[`mockup-to-backend.md`](./mockup-to-backend.md) §8 is satisfied: every real page renders behind
auth, `lib/mock` is scoped to the design-reference tree by an enforced test, and that tree is kept and
tagged `design-reference-v1`. What remains is the decisions listed in §6–§9, not unfinished slices.

The last wave before the decision list. Follows [Wave 3](./wave-3.md).

Admin is **structurally different** from the other three waves, and the difference changes the work:
there are no admin API routes, and the real admin pages read Prisma **directly in Server Components**
through `lib/admin-db.ts`. So a port here needs no routes, no contracts and no clients — it needs
readers and the shared shell.

---

## 1. Scope, and a third shell to retire

Five real admin pages exist and all five render through **`AdminPageShell`** — a bespoke third shell
that predates the design system:

| Real page         | `lib/admin-db.ts` reader       | State                       |
| ----------------- | ------------------------------ | --------------------------- |
| `admin` (index)   | `getAdminOverview`             | renders, with inline tables |
| `admin/data`      | `toPlainRows` + inline queries | renders                     |
| `admin/offerings` | `getAdminOfferingsList`        | renders                     |
| `admin/tools`     | `AdminToolsPanel`              | renders                     |
| `admin/users`     | `getAdminUsersList`            | renders                     |

`AdminPageShell` renders its own `<main>`, its own heading block and its own `AdminRoutesMenu`
sidebar. `AppShell` already supports `role="admin"` (`MockupRole` includes it), so replacing it is a
**deletion**, not a rewrite — one shell instead of three, and the admin nav comes from
`nav-config.ts` like every other role.

## 2. A real defect to fix on the way

Two admin pages format dates with an implicit locale, which is the hydration hazard this codebase
has already fixed three times (`chart.tsx`, `student-quiz-attempts`, `teacher/observability`):

- `app/(dashboard)/admin/users/page.tsx:35` — `new Date(user.createdAt).toLocaleString()`
- `app/(dashboard)/admin/page.tsx:144` — `new Date(assessment.dueDate).toLocaleDateString()`

Both read the _runtime's_ locale and time zone, so the server and the browser can disagree about the
same row. `lib/format.ts` already provides explicit-locale helpers; the fix is to use them. This is
the same class of bug as the one fixed in S9, and it is worth doing regardless of the shell work —
which is why it is its own slice rather than a footnote.

## 3. What the mockups ask for that has no model

`docs/plans/mockup-to-backend.md` §4 named these, and Wave 4 is where they come due. Each is a
**decision**, not a port:

| Mockup surface                               | Reality                                       | Verdict                                                                                                                                 |
| -------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `AdminDataset` (retention, rowCount, source) | no model                                      | **Read-only view over real tables**, not a new entity — the data explorer already does this                                             |
| `AdminTool` run history                      | no model                                      | **Drop the history**, keep the actions. A run log needs a model, and "which maintenance actions ran" is not a question anyone has asked |
| `FeatureFlag`                                | no model, and no settings surface exists      | **Drop**                                                                                                                                |
| Institution settings (`admin/settings`)      | no model, and `navHref` returns `null` for it | **Drop** — no real page, by the plan's own mapping                                                                                      |
| `admin/profile`                              | no model, `navHref` returns `null`            | **Drop**                                                                                                                                |

So Wave 4's mockup ports are **narrower than the mockups suggest**: three of the seven admin mockup
routes have no real page by design, and two of the remaining surfaces need a model that nothing has
asked for. What is left is real and worth doing — the shell, the readers, and the locale fix.

## 4. Slices

| Slice  | Content                                                                                                       | Depends on |
| ------ | ------------------------------------------------------------------------------------------------------------- | ---------- |
| **A1** | The two implicit-locale fixes, as a standalone defect fix                                                     | —          |
| **A2** | Retire `AdminPageShell`; the five pages onto `AppShell` + `PageHeader`                                        | —          |
| **A3** | `admin/users` and `admin/offerings` through the shared `DataTable` primitive, so they match every other table | A2         |
| **A4** | **No work needed — recorded, not forced.** See below                                                          | —          |
| **A5** | Record the four dropped mockup surfaces with their reasons                                                    | —          |

A1 comes first because it is a defect rather than a port, and it is small. A2 is the bulk of the
value: it removes a shell, which is the kind of duplication that produced the drift Wave 1 spent its
time fixing.

### A4: why two pages keep their own markup

`admin/page` renders **zero** tables — it is a card-and-list dashboard, so `DataTable` has nothing
to replace.

`AdminDatasetsView` does render a `<table>`, and it **should keep it.** Its columns are derived
from the data (`Record<string, unknown>` rows, headers taken from the keys), because a
schema-agnostic browser cannot know its columns at compile time. `DataTable` takes `Column<T>[]`
with fixed ids by design — that is what gives every other table a stable `getRowId` and responsive
column hiding — so it cannot express a dynamic column set. Converting would mean loosening
`DataTable` for one caller, which is the wrong direction: the constraint is load-bearing for nine
other pages.

Recorded rather than forced.

## 5. What this wave must not do

- **Invent a model to fill a mockup.** `FeatureFlag` and `AdminTool` history are dropped rather than
  built, for the same reason `completionPercent` was dropped in Wave 3: a table nothing writes is a
  table that lies.
- **Add admin API routes.** Admin reads Prisma in Server Components here, and that is deliberate —
  it is why this wave needs no contracts. Introducing routes for consistency would add a layer whose
  only purpose is symmetry.
- **Touch the two dev-tool route handlers** (`retention/purge`, offering rebalance). They work and
  are tested; a port must not replace them.

## 6. The close-out: the mock layer, the docs, and the last underived number

`A1`–`A4` finished the admin ports and `§3` recorded the dropped surfaces. What remained was the
**endgame** in `docs/plans/mockup-to-backend.md` §8 — the conditions under which the port is actually
finished. Landed in `e1a69ab`.

### The tree is kept, so the dependency had to be severed

§8 allowed deleting `/mockup` **or** keeping it as a tagged design reference. It is **kept**: its 38
routes each document their own build guide, which is design-process evidence worth retaining, and the
tree is operationally inert (outside `proxy.ts`, outside the real navigation).

That choice created the wave's last real problem. `lib/mock` was **load-bearing for the app**, so the
reference tree and the product were not separable:

| Dependency                                                    | What it actually was                                                                 | Resolution                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------ |
| 9 unions into `lib/labels.ts`                                 | value-identical duplicates of Prisma enums (`AssessmentType`, `SubmissionStatus`, …) | use the generated enums              |
| 2 unions into `lib/teacher-submissions.ts`                    | the same                                                                             | use the generated enums              |
| `MockupRole` into `components/shell/nav-config.ts`            | a navigation concept — it decides which nav sections exist                           | define it there                      |
| `MOCK_NOTIFICATIONS` / `MOCK_CURRENT_USER` into `top-bar.tsx` | fixture **values** in a shell component the real app renders                         | pass as props from the mockup layout |

The value-identity of all eleven unions was verified before the swap, because a mismatch would make a
label-map lookup return `undefined` and render a raw enum. The timestamp formatting moved to
`app/mockup/layout.tsx` too: `formatRelativeTime` is anchored to the mockup's fixed `MOCK_NOW`, so the
mock clock is the mockup's to apply and app scope must not inherit one.

`tests/mock-layer-scope.test.ts` enforces the result **at the source level**, since a helper test
cannot catch an import. It matches every way a module can reach another (static, `export … from`,
side-effect, dynamic `import()`, `require()`) and normalises alias and relative specifiers, so
`../../lib/mock` and `~/lib/mock` are caught while `@/lib/mockup-*` and `some-lib/mock` are not. It was
mutation-tested against all twelve forms: ten caught, two correctly ignored. It deliberately does
**not** strip comments — a line-based `//` strip truncates at the first `//` inside a string literal
(a URL), which would hide an import sharing that line.

### Five more components were already dead

Completing the shell migration left the pre-design-system shell unreferenced: `role-page-shell`,
`dashboard`, `dashboard-header`, `role-routes-menu`, `future-page-placeholder`. `dashboard-header` was
the source of the stale "Teacher view" label that `/teacher` no longer renders. All five deleted, and
the guard asserts they stay gone.

### The last underived number

An audit of all 29 app-scope routes found exactly one violation of §8's "no page renders a number
that nothing derives": `components/teacher-view.tsx` coerced a null assessment average to `0`
(`assessmentAverage(...) ?? 0`), so an assessment with **no published marks** drew a `0%` bar
indistinguishable from a cohort that genuinely averaged zero — and the chart's screen-reader
description announced it as "0%". `assessmentAverage` returns `null` deliberately (the null-vs-zero
rule documented in `lib/teacher-roster.ts`), and both sibling charts preserve that null, so this was
an outlier. Unmarked assessments are now omitted from the series.

### Paths not taken

- **Deleting `/mockup` outright.** Allowed by §8, and rejected by the owner — the per-route build
  guides are the design-process record.
- **Having `gradeBandRanges` accept `BandOptions`.** The parameter was read into an unused local, so
  it could not change the output: boundary inclusivity is a property of the _comparison_, not of the
  boundary list. Removed rather than implemented; `relativeLetter` / `absoluteLetter` keep it.
- **A stricter `timeZone` sweep — since done (see §7).** Three app-scope formatters called
  `toLocaleDateString` / `toLocaleString` with an explicit locale but no `timeZone`, which can render
  a different day west of UTC. Flagged by the audit as an adjacent hazard in the same family as the
  implicit-locale defects A1 fixed.

## 7. Follow-up: one vocabulary for the assessment kind, and UTC everywhere

Two findings the audits raised were left open in §6 because neither was the underived-number class.
Both are now closed, in the same commit as the close-out.

### The assessment kind had four names, and one of them mislabelled real data

`lib/gradebook.ts` declared its own `AssessmentType = "Quiz" | "Assignment"`, **shadowing the Prisma
enum of the same name** with a different value set. `lib/student-assessments.ts` added a second copy
(`AssessmentKind`), and `lib/admin-db.ts` a third (`DbAssessmentType`).

The gradebook's copy was not merely redundant — the reader fed a five-value column into a two-value
type:

```ts
type DbAssessmentType = "QUIZ" | "ASSIGNMENT"

function toUiAssessmentType(type: DbAssessmentType) {
  return type === "QUIZ" ? "Quiz" : "Assignment"
}
```

The seed contains `QUIZ`, `DESCRIPTIVE`, `CODE` and `GROUP_PROJECT`. So a descriptive, code or group
assessment was labelled **"Assignment"** wherever the payload's type was rendered — the gradebook
table (`{a.courseName} · {a.type}`) and the submissions queue's badge — while
`teacher-submissions-table.tsx` labelled the _same data_ correctly from the Prisma enum. Two
vocabularies, one of them wrong.

The four `as DbAssessmentType` casts were the tell: they existed only to silence the mismatch between
a five-value column and a two-value type.

**Resolution:** the view types are gone. The read path carries the Prisma enum and labels it through
`ASSESSMENT_KIND_LABEL`; `lib/admin-db.ts` and `lib/student-assessments.ts` use the same enum.

The **create** path deliberately keeps the contract's vocabulary (`"Quiz" | "Assignment"`): it is
`createAssessmentRequestSchema`'s input, the form offers two kinds, and the server maps them to
`QUIZ`/`ASSIGNMENT`. Widening it so teachers can author descriptive/code/group assessments from the
gradebook is a **product decision**, not a defect fix, and is left open.

Verified in the rendered product, not just by type: the teacher gradebook now shows
`Algebra Foundations · Quiz`, `· Descriptive`, `· Group project` where it previously showed
`· Assignment` for three of those four.

### Every rendered date is now UTC

`lib/format.ts` documents the rule: every date is formatted with an explicit `timeZone`, because a
`toLocaleString` without one renders differently on a UTC server and a non-UTC browser. Three places
violated it, and two of those were **hand-rolled duplicates** of the shared helpers — the same
duplicate-vocabulary shape as the type above:

| Site                                                          | Problem                                                       | Resolution                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------- |
| `lib/gradebook.ts` `formatDate`                               | no `timeZone`; also a duplicate of `lib/format.ts`            | deleted; the three importers use the shared helper |
| `components/teacher-submissions-manager.tsx` `formatDateTime` | the same                                                      | deleted; imports the shared helper                 |
| `components/upcoming-events-panel.tsx`                        | three formats with no `timeZone` — and a deeper problem below | calendar model made UTC                            |

The calendar needed more than a `timeZone` argument. It read events (ISO **instants**) with the local
accessors (`getMonth`, `getDate`, `getDay`), so the initial month and the day grid resolved to the
_server's_ answer during SSR and the _browser's_ after hydration — a different month, west of UTC.
The whole model is now UTC (`getUTCMonth`, `setUTCDate`, `timeZone: "UTC"`), which is what makes the
SSR and client renders agree.

`tests/format-utc.test.ts` pins the rule, asserting both offset directions so it has teeth wherever it
runs rather than only passing because CI is UTC. Removing the `timeZone` options fails 4 of its 5
cases under `TZ=America/Los_Angeles`.

## 8. The CAT/FAT policy was a library, not a feature

An audit of the finished waves found the most consequential defect in the whole effort, and it was
a **documentation** defect as much as a code one.

`lib/grading/policy.ts` was imported by exactly one file: `tests/grading-policy.test.ts`. It was
not exported from `lib/grading/index.ts` and no page or route called it. Meanwhile `wave-3.md` §9
said the weights "belong on the offering (`CourseOffering.gradingConfig`)" — **a column that did
not exist** in `prisma/schema.prisma` or in any migration — and `docs/README.md` presented the
policy as shipped.

So three of the owner's requirements were not in the product at all: weights that persist, a way
for a teacher to define and edit them, and a minimum-CAT gate that applies to anybody. The rules
were implemented and tested; nothing called them.

### What was built

| Piece                                                            | Where                                                     |
| ---------------------------------------------------------------- | --------------------------------------------------------- |
| `CourseOffering.gradingConfig` (nullable JSON)                   | migration `20260917010000_offering_grading_config`        |
| The stored shape, validated and sum-checked                      | `lib/contracts/courses.ts`                                |
| Policy → weighted grade configuration, and the two failure modes | `lib/grading/offering-config.ts`                          |
| Per-student CAT progress and the FAT verdict                     | `lib/grading/offering-eligibility.ts`                     |
| Read/write with ownership, validation and an audit row           | `lib/grading/offering-config-service.ts`                  |
| `GET`/`PUT /api/teacher/offerings/[offeringId]/grading`          | `app/api/teacher/offerings/[offeringId]/grading/route.ts` |
| The teacher's editor, per offering                               | `components/offering-grading-policy.tsx`                  |
| The editor's pure logic, so it is testable                       | `lib/grading/policy-view.ts`                              |
| The export reads the stored policy                               | `lib/lms-export/service.ts`                               |

### Four decisions worth recording

1. **The policy is stored, not the membership.** Only the split, the chosen final assessment, and
   the gate are persisted; which assessments are CAT is derived from the offering's assessments at
   read time. Storing an `assessmentIds` list would hard-bind the configuration to the assessment
   set as it was when the teacher saved it, so adding an assessment afterwards would silently drop
   it from the weighted total — a data-loss shape with no error attached.

2. **The default is offered, not applied.** An offering with nothing stored keeps **equal
   weighting**, unchanged from before the column existed. Applying the default CAT 40 / FAT 60
   split automatically was the tempting reading of "let there be a default way to assign weights",
   and it is wrong here for the same reason the platform refuses to guess an exported letter: the
   FAT is identified by due date, so the default would silently put 60% of a course's weight on
   whichever assessment happens to fall due last. The editor prefills the default and the teacher
   confirms it. A malformed stored policy degrades to equal weighting too, not to the default.

3. **The gate is reported, not enforced.** The roster shows each student's CAT standing and
   verdict, and nothing refuses a FAT attempt. Enforcement would need the FAT's own delivery path
   to consult the policy, and refusing an attempt is a harder failure than refusing an export: get
   it wrong and a student cannot sit an exam they are entitled to. Recorded as the follow-up rather
   than half-built.

4. **The completion ratio counts only work that has fallen due.** This was a defect in the policy
   library itself, found by wiring it: the denominator included assessments still ahead on the
   calendar, so a course three weeks into its term reported `insufficient-cat-work` for the whole
   cohort — not because marking was behind, but because the term was not over. The gate could never
   reach a verdict until the final week. The ratio now answers "of the continuous assessment that
   has actually happened, how much is marked?"

### Two things the wiring exposed

- **A fixture gap.** Every demo assessment was future-dated, so the gate had nothing to judge and
  was therefore undemonstrable. The seed gained one past-due CAT assessment with published marks
  chosen to show **every** verdict: two clear the minimum, two fall below it (one with a genuine
  zero rather than missing work), and one has no mark at all. Created outside the assessment loop
  so it gets no upcoming calendar event — a deadline that has passed is not upcoming.
- **A widening defect.** `AssessmentRow.type` was `string` while the column is a five-value enum,
  which is why the policy's input type rejected the row. Typed as the enum.

### How the editor was verified

The editor was the one piece shipped without a test, because this repository deliberately has no DOM
environment (`vitest.config.mts` pins `environment: "node"`). Two things closed that:

1. **The logic was extracted to `lib/grading/policy-view.ts`** and tested — 29 cases, following the
   pattern the viewer pages already use (`lib/materials-view.ts`, `lib/planner-view.ts`, …). The
   component now holds only rendering and the fetch. Mutation-tested: sending a disabled gate's
   placeholder number instead of `null` fails 3 cases; loading a `null` gate as an enabled gate at
   zero fails 2.
2. **The render was confirmed in a real browser** — signed in as the teacher, both offerings, both
   callouts, the roster, and the disabled-gate interaction.

What the render confirmed, since a passing unit test cannot: the stored offering shows
`CAT 40% / FAT 60%` with the derived membership ("4 assessment(s) · Final: Linear models group
project (derived from due dates)"), the advisory note, and all five verdicts — including the em dash
for a student with nothing marked, which is the display half of the null-vs-zero rule. The
unconfigured offering shows **both** callouts ("No policy stored yet" and "Not enough assessments"),
which is the branch that stops a teacher assuming the displayed default is already in force.

Toggling the gate checkbox disabled the minimum-CAT field as intended, and **wrote nothing** —
confirmed by the audit trail still holding exactly one `offering.grading_config.updated` row, from an
earlier API test and not from the browser session. That is the Save button being the only write path,
checked rather than assumed.

### Not done, and deliberately

- **Enforcement at attempt time** (decision 3 above).
- **Widening the create contract** beyond `Quiz | Assignment`. Teachers can weight the kinds that
  exist; authoring descriptive/code/group assessments from the gradebook is a product decision.
- **A per-assessment `assessmentWeights` editor.** The stored policy supports equal weighting
  inside the CAT pool, which is what the owner asked for ("others depend on the frequency or
  weights"); pinning explicit per-assessment weights is expressible in the grade configuration and
  in the export request body, but has no editor.

## 9. The three follow-up items the audit left open

`wave-4.md` §6 recorded what the audits raised; the policy wiring closed the largest of them (§8).
These are the remaining three, all closed here.

### The `SimilarityCheck` unique key could not prevent duplicates — reproduced, then fixed

`docs/plans/mockup-to-backend.md` §6 had flagged this as needing confirmation before similarity was
surfaced for real, and it never was: the key was
`@@unique([assessmentId, codeTaskId, studentId, comparedStudentId])` with a **nullable**
`assessmentId`, and Postgres treats NULLs as distinct in a unique index.

**Confirmed by reproduction, not by reading.** Two identical rows for one student pair were inserted
successfully with `assessmentId` null — and a null there is reachable, because
`scanCohortSimilarityForTeacher` passes the value it was given. That matters because every reader
counts or ranks pairs: a duplicated pair is double-counted in the similarity view and can appear
twice in a teacher's queue.

The fix removes the possibility rather than arguing about it. `codeTaskId` is now **required** and
the key is `[codeTaskId, studentId, comparedStudentId]`, so **no nullable column remains in the
key** and uniqueness holds unconditionally. A similarity check with no code task has nothing to
compare, and the one writer always requires a task, so requiring it is the honest constraint.

`assessmentId` is kept as a denormalized convenience for the readers but removed from the key: it is
fully determined by `codeTaskId` (`CodeTask.assessmentId` is `@unique`), so it contributed nothing
to uniqueness and its nullability was what created the hole.

The migration (`20260917020000_similarity_check_unique_key`) has two destructive steps, both on a
**derived analysis table** whose rows are reproducible by re-running the scan: rows with a null
`codeTaskId` are deleted (no code path can produce one, and the column is becoming required), and
duplicate groups are collapsed to the most recently checked row. Both were **no-ops on this
repository's databases** (zero rows, zero duplicate groups) and are written to be safe on one where
they are not.

`tests/similarity-check-unique-key.test.ts` pins it against the database rather than the schema
text — a `@@unique` in `schema.prisma` only proves something once Postgres agrees, and the whole
point of this defect is that the two can disagree. It asserts the null case, the non-null case, that
a different code task and the reverse pair are still allowed, that `codeTaskId` is genuinely NOT
NULL, and that the old null-unsafe index is gone.

### `Assessment.createdById` was unindexed

§6 said to add it "when the port touches that query path"; the ports are done and the queries are
live. `lib/gradebook-db.ts` filters `Assessment` by `createdById` on every teacher page load, in
both the gradebook's assessment list and the calendar's event query, and the model's compound
indexes lead with `offeringId` and `courseId`, so neither can serve a creator-scoped filter. Added in
`20260917030000_assessment_creator_index` — purely additive.

### The letter question: one decision, and the code brought in line with it

Wave 3 §7.6 listed the surviving letter sites as "a product call, not a cleanup", and §2.1 recorded
them as a deliberate deferral — so the two sections disagreed and neither was a decision. Resolved
as follows.

**The mark-distribution histograms keep their letters, because they are labelled.** `cohort.ts` and
`legacy.ts` bin _marks_ on VIT's absolute Table-6 scale, and the analytics page carries a visible
note that a VIT letter is awarded for a course grand total and not for one assessment. A labelled
bin is an honest bin. That is the decision, and it is now recorded in the module docblocks rather
than left to be inferred.

**The unjustified per-mark helper is gone.** `courseLetter(pct)` applied _course_ bands to a single
assessment's mark — exactly the misuse the analytics note warns about — and its only consumer was
`GradeBadge`'s `showCourseLetter` prop, whose own docblock anticipated "the one call site that means
it". **No call site ever passed `true`.** Both the helper and the prop are removed, so a course
letter can no longer be produced for a bare percentage. The Table-6 bands they exercised are still
asserted against `absoluteLetter` in `analytics-grading-bands.test.ts`.

**Doc drift corrected with it.** Four claims had gone stale as the surrounding work landed:
`grading-bands.ts` said the absolute scale "feeds the exported final grade" (that letter was
removed) and called the regime choice "an open decision (`§3, D1`)" (D1 is resolved, and
`Course.category` exists); `gradebook.ts` said a `CourseCategory` field "the schema does not have"
(it does); `cohort.ts` and `legacy.ts` named a `letterGrade` function that no longer exists; and
`docs/features/analytics.md` gave the pass rate as `>= 60%` when the module uses VIT's **50** — the
code itself had already recorded that 60 was "a number that appears in no VIT document". Dated plan
sections (`wave-3.md` §3, §7.6) are left as written, because a plan is a record of what was decided
at the time.

## 10. The two dashboard designs, ported

§6 recorded that the teacher and student dashboards were the one composition gap with no recorded verdict:
both were real, data-backed pages, but they were still the legacy gradebook views and **none** of the
mockup's sections were present. They are ported here, which closes the last screen-level gap between
`/mockup` and the real app.

**This was a presentation port, not new backend work.** All nine readers the two dashboards need already
existed, so the work was composition plus the derivability pass.

### The collision that had to be resolved first

The mockup's teacher dashboard has no marks grid. The real one did — `GradebookTable`, editing inline
through `POST /api/gradebook/marks`, and it was **the only inline mark-entry UI in the app** (its sole
consumer was `teacher-view.tsx`; `gradebook-provider.tsx` is the only client of that route). Porting the
mockup composition unchanged would therefore have deleted a capability. The mockup, being a static
design, could never show this.

Resolved by **moving the grid to its own page** (`/teacher/marks`, an `appOnly` nav entry in the Grading
section) rather than losing it. Moving it also turned out to be right for a second reason the mockup
could not express: a mark-entry grid belongs beside the other grading surfaces, not on a dashboard whose
job is "what needs a decision today".

`tests/nav-scope.test.ts` asserted a hard-coded app-nav count, so a second `appOnly` item broke it. It
now derives the app-only count from `NAV_SECTIONS`, which makes the next such item a nav-only change.

### What was dropped, and why

Every drop is the derivability rule, not a preference:

| Element                                                          | Why it cannot be rendered                                                                                                                                                                                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All four teacher KPI sparklines, and the student's two           | 6-week history is not stored. Drawing them would be fabrication.                                                                                                                                                                                        |
| The KPI `delta` on both dashboards                               | No prior-week value exists.                                                                                                                                                                                                                             |
| "Against the term target" (cohort trend)                         | `CohortTrend` carries **no target**. The section shows the series and `markedCount` instead.                                                                                                                                                            |
| `weightPercent` (assessment progress)                            | No column.                                                                                                                                                                                                                                              |
| The review table's assessment-kind line                          | `reviewQueueItemSchema` has no assessment `type`.                                                                                                                                                                                                       |
| Peer-evaluation "Round closes"                                   | The real workspace returns no milestone or due date. "Round status" is kept; "Self-evaluation" and "Results" were added because the workspace genuinely returns them.                                                                                   |
| The mockup's "New assessment" / "Publish results" header actions | "Publish results" is inert in the mockup (no handler), so porting it would build a dead control. "New assessment" writes through the gradebook provider, which would not refresh this server-rendered page — the created row would silently not appear. |

Three further substitutions were forced and are documented in code: the review row's "why it is here"
uses the real `flags` array; its "Confidence" column shows the **lowest** per-criterion confidence
(there is no single row-level value, and the minimum is what explains the row); and relative due labels
are derived from the reader's `daysUntilDue` because `formatDueLabel` is anchored to the mockup's frozen
clock and deliberately absent from `lib/format`.

### The number this surfaced, which is a scoring defect

The teacher dashboard's "Cohort average" tile reads **12%** for the demo offering. It was checked
against the database rather than assumed, and the arithmetic is right: the three graded quiz attempts
scored 4/20, 2/20 and 1/20. What is wrong is the data underneath, and the cause is a product defect,
not the dashboard:

- `lib/quiz-generation/generation.ts` persists **every generated question with `points: 1`**, with no
  relation to the assessment's `maxMarks`.
- Scoring divides the earned total by a `maxScore` taken from `Assessment.maxMarks`
  (`lib/quiz-grading.ts` passes it explicitly, and a seeded attempt stores `maxScore: 20`).

So a 4-question quiz on a 20-mark assessment has a ceiling of 4 earned against a denominator of 20: **a
perfect attempt scores 20%**. The demo's own student answered all four correctly and is shown at 20%,
while the manual `Grade` for the same assessment says 20/20. Two subsystems disagree about one student,
and the two dashboards read different ones — which is why the student's old dashboard said 90% and the
teacher's new one says 12%.

This is recorded rather than fixed: which side is canonical (question points, or the assessment's
maxMarks) changes what a percentage means for every quiz, mark and export, so it is a decision and not a
cleanup.
