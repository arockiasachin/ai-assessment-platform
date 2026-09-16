# Wave 3 — derivations, not new tables

Follows [Wave 1](./wave-1.md) (the presentation port, 13 pages) and
[Wave 2](./wave-2.md) (the three pages whose reader did not exist). Those two were
about _moving data to a page_. This one is about **computing numbers that no column
holds**, which makes it a different kind of risk: a port that renders the wrong field
looks broken, while an aggregation that computes the wrong thing looks like an
insight.

Read §4 of [`mockup-to-backend.md`](./mockup-to-backend.md) alongside this. It
recorded the fixture fields with no schema backing; several are decided here.

---

## 1. Scope

Wave 3 is **"the data exists; the aggregations don't"**. Four surfaces:

| Surface                              | Why it is Wave 3                                                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `teacher/analytics`                  | The overview returns per-assessment counts and alerts, but score-trend series, topic mastery and the at-risk roster do not exist. |
| `student/retake`                     | The adaptive retake is read-only and returns failed/unanswered ids; a `RetakeRecommendation` is not produced (B6, B7).            |
| Teacher + student **dashboards**     | KPI tiles must be computed from existing reads, and both sit on the client-side `GradebookProvider` that needs converting.        |
| `teacher/quiz-generation` Topics tab | Partially blocked in Wave 2; its materials panel is now built.                                                                    |

**Not in Wave 3:** the admin surface (Wave 4 — structurally different, no admin API
routes, reads Prisma directly) and the remaining decision-list items (Wave 5).

---

## 2. Slices

