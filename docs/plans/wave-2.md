# Wave 2 — readers that do not exist yet

Status: **plan, not started.** Written against `dev` @ `dfe1151` (Wave 1 complete). Companion to
[`wave-1.md`](./wave-1.md), whose scope table this document acts on.

Wave 1 was a **presentation port**: every page already had a working backend. **Wave 2 is not.**
The pages left over need code that does not exist, and the risk is in the query and the derivation
rather than in the composition.

---

## 1. Scope

**Wave 2 = the three "no reader at all" pages, plus an optional trailing re-skin.**

| Slice  | Content                                                    | Ships independently |
| ------ | ---------------------------------------------------------- | ------------------- |
| **S1** | `lib/materials.ts` + pure mapper + tests. **No page.**     | yes                 |
| **S2** | **Seed: materials** — the 8 rows in §2.2, indexed for real | yes                 |
| **S3** | `student/resources` page                                   | yes                 |
| **S4** | `lib/calendar.ts` + pure mapper + tests. **No page.**      | yes                 |
| **S5** | **Seed: calendar** — the 10 rows in §2.3                   | yes                 |
| **S6** | `student/events` page                                      | yes                 |
| **S7** | `teacher/planner` page                                     | yes                 |
| **S8** | `teacher/observability` re-skin (optional, droppable)      | yes                 |

The three pages are the only ones where a **reader must be written that does not exist**. The parent
plan warned about under-budgeting exactly this: _"'Missing reader' is not 'missing model' … budget
Wave 2 properly"_ (`mockup-to-backend.md:215`).

**S1 and S4 carry no page on purpose.** The risk here is the query and the derivation, not the JSX.
Proving the reader with a pure mapper test and a DB test before any page exists keeps the composition
slices trivially reviewable.

**S2 and S5 are seed slices, and they are not padding** — see §2.1. Without them the three pages render
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

**Writing these rows properly is a Wave 2 task in its own right**, because without them S2, S4 and S5
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

### 3.2 `lib/calendar.ts` (S4) — shared by two pages

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

### 3.3 `teacher/planner` (S7) — plus an assessment-deadline query

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

### 3.4 `teacher/observability` (S8, droppable)

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

| #      | Prerequisite                                                           | Blocks                                                 |
| ------ | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| **P1** | `lib/materials.ts` + mapper (S1)                                       | `student/resources`; later the quiz-ai materials panel |
| **P2** | **Seed: materials (S2)** — §2.2                                        | any meaningful demo or review of S3                    |
| **P3** | `lib/calendar.ts` + mapper (S4)                                        | both calendar pages                                    |
| **P4** | **Seed: calendar (S5)** — §2.3                                         | any meaningful demo or review of S6/S7                 |
| **P5** | Decision E1 (how a student calendar knows an assessment is unreleased) | S6                                                     |
| **P6** | Decisions E2 (location), E3 (duplicate rows)                           | S7                                                     |
| **P7** | Decisions M1 (topic), M3 (drop `state`/`sizeLabel`)                    | S3                                                     |
| **P8** | Decision M2 (does a Material need a creation path?)                    | decides whether S2/S3 are a demo or a product          |

**Order:** P1 → P2 → P7 → S3 → P3 → P4 → P5/P6 → S6 → S7 → S8.

The seed slices sit **before** their pages deliberately: a page built against two monotonous rows
teaches nothing about whether its branches work, and the seed guard (`§2.5`) establishes the fixture
shape before anything renders it.

Note the shell swap (`getSessionUser` + `redirect` + `AppShell scope="app"` + `force-dynamic`) rides
along with each page. The app-scope nav already covers all three routes, so `tests/nav-scope.test.ts`
needs no change.

---

## 5. Decisions needed before building

Every one is a **human call**. Recommendations are mine, not conclusions.

### Group B — defer to its own decision-first wave

- **B1. What is "topic mastery"?** Options: (a) correct/total over `Question.subtopic` across the
  offering's responses; (b) percentage of a _student's_ questions in that subtopic; (c) average of
  per-student topic percentages. (a) and (c) can differ by double digits on seeded data. The threshold
  also needs a decision — reuse `CourseOffering.analyticsSettings` rather than a new constant.
