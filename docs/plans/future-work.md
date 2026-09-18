# Future work

Status: **Roadmap — nothing in this document is built.** Written against `dev` @ `7af5a7c`, after
Phase 1 (navigation, shell, readability) landed in `7af5a7c` and Phase 3 (quiz import) in `3276cc2`,
with Phase 2 (grades, course hub, seed) still in flight. It is the forward-looking companion to
[Known gaps and open decisions](../README.md#known-gaps-and-open-decisions), which stays the index of
_actual_ gaps; this file records features deliberately not built, and what each would require.

The phased rebuild of navigation, grades and quiz import stopped short of four feature surfaces the
mockups imply, plus a set of deferred audit and engineering items. Each is recorded here rather than
left implicit, in the same spirit as the Wave 4 decision table: a feature with no model, no transport
or no dependency is a **decision**, and the decision is worth stating even when it is "not now".

---

## 1. Summary

| Item                                                  | What is missing                                                                                  | Verdict                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Flashcards and spaced repetition                      | A card model and a per-student review-state model; no scheduling concept exists to reuse         | **Deferred.** Buildable on the existing LLM abstraction, but it is a new subsystem, not a port |
| Student → teacher messaging, and a raise-hand control | A message model, a permission story and a transport                                              | **Deferred.** The transport is the hard part; the model is the easy part                       |
| A student analytics page                              | Stored score history, or a defined aggregation window                                            | **Deferred.** Without history a chart would invent data                                        |
| A real semester / academic-period model               | A period entity, ordering and "current period" logic, and a migration of free-text `term` values | **Deferred.** Phase 2 groups on `term` + `academicYear` precisely to avoid this                |
| Carried-over audit and engineering items              | See §6                                                                                           | **Recorded with triggers**, not silently dropped                                               |

---

## 2. Flashcards and spaced repetition

**What it is.** A card store (front/back or prompt/answer, scoped to a course or offering), a
per-student review state (due date, interval, and some ease or streak value), and an SRS scheduling
algorithm that turns a review outcome into the next interval.

**Why it is not built now.** There is nothing to port. A repo-wide search for flashcard and
spaced-repetition vocabulary finds **no model, no interval or review-schedule table and no SRS
algorithm anywhere**. The nearest thing is the adaptive-retake recommendation —
`MOCK_RETAKE_RECOMMENDATIONS` in `lib/mock/resources.ts:105`, rendered as "Topics to revise" in
`app/mockup/student/retake/page.tsx:110` — and that is a **quiz retake**, not spaced repetition: it
recommends another sitting, with no card and no schedule.

**What it would actually require.**

| Piece              | Where it would sit                              | Note                                                                                                                                                                                                                            |
| ------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Card model         | `prisma/schema.prisma` (new)                    | No card or deck entity exists                                                                                                                                                                                                   |
| Review-state model | new, per student per card                       | Due date, interval and outcome history — no scheduling concept exists to reuse                                                                                                                                                  |
| Schedule algorithm | a new pure module in `lib/`                     | Testable without a renderer, in the repo's usual shape                                                                                                                                                                          |
| Generation         | `getLlmProvider().generate({ messages, task })` | `task` is the `LlmTask` union in `lib/llm/types.ts:48-55` (`"quiz-generation"`, `"quiz-grading"`, `"rubric-grading"`, `"code-grading"`, `"code-eval"`, `"embedding"`, `"general"`); a flashcard tag would be a new union member |

The generation half has a clear precedent to copy: `lib/quiz-generation/generation.ts` resolves
scope, calls the provider, validates the response strictly in `lib/quiz-generation/parsing.ts`, and
persists **unpublished drafts** — nothing publishes without a teacher. A flashcard generator could
follow the same generate → validate → persist-drafts shape. The card and review-state models have no
precedent.

**Verdict: deferred.** The LLM half is cheap and familiar; the model half is a new subsystem (two
models plus a scheduler), and that is why this is not a slice.

---

## 3. In-app student → teacher messaging, and raise-hand

**What it is.** Two related surfaces: a message thread between a student and the teacher of an
offering they are enrolled in, and a lightweight "raise hand" / ask-the-teacher control that alerts
the teacher without requiring the student to compose a message.

**Why it is not built now — the absence is total.**

| Check                                      | Result                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A model                                    | No `Notification`, `Message`, `Chat`, `Comment` or `Ticket` model in `prisma/schema.prisma`                                                                                                                                                                                                                                                         |
| A transport                                | No websocket, SSE or polling anywhere in the product. The only `EventSource` in the repo is `scripts/audit-dashboard/view.ts:607` (with its `server.ts:241` SSE endpoint), a standalone dev tool that is not part of the Next app                                                                                                                   |
| A notification surface                     | The top bar's bell is **mockup-only static data** (`MOCK_NOTIFICATIONS`, `lib/mock/session.ts:44`). `TopBar` takes notifications as a prop defaulting to `[]` and renders the menu only when `scope === "mockup"` (`components/shell/top-bar.tsx:158`), so **app scope renders no bell at all** — deliberately, because there is no model behind it |
| An existing student → teacher text channel | None. The closest is the support-desk widget embedded on `/help` (`app/(dashboard)/help/page.tsx`), which is requester → support team, not student → teacher. The nearest persisted student → teacher text is `CourseRating.comment` (`prisma/schema.prisma:241`), which is unidirectional with no reply channel                                    |

**What it would actually require.** Three things, and they are not equally hard:

1. **A model.** A message or thread entity with a sender, an offering (or enrollment) scope, a body
   and read state. Small and conventional.
2. **A permission story.** It must answer, from the database rather than the request, which student
   may message which teacher and which teacher may see which thread. That is the same object-level
   authorization shape the rest of the platform uses, but it needs a rule for the enrolment boundary.
3. **A transport.** This is the open decision and the hard part. Nothing in the app pushes
   server → client today, and a raise-hand that only appears on refresh is close to useless. The
   choice is between polling, SSE and a hosted realtime service, and each carries a different cost in
   the single-process `next start` deployment the project already targets — the same statelessness
   constraint noted for the login rate limiter and session cache in
   [Known gaps and open decisions](../README.md#known-gaps-and-open-decisions).

**Verdict: deferred.** The model is easy, the permission story is routine, and the transport is
genuinely open. This document records the requirement; it does not pick a transport for the reader.

---

## 4. A student analytics page

**What it is.** A student-facing counterpart to `/teacher/analytics`: trend, per-subject history or
topic mastery, reachable from the student nav.

**Why it is not built now.** It does not exist — no route under `app/(dashboard)/student/` and no nav
entry (the only Analytics item in `components/shell/nav-config.ts:269-270` is the teacher's). What a
student has today is deliberately shallower:

| Surface              | Where                                                                        | What it shows                                                            |
| -------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| "Overall" tile       | `lib/student-dashboard-view.ts:44` (`overallAveragePercent`), used at `:206` | The average over all released marks                                      |
| Summary strip        | `components/student-assessments-view.tsx:228-230`                            | Counts and an average for the current filter                             |
| Per-assessment marks | `components/student-assessments-view.tsx:425-437`                            | The mark, plus a class average withheld until the cohort is large enough |
| Quiz attempt history | the student quiz pages                                                       | Attempts and scores                                                      |
| Adaptive retake      | `app/(dashboard)/student/retake/page.tsx`                                    | Recommended practice                                                     |

The dashboard **has no trend or sparkline on purpose**: `lib/student-dashboard-view.ts:16-17` records
that six weeks of history would be needed, and **nothing snapshots a student's score**, so drawing a
series would be fabrication rather than analysis.

**What it would actually require.** One of two things, and the choice is the decision:

- **Stored history** — a snapshot of the student's aggregate (or per-subject mark) on each release,
  so a trend has real points; or
- **A defined aggregation window** — a stated period (this term, last N assessments) over which a
  trend is derived from existing `Grade` rows, with the window named in the UI so the chart cannot be
  read as lifetime history.

Without one of those there is nothing to plot.

**Verdict: deferred pending that decision.**

---

## 5. A real semester / academic-period model

**What it is.** A first-class period entity (an academic term or semester with a name, an order and
dates), so that "the current semester", "the previous semester" and "all my semesters" become
questions the schema can answer.

**Why it is not built now.** There is **no `semester` or `academicTerm` model anywhere in the
schema**. The only period fields are:

| Field                         | Type     | Where                      |
| ----------------------------- | -------- | -------------------------- |
| `CourseOffering.term`         | `String` | `prisma/schema.prisma:176` |
| `CourseOffering.academicYear` | `Int`    | `prisma/schema.prisma:177` |
| `ClassRoom.academicYear`      | `Int`    | `prisma/schema.prisma:162` |

`CourseOffering` is uniquely keyed on `[courseId, classId, teacherId, term, academicYear]`
(`prisma/schema.prisma:218`), so the pair is the de-facto period identity. Phase 2 groups a student's
marks by `term` + `academicYear` precisely so the grades page needs **no schema change**.

**What a proper model would change.**

- **A period entity**, with the offering pointing at it instead of carrying two loose fields.
- **Ordering and "current period" determination.** Today `term` is free text, so nothing can order
  terms or say which one is current without hard-coding strings. (Phase 2 derives "current" from the
  offering's own term and year, which works only because the caller already knows the offering.)
- **Migration of the free-text `term` values**, which are inconsistent today: the seed data contains
  at least `Semester-1` (`prisma/seed-courses.ts:427`, `:889`), `Term-1` and `Term-2`
  (`prisma/seed.ts`, `prisma/seed-demo.ts`). A real model has to normalise those into period rows,
  or every ordering and "current" rule inherits the inconsistency.

**Verdict: deferred.** The two-field grouping is honest for one feature; it does not generalise to
ordering, and the migration is the cost that keeps it out of scope.

---

## 6. Carried-over deferred items

These are not new features. They are items the audit remediation and the surrounding work reviewed
and deliberately left, each with the condition that would make it matter. `SN-41` and `SN-52` are
wontfix audit rows in `docs/audit/`. The other four items have no audit row — the closest is `SN-3`,
which cites the test for the now-orphaned `lib/student-drafts.ts` — so this section is their record.

| Item                                                                      | What it is                                                                                                                                                                                                                                                                                                                                                                                                | Trigger to act                                                                                                        | What it would require                                                                                         |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **`SN-41` — institution-wide holidays bleed across institutions**         | Reviewed and left as **wontfix**: there is no `Institution`, `Organization` or `Tenant` model, so the product is single-tenant and an unscoped `CalendarEvent` is correctly global. One seed event had carried cohort-specific copy on an unscoped row; that copy was neutralised by `TN-11`                                                                                                              | **Multi-tenancy landing.** This becomes a genuine cross-tenant leak the moment it does                                | A tenant dimension on `CalendarEvent`, and scoping on every currently-unscoped read                           |
| **`SN-52` — the retired `lib/quiz-grading.ts` still splits 403 from 404** | The one place the refusal invariant does not hold (`lib/quiz-grading.ts:90`, `:134`). Unreachable: the only importers are `tests/quiz-grading.test.ts:24` and `tests/legacy-quiz-retirement.test.ts:38`, and no route references it                                                                                                                                                                       | Rewiring the module to a route (fold the branches as `TN-69` did), or deleting it outright (then the row is obsolete) | Nothing today — fixing it would be editing dead code                                                          |
| **Monaco loads from a CDN**                                               | `@monaco-editor/loader`'s default config points the editor runtime at `https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs`, and `monaco-editor` is not a declared dependency, so there is no configured local fallback                                                                                                                                                                              | **Any restricted-egress or offline deployment**                                                                       | Bundling `monaco-editor` locally (adding it to `package.json`) and pointing the loader at it                  |
| **`lib/student-drafts.ts` is orphaned**                                   | Zero production imports since the inline textarea was replaced by the dedicated writing page; the only importer is `tests/student-drafts.test.ts:3`. Its docblock still describes the per-card `submissionDrafts` map that no longer exists. It is kept only because the audit row that fixed that bug (`SN-3`) cites its test as evidence                                                                | A cleanup pass, or reintroducing a similar draft overlay somewhere it fits                                            | Deleting the module and its test, and updating the `SN-3` evidence pointer                                    |
| **`actualOutput` is empty for `unit`-type code test cases**               | The sandbox harness compares the returned value internally (`lib/code-eval/harness.ts:436-451` Python, `:707-724` Node) but writes only stdout into `out`; `lib/code-eval/visibility.ts:57` sets `actualOutput: result.stdout`, so only `input-output` cases can show an expected-vs-actual comparison                                                                                                    | A student-visible expected/actual panel for `unit` cases                                                              | A harness change to emit the observed return value alongside pass/fail                                        |
| **The free-run throttle writes unswept `AuditLog` rows**                  | `consumeFreeRunSlot` writes one `AuditLog` row per accepted sample Run with `entityType=CodeFreeRun` (`lib/code-eval/free-run-throttle.ts:33`; create at `:114-121`). The window is a `createdAt > cutoff` count with implicit expiry, so the table grows one row per accepted run and nothing sweeps it; no UI reader surfaces them (`getRecentGradeActivityForTeacher` filters to grade-pipeline types) | Table growth in a long-lived deployment, or a decision to surface run volume                                          | A retention/sweep job, or the dedicated shared rate-limit store the module itself names as the long-term home |

Two details worth stating plainly, because they are easy to misread:

- The Monaco failure is **silent**. When the CDN is unreachable, the dynamic import at
  `components/student-code-submissions.tsx:68` leaves the permanent "Loading editor…" spinner
  (`:70-73`), `onChange` (`:701`) never fires, `source` stays empty, and **both Run (`:549`) and
  Submit (`:561`) stay disabled** with no user-visible error. `monaco-editor` does exist under
  `node_modules` as a transitive peer auto-install, but it is not in `package.json` and nothing wires
  the loader to it, so it is not a fallback in any real sense.
- The `unit` gap is a **display** gap, not a grading one: the case still passes and fails correctly;
  only the observed value a student would need to debug a failure is missing.
