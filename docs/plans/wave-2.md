# Wave 2 — readers that do not exist yet

Status: **plan, not started.** Written against `dev` @ `dfe1151` (Wave 1 complete). Companion to
[`wave-1.md`](./wave-1.md), whose scope table this document acts on.

Wave 1 was a **presentation port**: every page already had a working backend. **Wave 2 is not.**
The pages left over need code that does not exist, and the risk is in the query and the derivation
rather than in the composition.

---

## 1. Scope

**Wave 2 = the three "no reader at all" pages, plus an optional trailing re-skin.**

| Slice  | Content                                                     | Ships independently | Status                         |
| ------ | ----------------------------------------------------------- | ------------------- | ------------------------------ |
| **S1** | `lib/materials.ts` + pure mapper + tests. **No page.**      | yes                 | **landed** `86d5c8a`           |
| **S2** | **Seed: materials** — the 8 rows in §2.2, indexed for real  | yes                 | **landed** `b789540`           |
| **S3** | `student/resources` page                                    | yes                 | **landed** `0996858`           |
| **S4** | `lib/calendar.ts` + pure mapper + tests. **No page.**       | yes                 | **landed** (with S5, see note) |
| **S5** | **`Assessment` release**: migration, publish action, audit  | yes                 | **landed** `dadaf48`           |
| **S6** | **Seed: calendar** — the 10 rows in §2.3, with `releasedAt` | yes                 | **landed** `21c0561`           |
| **S7** | `student/events` page                                       | yes                 | **landed** `1161a3e`           |
| **S8** | `teacher/planner` page                                      | yes                 | **landed** `78e7a30`           |
| **S9** | `teacher/observability` re-skin (optional, droppable)       | yes                 | pending                        |

**S5 landed before S4**, which is the correction described below: the calendar reader
cannot be written correctly until release exists, because the student reader has to
exclude an un-released assessment's event while the teacher reader must show it.
Writing S4 first would have meant writing the filter against a column that did not
exist yet.

### Corrections to this plan found during implementation

Three things this plan specified turned out to be wrong or incomplete. They are
recorded here rather than quietly worked around.

1. **§3.1's central claim was false, and the code disagreed with its own comment.**
   The S1 reader was specified to "mirror the two-tier rule the retriever already
   uses". It did not: the retriever's second tier filtered on `courseId` alone, which
   is **not** a cohort boundary — a course has many offerings (sections, terms,
   years), so that filter matched material attached to _other offerings of the same
   course_. `lib/quiz-generation/retrieval.ts`'s own header said "materials with no
   offering", so the code contradicted its documentation. The practical effect: a
   student could be quizzed on a sibling offering's material — in the demo, the 2025
   revision handout — while that material was correctly hidden from their resources
   page. Masked in the demo only because that row has no chunks. Fixed by adding
   `courseWideOnly` to `SimilaritySearchOptions` and passing it from the retriever,
   so the retriever now matches both its comment and the reader. `tests/materials-read.test.ts`
   and `tests/quiz-generation-pipeline.test.ts` each gained a **same-course sibling
   offering** fixture, because the pre-existing cross-course tests could not catch
   this: they were rejected by the `courseId` filter before the tier in question was
   consulted.

2. **§2.2's chunk count for the VIDEO row was wrong (3).** It produces **4**, because
   its prose chunks naturally under `maxChars: 260`. Total is 15, which is what §2.2
   implies elsewhere. No test depends on the per-row number.

3. **§2.4's term requirement was not met by S2, and §2.4 conflicts with §5.3 about
   which slice owns it.** S6 fixed it: the offering is now a 15-instructional-week
   window containing today, and every due date is relative to the run. Doing so was
   not cosmetic — the seed delivers the quiz through the real attempt flow, and
   `lib/quiz-attempts/eligibility.ts` blocks a new attempt once `dueDate` has passed,
   so the old fixed dates would have made `prisma:seed:demo` **throw** once they
   expired. §5.3 was right about the ownership; §2.4 was the wrong place for it.

Two deliberate departures from this plan, both recorded in the code:

- The real view model is **`StudentMaterialView`**, not the `MaterialView` at
  `lib/mock/types.ts:555` that §3.1 points at. The mockup's type carries three fields
  no column backs, so reusing its name for a narrower type would mean same name,
  different fields across the tree. The mockup's own type is untouched.
- The planner's **`averagePercent` is dropped rather than derived** (§3.4 says
  DERIVE). A per-assessment average exists, but behind `getTeacherAnalyticsOverview`,
  which is scoped to one offering; the planner spans every offering, so reusing it
  means one call each and reimplementing it means a second implementation of a number
  the analytics page owns. Extracting the shared summary is the follow-up.