| Slice  | Content                                                                         | Ships independently  |
| ------ | ------------------------------------------------------------------------------- | -------------------- |
| **T1** | `lib/analytics/statistics.ts` + `weekly-series.ts` — the pure computable core.  | **landed** `8bad3a2` |
| **T2** | Cohort mastery (B1) + at-risk roster (B3) + median tile (B5), as readers.       | yes                  |
| **T3** | The trend series wired to real attempts (B2), replacing any synthesised points. | yes                  |
| **T4** | `teacher/analytics` page on the derived metrics (depends on T2, T3).            | yes                  |
| **T5** | `QuizAttempt.kind` + retake policy + practice pool (B7, schema change).         | yes                  |
| **T6** | `student/retake` page + `RetakeRecommendation` (B6, depends on T5).             | yes                  |
| **T7** | `GradebookProvider` → server props, then the two dashboards.                    | yes                  |
| **T8** | `teacher/quiz-generation` Topics tab (depends on T2's mastery shape).           | yes                  |

T1 is landed because Wave 2's §5 already decided the metric definitions, so it needed
no research. T2 and T3 are the readers over those pure functions. The page slices come
after their readers, matching the order that worked in Wave 2.

---

## 3. Decisions

### D1 — **OPEN, and it blocks T2.** Does the platform use σ-bands or absolute bands?

This is the one thing Wave 3 must settle before writing an at-risk rule, and it was
not visible until the existing code was read.

`docs/plans/wave-2.md` §5.4 decided at-risk as **"below the institution's own pass
boundary, `max(mean − 2σ, 50)`"**, on the stated grounds that _"the alert and the grade
sheet cannot disagree about who is failing."_

**But the grade sheet does not use σ.** `letterGrade` (`lib/gradebook.ts:95`) uses fixed
absolute bands — `A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, F < 60` — and it is load-bearing in
six places:

| Consumer                            | What it shows                       |
| ----------------------------------- | ----------------------------------- |
| `lib/lms-export/final-grade.ts:174` | **the exported final grade letter** |
| `components/student-view.tsx:160`   | the student dashboard's own grade   |
| `lib/analytics/cohort.ts:78`        | the cohort histogram                |
| `lib/analytics/legacy.ts:61`        | mark-map bands                      |
| `components/grade-badge.tsx:35`     | every grade badge in the UI         |
| `components/quiz-runner.tsx:337`    | the post-quiz grade                 |

`cohort.ts` also carries its own `DEFAULT_PASS_THRESHOLD = 60`, and
`DEFAULT_INTERVENTION_THRESHOLDS.classAverageBelow` is `60`. So the codebase currently
has **three** independent absolute-60 notions of passing.

If T2 implements `max(mean − 2σ, 50)` for the at-risk roster, then for a cohort
averaging 82 with σ 6 the boundary is 70 — and a student on 65 is **at risk on the
roster while holding a `D` that the LMS export, the badge and their dashboard all say is
a pass.** That is precisely the disagreement §5.4 said must not happen, inverted.

Three ways out, and this needs the owner's call because it is a grading-policy decision
with consequences outside the app:

| Option                                     | What it means                                                                                                                           | Cost                                                                                                                                                              |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. One banding everywhere**              | `letterGrade` becomes offering-scoped and σ-based; the export, badges and dashboards all follow.                                        | Touches the exported grade — the most consequential output — plus six call sites and their tests. A real project, and it changes what a student is told they got. |
| **B. Absolute for letters, σ for insight** | Letters keep fixed bands; the at-risk roster uses σ **and says so**, labelled as "below this cohort's pass line" rather than "failing". | Cheapest and honest, but the two numbers remain different by design and the UI must never imply otherwise.                                                        |
| **C. Keep absolute everywhere**            | At-risk = below the same absolute threshold the grade sheet uses, dropping §5.4's σ formula.                                            | Consistent and simple, but discards the institution's actual regulation that §5.3/§5.4 were researched to honour.                                                 |

**Recommendation: B**, with the label changed — because a σ-band is _relative to a
cohort_ and an exported letter is _an institutional record_, and conflating them is how
a student is told two different things by the same platform. But this is the owner's
call, not the implementer's: it changes either a student's grade or a teacher's reading
of "at risk".

Until it is settled, **T2's at-risk half does not ship.** The mastery half (B1) and the
median tile (B5) do not depend on it.

### D2 — Not every fixture number survives

Per [`mockup-to-backend.md`](./mockup-to-backend.md) §4, the mockups assert numbers
nothing derives. Recorded here so no slice quietly invents one:

- **`completionPercent` — dropped** (B4). `62` matches neither 58% (submitted/expected)
  nor 69% (released assessments), so there is no formula to implement.
- **`Assessment.weightPercent` — dropped** from the UI. No column exists; weights live
  only in the LMS export request body. Making them persistent course config is a Wave 5
  decision, not a Wave 3 derivation.
- **`ExportRow`** (target/platform/mapped users/issues) — no export-job model. Out of
  scope; the real export page is already a working, tested surface with a different noun.
- **`MockNotification`** — no `Notification` model. Dropped.

### D3 — B6: the retake reason is factual

The reason shown for a recommendation is a **restatement of counts** — _"3 of 5
questions failed on Quiz 1"_ — never a diagnosis like the mockup's _"two sign errors on
Q4"_. The platform can honestly count failures; characterising _why_ would need a model
call with its own explainability and review flow. Recorded so T6 does not reach for a
generated sentence.

---

## 4. The metric definitions (settled in Wave 2 §5, restated so they are actionable)

- **B1 — cohort mastery.** Points earned ÷ points possible across the offering's
  finalised responses, grouped by `Question.subtopic`, **excluding unattempted items**.
  Question-weighted, not student-weighted: averaging per-student percentages weights a
  student who answered two items the same as one who answered twenty. `null` below the
  reporting minimum. The threshold reuses `CourseOffering.analyticsSettings`, not a new
  constant.
- **B2 — a teaching week** is one of a semester's **15 instructional weeks**. Bucket by
  calendar week from `startsOn`, `null` for weeks with no assessed work, series length =
  the term's. Implemented in T1.
- **B3 — at-risk** = below `max(mean − 2σ, 50)` over **published marks only**, cohort =
  the offering's enrolled students. **Blocked on D1.**
- **B5 — median**, derived beside the mean. The honest companion to a mean-and-σ system:
  a median that disagrees with the mean tells a teacher one script is distorting the
  cohort.
- **B6 / B7 — see D3 and the retake spec in Wave 2 §5.7.**

---

## 5. Prerequisites, ranked

1. **D1, the banding decision** — blocks the at-risk roster, which is T2's larger half.
2. **`Question.subtopic` must be trustworthy.** B1 groups by it and the Topics tab (T8)
   lists it. It is written by quiz generation, so if it is model-generated free text the
   "topic list" is an unpredictable pile of strings and both B1 and T8 need rethinking.
   Verified in the T-1 dossier rather than assumed.
3. **The `GradebookProvider` conversion (T7).** A long-standing P1 finding. Its
   consumers and its _mutations_ must be inventoried before touching it — a naive move of
   reads to the server could break a write path.
4. **A published-marks-only helper.** B3 requires it and Wave 1 already established a
   class average is published-only. Reuse whatever `lib/student-assessments.ts` does
   rather than writing a second definition of "published".

---

## 6. What this wave must not do

- **Invent a number to fill a tile.** Drop it, or label the derivation. Every dropped
  field above was dropped for this reason.
- **Replace the working quiz generate/publish path.** The `quiz-generation` mockup is
  partially additive only; the existing path must not be rebuilt.
- **Ship an at-risk rule before D1.** A roster that contradicts the exported grade is
  worse than no roster.

---

## 7. Research findings (four dossiers, read against `2936be3`)

### 7.1 `Question.subtopic` is LLM free text — **new decision D4**

This settles the prerequisite §5 ranked second, and it is worse than "unstructured".

**Populated: yes. Structured: no.** The vocabulary is chosen by the model per request.
When the teacher supplies no tags, the prompt says so verbatim: _"The teacher did not
specify subtopics; choose 2-4 coherent subtopics yourself."_
(`lib/quiz-generation/prompt.ts:61-64`). The only downstream constraint is
`trim/min(1)/max(200)` (`lib/quiz-generation/parsing.ts:44`) — no enum, no canonical
list, no normalisation, no reuse across requests. The column is also nullable, so
hand-authored questions carry `null`.

The fixtures show the drift: the seed passes
`subtopics: ["solving equations", "slope", "systems of equations"]` and produces tags
including `solving equations` **twice** (`prisma/seed-demo.ts:881`), while the mockup's
Topics tab lists a completely different five-string vocabulary
(`lib/mock/analytics.ts:50-56`) with no shared key. And the mock provider has already
leaked prompt text into persisted tags once (`docs/verification/bugfix-run-2.md:183-192`).

**Consequences.** Exact-string `groupBy(subtopic)` yields a long tail of
near-duplicates — `slope` / `Slope` / `gradient & intercept` / `finding the gradient`.
A mastery chart labelled with whatever the last model call invented is not a chart, it
is a word cloud.

Worse, **the demo would render entirely as "insufficient data."** The seed submits 3
attempts against 4 questions, so per-subtopic answered counts are roughly 6/3/3 — under
B1's reuse of `minAttemptsForDifficulty = 10` (`lib/analytics/item-analysis.ts:61-65`)
every row is `null`. The tab ships looking broken. Note the mockup implies a **5**
response floor (`lib/mock/quizzes.ts:323`), which conflicts with the 10 B1 says to reuse.

**Options, in order of honesty:**

| Option                          | What ships                                                                                                                              | Cost                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **D4a. Drop the mastery chart** | No topic chart until the vocabulary is controlled.                                                                                      | Loses a mockup surface; nothing false ships.                                |
| **D4b. Reshape it**             | A plain list of _the subtopics on this assessment_ (a token, not a mastery score), which is honest about what a free-text tag supports. | Small; reuses existing data.                                                |
| **D4c. Ship it with guards**    | Exact-string grouping, `responses`-descending, a minimum-samples threshold, plus a seed bump so the demo shows something.               | Sells a free-text vocabulary as an analytic axis; the labels stay unstable. |

**RESOLVED: D4b — reshape it.** Implemented in `lib/analytics/subtopics.ts`.

No option should produce a per-topic mastery number from an uncontrolled tag
vocabulary. The decisive evidence arrived by running the new reader against the seeded
assessment, and it is starker than the dossier predicted:

```
tag                  questions  responses  marks
solving equations            2          6      2
slope                        1          3      1
systems of equations         1          3      1
```

**Under B1's reuse of the item-analysis minimum (10 answered), every one of those three
rows is `null`.** The mockup's entire surface would render as three "insufficient data"
rows, on the exact data the product is demonstrated with. And the tag set is precisely
the three strings the seed passed in — with `solving equations` silently carrying two
questions.

So the mastery chart was never going to render, and a per-topic number attributed to a
label the model invented is not worth building. What ships instead answers the question
the data _can_ support — **which topics does this assessment cover, and how much of it is
each one** — with no mastery score, no threshold and no `null`-because-small-sample.

Two properties the implementation commits to, both tested: **no normalisation** (tags
differing by case or whitespace stay separate tokens, because merging them would be
inventing a taxonomy in a string heuristic), and **untagged questions are counted
separately** rather than given a name like "Uncategorised", which would put a fabricated
token beside real ones. A controlled vocabulary — a tag table or an enum — remains a
Wave 5 schema decision.

### 7.2 There is no canonical "class average" — **new decision D5**

Three implementations disagree and nothing declares which is right:

- `lib/analytics/legacy.ts:40-52` — over a `MarksMap`.
- `lib/analytics/service.ts:159-176` — over finalised `QuizAttempt` rows.
- the mock fixture (`lib/mock/course.ts:265-271`).

The dashboards (T7) and B1's "relative to the class" both need one definition. Picking
silently would mean the dashboard, the analytics page and the at-risk roster can
disagree about the same class — which is the failure mode D1 is about, one level down.
**Resolve with D1, since both are the same question: what is the cohort and what is its
centre.**

### 7.3 The retake change is 22 call sites, four of which fail **silently**

B7's schema change is smaller than it looks in schema terms and larger in blast radius.
Confirmed against the code:

- **`GRADED`, `EXPIRED` and `ABANDONED` are never written by any code path**, and
  `QuizAttempt.expiresAt` is never written either. Only `IN_PROGRESS` and `SUBMITTED` are
  live. So `COUNTED_STATUSES` is largely counting states that cannot occur.
- **`COUNTED_STATUSES` / `FINALIZED_STATUSES` are declared twice** — `service.ts:62-63`
  and `analytics/service.ts:49` — hand-maintained duplicates with no single source of
  truth. A `kind` change must be applied in both _and_ at every call site.
- **17 call sites** in the quiz-attempt pod and **5** in analytics. The ones that break
  **silently**: `attemptSettings` (`service.ts:123-133`), `listStudentQuizzes`
  (`:301-303`) and the cap gate (`:544-550`) would miscount, so a student's remaining
  attempts would simply be wrong; and `latestFailedQuestionIds` (`:469-477`) would pick a
  **practice** sitting as the retake's source, building a retake from practice answers.
- **`attemptNumber` is shared across kinds** — `@@unique([assessmentId, studentId,
attemptNumber])`, numbered `max(all) + 1` (`:563-564`). A student who practises three
  times before their first graded sitting gets a graded attempt numbered 4, and the
  teacher-facing "attempt #4" is nonsense. This must be decided in the slice plan, not
  discovered.
- **`COUNTED_STATUSES` must become a predicate, not a longer list.** Extending a list
  cannot express "practice but counted" versus "graded and counted", which is the whole
  point of the change.
- **`Assessment.maxAttempts` counts the first graded sitting**, so "the teacher allows
  one retake" is `maxAttempts = 2`. If the UI offers "retakes allowed: 1", either the
  resolver adds one or the label is wrong.

### 7.4 T7 — the conversion is cheaper than feared, and one reported blocker is false

- **A reported "wrong-content flash" — `/student` server-rendering the teacher branch —
  is not real.** It rested on `components/dashboard.tsx`, which **nothing imports**; the
  live pages render `StudentView`/`TeacherView` directly. Verified by fetching `/student`
  as a student: the HTML contains "Student dashboard", not the teacher branch.
- **A smaller real one exists.** `dashboard-header.tsx:94` renders
  `role === "teacher" ? "Teacher view" : "Student view"`, and `role` defaults to
  `"teacher"`. The server-rendered `/student` HTML contains **"Teacher view"** and not
  "Student view" — an `aria-label`ed "Current view" that is wrong until hydration.
  Cosmetic, but it is wrong text for the wrong role and worth fixing in T7.
- **The middle path is genuinely cheap** and is the a11y/perf audit's own recommendation:
  optional `initialPayload`/`initialRole` props, skip the mount fetch when seeded, mount
  the seeded provider in a new `app/(dashboard)/layout.tsx` (there is none today), and
  keep `refresh()` fetching so the write paths are unaffected. Nested providers shadow the
  root one, so `/quiz` is untouched.
- **A scoping wart worth fixing while there:** the teacher payload's `enrollments` has no
  `status: "active"` filter (`lib/gradebook-db.ts:161-168`) while every other roster
  reader filters it (`lib/teacher-roster.ts:138`), so a dropped or waitlisted student
  appears on the dashboard but not on `/teacher/classes`.

### 7.5 T8 — the Topics tab needs four things that do not exist

The tab shell, the item-analysis reader and the `subtopic` data exist. Missing: the
mastery aggregation, a contract schema, **a teacher-scoped materials reader** (the Wave
2 reader is student-only — `listMaterialsForStudent`), and an `offeringId` on the page's
props (`GenerationAssessmentSummary` has none). Purely additive, and it depends on D4.