- **B2. What is a "score-trend series"?** The mockup's `W1..W6` with a deliberate `null` week has no
  schema equivalent. Bucketing by calendar week between `startsOn`/`endsOn` is the obvious reading —
  but the seed's offering spans ~50 weeks, which makes a six-point chart absurd. **This is a product
  question: is "teaching week" a real noun?**
- **B3. "At risk".** Wave 1 **D3** already decided it has no backing and dropped it. Keep dropped
  unless someone defines the signal and threshold.
- **B4. `completionPercent`.** Matches nothing derivable. **Drop, consistently** — not a real call.
- **B6. `RetakeRecommendation.reason`.** The mockup shows a _diagnosis_ ("two sign errors on Q4"). The
  platform can honestly produce "3 of 5 failed" and nothing more; a diagnosis means asking a model,
  which is a new feature with its own explainability contract.

### Materials

- **M1. What is a material's "topic"?** (a) drop the column — a material has no topic, the _question_
  does; (b) put it in `Material.metadata.topic`, unenforced and invisible to a `where` filter;
  (c) add a real column + migration. **Recommend (a) for Wave 2**; (c) is the honest long-term answer
  and should not be decided inside a presentation port.
- **M2. Does a material need a creation path, or only a list? — the decision that matters most.**
  Today there is **no way to add one**, so a ported list is a read-only view over whatever the seed
  put there: 2 rows on the demo database, 0 on any other. That makes it **untestable by a user and
  undemoable on a fresh database**. Options: (a) list-only, be explicit in the copy and docs, seed
  more rows; (b) add a teacher create/link form + route + contract + tests + the `indexMaterial` call
  — a real feature, not a port; (c) list-only now, creation as its own slice. **Recommend (c)**;
  adding a write path "while we're here" is precisely how D1 and D2 happened.
- **M3. Drop `state` and `sizeLabel`?** No pipeline state exists and there is no stored file.
  **Recommend drop both**, collapsing into the derived `indexed` boolean.

### Calendar

- **E1. How does a student's calendar know an assessment is unreleased?** The mockup's section copy
  asserts it, but **`Assessment` has no release column**. The nearest signals are quiz-only. Options:
  (a) treat every stored event as visible and **rewrite the copy to say what is true**; (b) derive
  from "has a published question" (wrong for three of the five assessment types); (c) add
  `Assessment.releasedAt` + a publish action + audit — a real feature. **Recommend (a) for Wave 2.**
  Note the teacher side already calls a _different_ thing "publish" (`CourseOffering.resultsPublishedAt`,
  the retention anchor) — do not overload the word again.
- **E2. "Location" on an event.** No column; `ClassRoom` has no venue, and Wave 1 **D9** already
  dropped the mockup's `room` for this reason. **Recommend derive as `classRoom.name` and rename the
  column "Class"**, rendering `—` for an event with no class.
- **E3. The planner lists every assessment twice.** **Recommend filtering `eventType = "ASSESSMENT"`
  out of "All events"** so the deadlines table owns them — one row per fact.
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
| S2/S5 | `tests/demo-seed-shape.test.ts` — **legibility, not existence** (full list in §2.5). The lesson from Wave 1's three seed bugs, all of which passed their own tests because the assertions only counted rows                           | DB          |
| S1    | `tests/material-mapping.test.ts` — all six kinds; `sourceUrl: null` stays null; `chunks: 0` → `indexed: false` (not `undefined`)                                                                                                      | pure, no DB |
| S1    | `tests/materials-read.test.ts` — a student sees their offering's materials **and** course-wide ones, not another offering's; an unenrolled student sees nothing; `chunks` matches the real count; a zero-chunk material still appears | DB          |
| S4    | `tests/calendar-mapping.test.ts` — all four kinds; `endAt`/`description` null (never `""`); `selectUpcoming` orders and drops past events                                                                                             | pure        |
| S4    | `tests/calendar-read.test.ts` — cross-offering isolation both ways; a course-wide event visible to the enrolled student and the owning teacher only                                                                                   | DB          |
| S7    | an assessment-deadline projection test that **drops** `weightPercent`/`published`, so a future migration has to change the test deliberately                                                                                          | pure        |

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
- **How the seeded offering dates interact with a weekly series** — ~50 weeks, which is part of why
  B2 is a product question rather than a query.
- **The Wave 1 test figures** were not re-run during this pass (two agents shared the database, and the
  harness drops the schema). The test-file count here is 101, which is one more than Wave 1's
  documented 99 - the difference is unverified.