Two corrections to the slice order, recorded here rather than silently renumbered. **S4 is blocked
on S5**, not the other way round: the plan's §3.3 already says the calendar reader depends on the
release concept, because an unreleased assessment's event must be absent for a student and present
for its teacher. And **S5 changes the seed** (`releasedAt` must be populated on the assessments that
should be visible, alongside §2.3's ten rows), so S5 and S6 are coupled more tightly than "one
schema change, then one seed slice" implies. Neither correction changes the total work; both change
what can be verified in isolation, which is why they are written down.

The three pages are the only ones where a **reader must be written that does not exist**. The parent
plan warned about under-budgeting exactly this: _"'Missing reader' is not 'missing model' … budget
Wave 2 properly"_ (`mockup-to-backend.md:215`).

**S1 and S4 carry no page on purpose.** The risk here is the query and the derivation, not the JSX.
Proving the reader with a pure mapper test and a DB test before any page exists keeps the composition
slices trivially reviewable.

**S2 and S6 are seed slices, and they are not padding** — see §2.1. Without them the three pages render
monotonous data and every branch they contain goes untaken, which means unreviewed.

### Excluded, and why

| Excluded                              | Reason                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `teacher/analytics`, `student/retake` | **Their own wave, decision-first.** Six rendered numbers have no definition (§5, B1–B7). Code-first would bake in a guess — the failure the whole plan exists to prevent.                                                                                                                                                                                                       |
| `teacher/assignments`                 | **Not Wave-1-shaped.** `Assessment` has no `published`, no `weightPercent`, no `state`, no counts. Replacing `TeacherAssignmentsManager` would also delete the only client of `POST /api/teacher/assessments` and the quiz-JSON import — D2 over again. The cheap version (read-only table above the existing manager, Weight and Release dropped) is a _decision_, not a port. |
| `teacher/export`                      | **The mockup is not portable.** It is built on `ExportRow`, and there is no export-job model — only `LtiRegistration` + `LtiUserMapping`. The real page is a working, tested export with a different noun. Any port is an added section, never a replacement.                                                                                                                   |
| `teacher/quiz-generation`             | **Partially blocked.** Its mockup needs S1 (a materials panel) and Wave 3 (a Topics tab). The generate/publish path already works and must not be replaced. A follow-up mini-slice after S2 is viable.                                                                                                                                                                          |
| `teacher`, `student` (the dashboards) | Need **both** the `GradebookProvider` conversion and Wave 3 metrics. See §5, D1–D3.                                                                                                                                                                                                                                                                                             |
| Admin (5 routes)                      | Unchanged from the parent plan.                                                                                                                                                                                                                                                                                                                                                 |

---

## 2. What is in the database, and what the seed must become

This is the finding that decides whether these pages are demoable, and it is the **same class as the
three seed bugs Wave 1 found**: the data technically exists, so the page is not _empty_ — it is
_monotonous and misleading_, which is worse, because it demos as working.

Verified read-only against `assessment_ui`:

**Materials — 2 rows, 9 chunks.**

```
materials | no_source_url | kinds      chunks | embedding models
        2 |             2 |     2           9 |                1
```

Both rows have `sourceUrl = null` and `mimeType = "text/plain"`. No `LINK`, no `VIDEO`, no
zero-chunk row, no topic. So the ported page renders **two near-identical "No file attached" rows**.

**Calendar — 4 rows, all one kind.**

```
eventType  | count        total | no endAt | no description
ASSESSMENT |     4            4 |        4 |              4
```

No `CLASS`, no `HOLIDAY`, no `REMINDER` anywhere in the repo. Both calendar pages therefore render a
single-kind list with two em-dash columns, and the "Upcoming" timeline shows the same four rows as
the table beneath it.

**There is no way to create a `Material` at all.** No route under `app/api/**/material*`, no page, no
form. The only writer is `indexMaterial` (`lib/vector/embed.ts:110`), called from the seed and from
tests. Outside the demo seed, materials exist only inside tests.

**The embeddings provider is not a blocker.** `.env` sets neither `LLM_PROVIDER` nor
`EMBEDDINGS_PROVIDER`; both default to `mock` (`lib/llm/env.ts:42,87-94`), and the seed passes a mock
provider explicitly. It becomes a dependency only if a create/upload path indexes at request time.

**No test touches the three stub pages**, and no doc claims they work. A port has no safety net and no
stale claim to correct — the entire risk is in the new query.

### 2.1 The seed is part of the deliverable, not an afterthought

**Writing these rows properly is a Wave 2 task in its own right**, because without them S2, S5 and S6
cannot be demonstrated or meaningfully reviewed. This is not padding: **each row below exists to
exercise a branch that would otherwise be dead code.** A page whose every branch is never taken is a
page nobody has actually reviewed.

Enums, for reference: `MaterialKind` is `DOCUMENT | SLIDE_DECK | VIDEO | TRANSCRIPT | LINK | OTHER`;
`EventType` is `CLASS | ASSESSMENT | HOLIDAY | REMINDER`. `CalendarEvent` carries
`classId? offeringId? assessmentId? title description? eventType startAt endAt? isUpcoming`.

### 2.2 Materials — target 8 rows (currently 2)

Two offerings already exist (`demo-offering-active`, `demo-offering-past`), so both scopes are
reachable without adding one.

| #   | title                               | kind         | scope                                | `sourceUrl`     | chunks | the branch it exists to exercise                                                              |
| --- | ----------------------------------- | ------------ | ------------------------------------ | --------------- | ------ | --------------------------------------------------------------------------------------------- |
| 1   | Linear equations — lecture notes    | `DOCUMENT`   | active offering                      | `null`          | 5      | exists today. The **"no file attached"** case                                                 |
| 2   | Graphing and interpreting lines     | `SLIDE_DECK` | active offering                      | `null`          | 4      | exists today                                                                                  |
| 3   | Course syllabus and assessment plan | `DOCUMENT`   | **course-wide** (`offeringId: null`) | a URL           | 0      | the **course-wide branch** of the reader, a **real file link**, and an **unindexed** row      |
| 4   | Khan Academy — systems of equations | `LINK`       | **course-wide**                      | an external URL | 0      | the `LINK` kind: a resource with no file of our own                                           |
| 5   | Solving systems by substitution     | `VIDEO`      | active offering                      | a URL           | 3      | the `VIDEO` kind, **and indexed**                                                             |
| 6   | Lecture transcript — week 2         | `TRANSCRIPT` | active offering                      | `null`          | 2      | the `TRANSCRIPT` kind                                                                         |
| 7   | Practice set — slope and intercepts | `DOCUMENT`   | active offering                      | a URL           | 0      | a second linked-but-unindexed row, so "Not searchable yet" is not a one-off                   |
| 8   | Revision handout (2025)             | `DOCUMENT`   | **past offering**                    | `null`          | 0      | **cross-offering isolation** — a student enrolled only in the active offering must not see it |

**Chunks are produced the real way.** The seed calls `indexMaterial` for rows 1, 2, 5 and 6, and simply
does not for the rest. That is what makes "indexed" and "unindexed" genuine states rather than a column
someone sets by hand — and it exercises the retrieval pipeline at the same time.

Covers every `MaterialKind` worth showing except `OTHER`, which has no sensible demo meaning.

### 2.3 Calendar — target 10 rows (currently 4)

All four existing rows are in the future, so the "Upcoming" panel and the table below it render **the
same rows** — which means **a broken upcoming filter would be invisible.**

| #   | title                                     | `eventType`  | scope                     | `startAt`                | `endAt`        | `description`             | the branch it exists to exercise                                              |
| --- | ----------------------------------------- | ------------ | ------------------------- | ------------------------ | -------------- | ------------------------- | ----------------------------------------------------------------------------- |
| 1–4 | `Due: <assessment>` (the four that exist) | `ASSESSMENT` | active                    | the assessment due dates | `null`         | a real sentence           | keep, but give them descriptions                                              |
| 5   | Lecture — graphing linear functions       | `CLASS`      | active + class            | +3 days                  | +3 days + 90m  | "Bring the practice set." | the `CLASS` kind, **with an `endAt`**                                         |
| 6   | Lecture — solving systems                 | `CLASS`      | active + class            | +10 days                 | +10 days + 90m | `null`                    | a class **without** a description                                             |
| 7   | Mid-term break                            | `HOLIDAY`    | **no offering, no class** | +21 days                 | +28 days       | "No classes this week."   | the `HOLIDAY` kind, and the **no-location** case → renders `—`                |
| 8   | Quiz 1 closes this Friday                 | `REMINDER`   | active + class            | +5 days                  | `null`         | `null`                    | the `REMINDER` kind, **no `endAt`**                                           |
| 9   | Lecture — slope recap                     | `CLASS`      | active + class            | **−7 days**              | −7 days + 90m  | `null`                    | **a past event, `isUpcoming: false`** — so "Upcoming" visibly omits something |
| 10  | Revision session                          | `CLASS`      | **past offering**         | **−30 days**             | …              | `null`                    | **past, and a different offering** — calendar cross-offering isolation        |

**Rows 9 and 10 are the important ones.** Without a past event, "Upcoming" and "All events" are the
same list, and neither a test nor a reviewer can tell whether the filter works.

If **E2** resolves to "derive location as `classRoom.name`", rows 5, 6, 8 and 9 render a class while row
7 renders `—` — the em-dash rule demonstrated on live data rather than only in a mapper test.

### 2.4 What the seed must not do

- **Do not set `chunks` or `indexed` directly.** They are derived. Write through `indexMaterial`.
- **Do not set `isUpcoming: true` on past events.** Set it `false` on rows 9–10 — and note that nothing
  else in the repo maintains this flag, which is precisely why the reader must filter on `startAt` and
  not on it. The seed is where that gets documented by example.
- **Do not invent a `topic` or a `sizeLabel`** to fill the mockup's columns (decisions M1, M3).
- **Do not leave the offering as a ~50-week year.** B2 established that a "teaching week" is one of a
  semester's **15 instructional weeks**, and the current seed runs `2026-01-05 → 2026-12-18` with all
  assessments in November–December — so a weekly series would be empty for the first six weeks and
  meaningless everywhere. **Set `startsOn`/`endsOn` to a realistic 15-week term and move the assessment
  due dates inside it.** This is a seed requirement created by B2, not a preference.
- **Do not add a second offering just for this.** One active and one past already exist, which is
  exactly what cross-scope isolation needs.

### 2.5 Seed tests

The seed is now load-bearing, so it needs a guard — this is the lesson from Wave 1's three seed bugs,
all of which passed their own tests because the assertions only counted rows.

- `tests/demo-seed-shape.test.ts` — assert **legibility, not existence**:
  - every `MaterialKind` the pages render has at least one row;
  - at least one material is course-wide (`offeringId: null`) and at least one is offering-scoped;
  - at least one material has `sourceUrl: null` and at least one has a URL;
  - at least one has zero chunks (so the unindexed branch renders) and at least one has chunks;
  - every `EventType` has at least one row;
  - at least one event is in the past (so the upcoming filter is exercised) and at least one is future;
  - at least one event has `endAt: null` and at least one has an `endAt`;
  - at least one event has no `offeringId` and no `classId`.

---

## 3. The readers to build

### 3.1 `lib/materials.ts` (S1)

Nothing lists materials today. Only three modules touch the tables, none of them a reader:
`lib/vector/embed.ts:113` (write path), `lib/vector/search.ts` (raw pgvector over chunks, needs a query
string), `lib/quiz-generation/retrieval.ts:43` (topic search).

```
listMaterialsForStudent(user): Promise<MaterialView[]>
```

- Resolve `StudentProfile.id` by `userId` (pattern: `lib/quiz-attempts/authz.ts:18`).
- Active enrolments → `offeringId` and `offering.courseId`.
- Scope: `OR: [{ offeringId: { in: offeringIds } }, { offeringId: null, courseId: { in: courseIds } }]`.
  **This mirrors the two-tier rule the retriever already uses** (`lib/quiz-generation/retrieval.ts:44-53`),
  so the list and the retriever agree about what a student can be quizzed on. `Material.offeringId` is
  nullable and `courseId` is not, which is what makes the OR correct.
- Include `{ course: { select: { code: true } }, _count: { select: { chunks: true } } }`,
  `orderBy: { updatedAt: "desc" }`.

**No index and no schema change needed.** `@@index([offeringId])` serves the first branch and
`@@index([courseId, createdAt])` the second, because `courseId` is its leading column. Say this
explicitly in the slice so nobody adds a migration "just in case".

Field verdicts, `MaterialView` (`lib/mock/types.ts:555`):

| Field                                                               | Source                                            | Verdict                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------- |
| `title`, `kind`, `sourceUrl`, `mimeType`, `updatedAt`, `courseCode` | `Material` / `Course`                             | **EXISTS** (`MaterialKind`'s six names match the view union verbatim) |
| `chunks`, `indexed`                                                 | `_count.chunks`                                   | **DERIVE**                                                            |
| `topic`                                                             | no column; `metadata` empty on every row          | **BUILD or DROP** → decision M1                                       |
| `sizeLabel`                                                         | no stored file, so no size                        | **DROP**                                                              |
| `state`                                                             | no pipeline state; `indexMaterial` is synchronous | **DROP**, fold into `indexed`                                         |

The em-dash rule does **not** apply to chunks: `0` is a real, knowable fact, and the mockup already
says so ("Not searchable yet").

### 3.2 `Assessment` release (S5) — the one schema change in this wave

E1 resolved to **adding** the concept rather than rewriting the mockup's copy away, so this is the only
slice that touches the schema. It is ordered before the calendar reader because the reader depends on it.

**Why a column rather than a derivation.** The alternatives are worse: deriving "released" from "has a
published question" is wrong for four of the five assessment types (only quizzes carry
`Question.status`), and deriving from `Grade.publishedAt` answers a _per-student_ question, not a
per-assessment one. `Assessment.releasedAt DateTime?` is additive and nullable, so it needs no backfill
and no data migration.

**What to build**

|            |                                                                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration  | `Assessment.releasedAt DateTime?` — additive, nullable                                                                                             |
| Write path | an explicit teacher action, mirroring the shape of `POST /api/teacher/offerings/[offeringId]/results` (`requireRole("teacher")` + ownership check) |
| Audit      | one `AuditLog` row, consistent with every other publish-like action here                                                                           |
| Seed       | populate it on the assessments that should be visible — **or the student calendar renders empty**                                                  |
| Contract   | `released` on the calendar and planner projections only                                                                                            |

**The naming matters, and this is not pedantry.** The offering already has a _different_ publish:
`CourseOffering.resultsPublishedAt` is the **retention anchor** and starts the purge clock. That is
"results are out for the whole course"; this is "this assessment is visible to students". Different
facts, different granularity. The field is `releasedAt`, **not** `publishedAt`, so that a future reader
cannot wire the purge clock to the wrong column.

**Not on the student assessment payload.** That already answers "has _my mark_ been released" with
`hasMark`/`published` (Wave 1). This answers "is this assessment visible at all", which is a calendar
question.

**Tests:** authz on the publish action (401/403 before the service runs), the audit row exists, an
unreleased assessment's event is absent for a student and present for its teacher, and a released one is
visible to both.

### 3.3 `lib/calendar.ts` (S4) — shared by two pages

There **is** an existing `CalendarEvent` read, and reusing it would be a trap:
`lib/gradebook-db.ts:242-278` is a _dashboard_ projection — it filters `isUpcoming: true`, takes 100,
projects to a shape with **no `location` and no `courseCode`**, and **synthesises** assessment
due-date events for assessments with no calendar row. A calendar page needs its own query, or "the
calendar" silently means something different from what the mockup drew.

```
listStudentCalendar(user): Promise<CalendarEventView[]>   // offeringId IN (enrolled active)
listTeacherCalendar(user): Promise<CalendarEventView[]>   // owned offerings OR own assessments
```

- `orderBy: { startAt: "asc" }`, including `offering.course.code` and `classRoom.name`.
- **Do not filter on `isUpcoming`** for the table. It is a _stored_ boolean (`schema:279`), not derived
  from `startAt`, and the only writer in the repo is the seed. It can go stale. Use `startAt >= now`
  for the "Upcoming" panel only.
- The composite index is `(classId, offeringId)` — a query filtering **only** `offeringId` cannot use
  it efficiently, since `offeringId` is the trailing column and Postgres has no B-tree skip scan.
  **Do not add `@@index([offeringId, startAt])` in Wave 2**: it is a migration, and the honest trigger
  is an observed slow plan, not a hunch. Record it as the index that _would_ be needed.

Field verdicts, `CalendarEventView` (`lib/mock/types.ts:543`): everything **EXISTS** except
`location` (**DERIVE-as-className or DROP** → decision E2). `EventType`'s four names match the view
union verbatim, so no translation table is needed.

### 3.4 `teacher/planner` (S8) — plus an assessment-deadline query

Same calendar reader, plus a second query for the mockup's "Assessment deadlines" table.
`Assessment.dueDate` exists, and `lib/analytics/service.ts:403-420` is a working precedent for
scoping "assessments in my offering". Its columns fare worse:

| Field                    | Reality                                                                      |
| ------------------------ | ---------------------------------------------------------------------------- |
| `title`, `kind`, `dueAt` | **EXISTS** (`AssessmentType`'s five names match verbatim)                    |
| `averagePercent`         | **DERIVE** — already computed server-side (`lib/contracts/analytics.ts:203`) |
| `weightPercent`          | **no column** (already on the parent plan's decision list)                   |
| `published`              | **no release concept on `Assessment` at all** → decision E1                  |
| `state`, counts          | counts derivable; `state` has no backing                                     |

Two things that will be visible in the first render and are **decisions, not bugs**:

- **The "Add event" button has no write path.** No `POST /api/**/calendar` route exists. Per the
  Wave 1 dangling-affordance rule it must be removed or rendered disabled with an explanation, never
  left as a dead button. The mockup also embeds a second one in its `EmptyState`.
- **Every assessment is listed twice.** The seed creates one `CalendarEvent` per assessment titled
  `"Due: <title>"` with `startAt = dueDate` (`prisma/seed-demo.ts:442-451`), and the design has both
  an "All events" table and an "Assessment deadlines" table. One row per fact → decision E3.

### 3.5 `teacher/observability` (S9, droppable)

The **only** Group C row verified as a true Wave-1-shaped re-skin. The read path exists and is tested
(`getRecentGradeActivityForTeacher`, `lib/observability/audit-view.ts:70`). Two small additions:
`actorName` (a batched `StaffProfile`/`StudentProfile` lookup by `actorId`) and a `tone` map from
`action` — the latter already a lookup table in the page. The mockup's "Grading decisions" table needs
one new query over `Grade`, whose `source`, `overrideReason` and `publishedAt` all exist.

**Fold in a hydration fix while here:** the page calls `new Date(item.createdAt).toLocaleString()` in
render (`page.tsx:143`) — implicit locale and server timezone, the exact class this project has hit
before. Pass one server `generatedAt` and format explicitly.

---

## 4. Prerequisites, ranked

| #       | Prerequisite                                                       | Blocks                                                 |
| ------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| **P1**  | `lib/materials.ts` + mapper (S1)                                   | `student/resources`; later the quiz-ai materials panel |
| **P2**  | **Seed: materials (S2)** — §2.2                                    | any meaningful demo or review of S3                    |
| **P3**  | `lib/calendar.ts` + mapper (S4)                                    | both calendar pages                                    |
| **P4**  | **`Assessment` release (S5)** — migration + publish action + audit | S6, S7, and the student calendar's copy                |
| **P4b** | **Seed: calendar (S6)** — §2.3, with `releasedAt` populated        | any meaningful demo or review of S7/S8                 |
| ~~P5~~  | ~~Decision E1~~ — **RESOLVED**: add `Assessment.releasedAt`        | folded into S5                                         |
| **P5b** | Decisions E2 (location), E3 (duplicate rows)                       | S8                                                     |
| **P7**  | Decisions M1 (topic), M3 (drop `state`/`sizeLabel`)                | S3                                                     |
| ~~P8~~  | ~~Decision M2~~ — **RESOLVED**: list-only                          | makes S2 the reason S3 is demonstrable                 |

**Order:** P1 → P2 → S3 → P3 → S4 → **S5** → P4b → S6 → S7 → S8 → S9.

The seed slices sit **before** their pages deliberately: a page built against two monotonous rows
teaches nothing about whether its branches work, and the seed guard (`§2.5`) establishes the fixture
shape before anything renders it.

Note the shell swap (`getSessionUser` + `redirect` + `AppShell scope="app"` + `force-dynamic`) rides
along with each page. The app-scope nav already covers all three routes, so `tests/nav-scope.test.ts`
needs no change.

---

## 5. Decisions

**Resolved for Wave 2's shape:** M1 (drop topic), M2 (list-only), E1 (add `Assessment.releasedAt` — now
slice S5), E2 (derive location as `classRoom.name`), E3 (filter `ASSESSMENT` events out of "All events").

**Group B is settled now** rather than deferred, per the owner, so Wave 3 is not gated on an undefined
metric. It was researched rather than guessed — see §5.1.

### 5.1 The institutional convention, researched

The metrics below are not free inventions. VIT Vellore's academic regulations define a relative-grading
model, and the platform is built for that institution, so the natural definitions are the institution's
own. Source: [`Academic Regulations`](https://vit.ac.in/sites/default/files/academic/Academic-Regulations.pdf)
(§9.5, Table-5) and the [FAT process manual](https://vitonline.in/wp-content/uploads/2025/02/VIT-OL-Examinations-.pdf).

| Rule                          | Value                                                                                                                                                     |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Continuous assessment / final | **CAT 30% + FAT 70%** for theory; 60/40 for lab and project courses                                                                                       |
| CAT structure                 | Two CATs, 90 minutes, **50 marks each, scaled to 15**; CAT-II is open-book                                                                                |
| **What "class" means**        | A **unique combination of course-slot-faculty** — _not_ pooled across the branch or programme                                                             |
| Grade bands                   | `S` ≥ mean+1.5σ (with ≥90% min); `A` mean+0.5σ…+1.5σ; `B` mean−0.5σ…+0.5σ; `C` mean−1.0σ…−0.5σ; `D` mean−1.5σ…−1.0σ; `E` mean−2.0σ…−1.5σ; `F` < mean−2.0σ |
| Class average                 | the **midpoint of the `B` band**                                                                                                                          |
| Pass boundary                 | `F` band floor is `max(mean − 2σ, 50)` — if `mean − 2σ < 50`, **50 is used instead**                                                                      |
| Rounding                      | each grand total is **rounded up to the next integer** _before_ mean and σ are computed                                                                   |
| `S` cap                       | if the `S` boundary exceeds 100, the **top 3 or top 5%** of the class get `S`                                                                             |
| **Semester length**           | **15 instructional (non-exam) weeks**; an `L` lecture is 50 minutes per week                                                                              |

**One correction to the premise this was researched from.** The owner asked about VIT's "pooled average
system". The regulations are explicit that relative grading is **class-wise, not pooled across the
branch** — the class is a single course-slot-faculty combination, and pooling across it is precisely
what the system exists to avoid. Pooling _does_ happen, but between **components**: CAT-I, CAT-II and
digital assignments are pooled into one continuous-assessment mark, and that is pooled with the FAT into
a grand total. So "pooled" describes how a student's own marks combine, not how the cohort is defined.

**Mastery computation is standard elsewhere**, and agrees with the above: for a topic, mastery is
`sum(points earned on its items) ÷ sum(points possible) × 100` — **not** the average of per-assessment
percentages, which gives a different (and wrong) answer when item counts differ. Unattempted items must
either be excluded or counted as incorrect, and the same choice applied consistently. A threshold
(commonly 80%) is applied _after_ the percentage, not baked into it.

### 5.2 B1 — RESOLVED: cohort mastery, question-weighted, relative to the class

**Cohort mastery over the offering**, computed as points earned ÷ points possible across the
offering's finalised responses for that `Question.subtopic`, excluding unattempted items. This is the
recommended reading of "average in relation to the whole class or course offering", and it is
defensible on three counts: it matches the standard mastery formula above, it matches how the platform
already computes a class average (`classAveragePercentage` in `lib/student-assessments.ts` is
published-only across enrolled students, i.e. class-wise rather than cohort-pooled), and it is the same
shape VIT uses — one grand total per student, aggregated over the class.

- **Question-weighted, not student-weighted.** Averaging per-student percentages weights a student who
  answered two items the same as one who answered twenty. The two differ by double digits on seeded
  data, and the weighted form answers "how did the class do on this topic" rather than "how does the
  average student do".
- **The threshold reuses `CourseOffering.analyticsSettings`**, not a new constant — the same place the
  intervention and item-analysis thresholds already live, so a teacher configures them in one spot.
- **`null`, not `0`, below the threshold** — the mockup already renders two `null` roles for "below the
  reporting threshold", and the item-analysis guard already withholds `difficultyIndex` on small
  samples. Reuse that minimum.
- **A relative band is a Wave 3 follow-up, not Wave 2 work.** Because the institution grades on
  σ-bands, a teacher-facing "where does this class sit" view could later show the mastery mean against
  `mean ± kσ`. That needs the cohort's σ, which nothing computes today. Recorded, not built.

### 5.3 B2 — RESOLVED: a "teaching week" is one of the semester's instructional weeks

**The answer to "is a teaching week a real noun" is yes — it is defined by the institution.** VIT's
regulations specify a semester of **15 instructional (non-exam) weeks**, with a lecture of 50 minutes
per week. So `W1..W6` is the first six weeks of a term, and the mockup's deliberate `null` at W3 is a
week with no assessed work — which is a real thing in a 15-week term.

That makes the weekly bucket the right _axis_, and the reason the seeded data looked absurd is a
**seed defect, not a conceptual one**: the demo offering runs `2026-01-05 → 2026-12-18`, a ~50-week
year, while its assessments fall in November and December. Weeks 1–6 are therefore all empty and the
chart is meaningless.

**So:** bucket by calendar week from the offering's `startsOn`, `null` for weeks with no assessed work,
and **fix the seed's offering to a realistic 15-week term** whose assessments fall inside it (this
becomes part of S6). Two consequences to honour:

- The series length is **the term's**, not a fixed six — six points was the mockup's illustration.
- `startsOn`/`endsOn` are nullable, so a series needs a defined behaviour when they are missing:
  **render nothing rather than a wrong axis**, and say why.

### 5.4 B3 — RESOLVED: at-risk = below the institution's own pass boundary

**Define the rule, and define it as VIT defines failure**: a student is **at risk** when their grand
total falls below the pass boundary, `max(mean − 2σ, 50)`, computed over **published** marks only.

This is better than the three options the plan originally offered, because it is not invented: it is
the institution's own `F`/`E` line, with its own floor rule for high-averaging classes (where the
regulations explicitly award `E` and pass a student whose marks exceed 50 while sitting below the
band). It also means the alert and the grade sheet cannot disagree about who is failing.

Two boundaries that must hold:

- **Published marks only.** An unreleased mark is not a fact a student-facing or teacher-facing alert
  may act on, and Wave 1 already established that a class average is published-only.
- **The cohort is the offering's enrolled students** (the class-wise definition above), not a whole
  programme — which is what `CourseOffering` already models.

Consequence: this **re-opens Wave 1's D3**, which dropped a per-student at-risk rule because nothing
derived one. D3 was right at the time — there was no definition. There is one now, so the rule is
implementable; it belongs to Wave 3 alongside the rest of the analytics work, and the σ computation it
needs is the same one B1's relative band would use.

### 5.5 B4 and B5 — no decision needed

- **B4. `completionPercent`.** Matches nothing derivable (the parent plan recorded that 62 matches
  neither 58% nor 69%). **Drop it, consistently**, as Wave 1's D9 already did on three other pages.
- **B5. Median.** Derivable in one extra query over the same marks, and unlike the other tiles its
  definition is unambiguous — the mockup's own copy says why it matters ("less sensitive to a single
  weak script"). **Derive it.** It is also the honest companion to a mean-and-σ system: VIT grades on
  mean and σ, and a median next to the mean tells a teacher whether one paper is distorting the cohort.

### 5.6 B6 — RESOLVED: factual, not diagnostic

The retake reason is a **factual restatement** — "3 of 5 questions failed on Quiz 1" — never a
diagnosis like the mockup's "two sign errors on Q4". The platform can honestly count failures; it
cannot honestly characterise _why_ without asking a model, which would be a new feature with its own
explainability surface and review flow.

### 5.7 B7 — RESOLVED: teacher-defined retake policy, practice from a limited pool

Owner's answer, recorded as a **feature spec** rather than a UI decision, because it reopens Wave 1's D4:

- **Practice draws from a limited question set.** The questions **may or may not repeat** those in the
  original assessment — so practice is _not_ simply a re-run of the sitting.
- **The retake policy is the teacher's to set**, at minimum: a fixed number of retakes (e.g. **one**),
  or **retake only on approved request**.
- **"Practise" on a recommendation row therefore starts practice**, not a graded attempt.

**This reopens D4**, which decided practice attempts are _not persisted_ — on the grounds that the
attempt cap is status-based and therefore cannot distinguish practice from graded. That remains true,
so the feature needs the thing D4 deferred:

|                    |                                                                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `QuizAttempt.kind` | `GRADED \| PRACTICE`, and `COUNTED_STATUSES` becomes kind-aware (count only `GRADED`)                                                                                  |
| Retake policy      | a per-assessment setting — `maxAttempts` already exists and could cover the count; the **approval-gated** variant needs a request/approve record and a teacher surface |
| Practice pool      | a way to select which questions practice draws from, and whether they may overlap the assessment's                                                                     |
| Audit              | an approval decision is a teacher action on a student's record, so it wants an `AuditLog` row                                                                          |

That is a **Wave 3 slice, not Wave 2**, and it is now specified rather than open. It also means the
student retake page cannot ship as a pure port: the "Practise" affordance has no backing until this
lands.

### Materials

- **M1. RESOLVED — drop the Topic column and its filter.** A material has no topic; the _question_
  does, and retrieval searches content rather than a topic key. Adding a real `Material.topic` column
  is the honest long-term answer **if** topic becomes a product noun, but that is a schema decision
  that should not be taken inside a presentation port.
- **M2. RESOLVED — list-only.** The page is ported against the seeded rows, and the copy and docs say
  plainly that nothing creates a material yet. Creating one (an add/link form + route + contract +
  tests + the `indexMaterial` call) is a real feature, not a port, and adding a write path "while
  we're here" is precisely how D1 and D2 happened. **Consequence to accept:** the page is a demo of
  the reader, not a usable surface, and on a fresh database it renders empty. S2's seed work is what
  makes it demonstrable at all.
- **M3. Drop `state` and `sizeLabel`?** No pipeline state exists and there is no stored file.
  **Recommend drop both**, collapsing into the derived `indexed` boolean.

### Calendar

- **E1. RESOLVED — add a release concept to `Assessment`.** The mockup's section copy asserts that
  unreleased assessments are not listed, and **`Assessment` has no release column** at all. Chosen:
  add `Assessment.releasedAt DateTime?` with a **publish action and an audit row**, rather than
  rewriting the copy away.

  **This is the one decision that changes Wave 2's shape** — it is a schema change plus a write path,
  so it is its own slice (S5a) before the calendar page consumes it:

  |            |                                                                                                                                                                                |
  | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | Migration  | `Assessment.releasedAt DateTime?` — additive, nullable, no backfill needed                                                                                                     |
  | Write path | an explicit teacher action setting it, mirroring how `CourseOffering.resultsPublishedAt` is set (route + `requireRole` + ownership)                                            |
  | Audit      | one `AuditLog` row, consistent with every other publish-like action in this codebase                                                                                           |
  | Contract   | `released` on whatever the calendar and planner projections need — **not** on the student assessment payload, which already has `hasMark`/`published` for the per-student view |
  | Tests      | the publish action's authz, the audit row, and that an unreleased assessment's event is absent for a student and present for its teacher                                       |

  **Naming caution, already a live confusion:** the offering already has a _different_ publish —
  `CourseOffering.resultsPublishedAt`, which is the **retention anchor** and starts the purge clock.
  That is "results are out for the course"; this is "this assessment is visible to students". They are
  different facts at different granularities. The new field must not be called `publishedAt`, or a
  future reader will wire the purge clock to the wrong column. `releasedAt` is the name.

  **Also required:** the seed must populate it on the assessments that should be visible, or the
  student calendar renders empty. That makes S5 a prerequisite of S6 (seed) rather than a
  parallel task.

- **E2. RESOLVED — derive location as `classRoom.name`**, and rename the column "Class". No migration;
  an event with no class (a holiday) renders `—`, which is the em-dash rule on live data.
- **E3. RESOLVED — filter `eventType = "ASSESSMENT"` out of "All events"** so the deadlines table owns
  them. One row per fact; keeps the deadlines table, whose columns the events table cannot serve.
- **E4. Recurrence.** `CalendarEvent` cannot express it (no `rrule`/`seriesId`/`parentId`), and the
  mockup has no recurrence control, so nothing is blocked. **Explicitly out of scope**; say so rather
  than implying support.

### Dashboards (not Wave 2)

- **D1. Does converting `GradebookProvider` change behaviour?** Yes. One visible improvement (no
  "Loading gradebook…" flash), and two latent problems: only the _payload_ becomes server-available
  (`role`, filters and mutators stay client state, and the root layout cannot know the role), and the
  provider is mounted in the **root** layout with a second consumer outside `(dashboard)` —
  `QuizRunner` on `/quiz`. So the conversion is one shared file plus two layouts, not a one-liner.
  The failure path also changes: today a failed fetch leaves the page usable; a throwing Server
  Component hits the error boundary.
- **D2.** Land it as the **first slice of the dashboard wave**, as a refactor proved byte-identical,
  not on its own.
- **D3.** Even after conversion the dashboards remain partly unportable — three of their tiles are
  B1–B3 metrics. Do not let the dashboards become the reason to guess a metric.

---

## 6. Tests to add

The read paths are new, so they need tests — this is where Wave 1's untested-GET lesson applies.

| Slice | Test                                                                                                                                                                                                                                  | Kind        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| S2/S6 | `tests/demo-seed-shape.test.ts` — **legibility, not existence** (full list in §2.5). The lesson from Wave 1's three seed bugs, all of which passed their own tests because the assertions only counted rows                           | DB          |
| S1    | `tests/material-mapping.test.ts` — all six kinds; `sourceUrl: null` stays null; `chunks: 0` → `indexed: false` (not `undefined`)                                                                                                      | pure, no DB |
| S1    | `tests/materials-read.test.ts` — a student sees their offering's materials **and** course-wide ones, not another offering's; an unenrolled student sees nothing; `chunks` matches the real count; a zero-chunk material still appears | DB          |
| S4    | `tests/calendar-mapping.test.ts` — all four kinds; `endAt`/`description` null (never `""`); `selectUpcoming` orders and drops past events                                                                                             | pure        |
| S4    | `tests/calendar-read.test.ts` — cross-offering isolation both ways; a course-wide event visible to the enrolled student and the owning teacher only                                                                                   | DB          |
| S8    | an assessment-deadline projection test that **drops** `weightPercent`/`published`, so a future migration has to change the test deliberately                                                                                          | pure        |

---

## 7. Documentation worth correcting while nearby

Found during this pass, all small, all in files the port is supposed to keep honest:

- `docs/ui/design-system.md`'s fixture table lists `MOCK_CALENDAR_EVENTS`/`MOCK_UPCOMING_EVENTS`, but
  the pages actually use the **student-scoped** variants, which are not in the table. The student-scoped
  ones are correct (they drop assessments whose fixture state is `draft`).
- `docs/quality/a11y-perf-audit.md` cites `app/layout.tsx:54` for the provider mount; it is at `:59`.
- `app/(dashboard)/teacher/observability/page.tsx:143` formats a date in render with an implicit
  locale — do not copy the pattern into a ported page.

---

## 8. Where this plan is uncertain

Stated plainly, because each affects a decision above:

- **Whether `CalendarEvent.isUpcoming` is meant to be maintained by a job.** Nothing writes it outside
  the seed. I infer it is a stored convenience that can go stale; there is no job in the repo, but
  absence of evidence is not evidence of intent.
- **Whether an `offeringId: null` material is intended to be course-wide visible to every enrolled
  student.** The retriever treats it that way, so the reader was designed to match — **if the intent
  differs, the reader and the retriever would disagree**, which is the worst outcome available here.
- **Whether `MOCK_ITEM_ANALYSIS` or the real `itemAnalysisResponseSchema` is the intended design** for
  the quiz-ai item-analysis tab. They carry genuinely different fields. Affects a later slice.
- **The seeded offering dates** — resolved by B2 into a seed requirement (§2.4): the term must become a
  realistic 15 instructional weeks with assessments inside it. What remains unverified is whether the
  platform has any _other_ consumer that assumes a year-long offering; the seed change should be checked
  against the analytics and export readers before it lands.
- **The Wave 1 test figures** were not re-run during this pass (two agents shared the database, and the
  harness drops the schema). The test-file count here is 101, which is one more than Wave 1's
  documented 99 - the difference is unverified.
