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

### D1 — **RESOLVED** (see §7.6): VIT runs _two_ regimes, and both are now implemented

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
  the offering's enrolled students. **No longer blocked:** the boundary is
  `min(mean − 2σ, 50)` (§7.6 corrected the inversion), and the regime that applies is a
  function of the course category and headcount.
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
props (`GenerationAssessmentSummary` has none). Purely additive, and it depends on D4 —
which resolved to a token list rather than a mastery chart, so the aggregation it needs
is `lib/analytics/subtopics.ts` rather than the mastery formula this section originally
assumed.

### 7.6 VIT grading, verified — D1 resolved, and a **live defect** found

The banding research went to the primary sources: Academic Regulations **v4.0** (72nd
Academic Council, AY 2021-22 onwards) and **v5.0** (79th/80th Council, AY 2025-26
onwards), plus the FAT process manual. Four entries in the table Wave 2 recorded were
wrong, and one of them was implemented.

**The formula was inverted, and it is fixed.** §5.4 defined at-risk as
`max(mean − 2σ, 50)`. The regulation says **`min`**, in three places, all agreeing:
below 50 the pass bar _drops_ to `mean − 2σ`, and above 50 nobody at or above 50 fails
because the F-band student "will be awarded `E` grade and declared pass". I had written
`max` and asserted in a doc comment that it was VIT's own line, which is the worst kind
of wrong — it told a reader the rule had been checked. Fixed in `statistics.ts` and
`grading-bands.ts`; `PASS_FLOOR` became `PASS_BOUNDARY_CAP`, because the name was part
of the error.

**The other three corrections** (made in `wave-2.md` §5.1): theory weighting is
**CAM 60 + FAT 40**, not 30/70 — the 30/70 figure is VIT _Online_, a different
directorate, and the repo had cited it beside the Vellore regulations as if they
described the same programmes. Project courses have **no FAT**. And the table was
missing the regime rules entirely: relative grading applies only to theory and
lab-embedded theory with **> 10** students; ≤ 10, and every lab, project, soft-skills,
extra-curricular and NGCR course, is graded **absolutely**.

**RESOLVED — D1, and the answer is not one of the three options offered.** There are
two regimes, they are chosen institutionally by **(course category, headcount)**, they
share a letter set but not band widths, and each has its own pass line. So the question
was never "which banding does the platform use" but "which regime is this course, and
does the platform have the right to compute a letter at all". Both regimes are now
implemented and testable (`resolveGradingRegime`, `absoluteLetter`), which is what the
platform actually needed.

**The live defect: the exported letter is wrong under both regimes — REMOVED.** The
`letter` field is gone from `FinalGradeComputation`, the export contract, the
serializer and the UI table (`lib/lms-export/*`, `components/teacher-lms-export.tsx`).

It carried `letterGrade(percentage)` — `A/B/C/D/F`, no `E`, passing at 60 — reaching the
LMS export payload. Against VIT absolute that is wrong twice (`D` is 55–60, `E` is
50–55, pass is 50); against VIT relative those bands do not exist. **An exported letter
that disagrees with the result sheet is worse than no letter**, and it was already
shipping, so removal is the honest fix rather than a correction.

**It was not replaced, because it cannot be honestly computed yet.** Choosing between
the two regimes needs the course's **category**, and the schema has no `CourseCategory`
field — so the platform cannot tell a theory course from a lab, and therefore cannot
know which band set or pass line applies. Restoring a letter needs, in order: a
`CourseCategory` on the course, the cohort's published marks for `mean ± kσ`, and then
`resolveGradingRegime` + `absoluteLetter`/`gradeBandRanges`. The reasoning is recorded
on the type itself so the next reader does not re-add the old call.

**The same unbacked letter is still displayed in-app in five places**, and they are
_not_ changed here because they are product surfaces rather than records, and each needs
the same missing field:

| Site                                  | Shows                       |
| ------------------------------------- | --------------------------- |
| `lib/gradebook.ts:95` (`letterGrade`) | the source of all of them   |
| `components/student-view.tsx:160`     | the student's overall grade |
| `components/grade-badge.tsx:35`       | every grade badge           |
| `components/quiz-runner.tsx:337`      | the post-quiz grade         |
| `lib/analytics/cohort.ts:78`          | the histogram's A–F buckets |
| `lib/analytics/legacy.ts:61`          | mark-map bands              |

Each is defensible as a _rough in-app indicator_ and indefensible as a VIT letter. Either
they become percentages, or they carry a visible "not an official grade" marker — but
that is a product call, not a cleanup. What is certain is that none of them should be
exported or stored, which is now the case.

Three further holes the regulation does not close, so nothing should be built on them:
the `S`/`A` gap when `mean + 1.5σ < 90` (a mark at 88 satisfies neither row), whether
the `≥ 80` S-cap condition in v5.0 is the general S floor or only the cap case, and which
students count in the cohort (absentees, `N`-graded, withdrawn).

The tab shell, the item-analysis reader and the `subtopic` data exist. Missing: the
mastery aggregation, a contract schema, **a teacher-scoped materials reader** (the Wave
2 reader is student-only — `listMaterialsForStudent`), and an `offeringId` on the page's
props (`GenerationAssessmentSummary` has none). Purely additive, and it depends on D4.

---

## 8. Open questions carried into the slices

Eight questions the analytics dossier raised and could not settle from the code. They
were not recorded when it came back, which is itself a gap: each one changes a computed
number, so a slice that answers it silently would produce a page whose figures cannot be
reconciled with another page's. Listed here so they are decided rather than discovered.

| #      | Question                                                                                                                                                              | Why it matters | Recommended answer |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------ |
| **U1** | **RESOLVED — `Assessment.dueDate`.** Reinforced by the owner's rule that a mean is generated only after the due date.                                                 |
| **U2** | **RESOLVED — the week's own assessments**, not a running mean.                                                                                                        |
| **U3** | **RESOLVED — weighted, and the mechanism already existed.** See §9.                                                                                                   |
| **U4** | **RESOLVED — a separate "no published work" group**, never folded into the σ comparison.                                                                              |
| **U5** | **RESOLVED — only marks that are published _and_ past due.** See §9.                                                                                                  |
| **U6** | **RESOLVED — use VIT's own ≤ 10 rule; no new constant.** Below it the course is graded absolutely, so σ is never consulted. `resolveGradingRegime` already does this. |
| **U7** | **RESOLVED — published-gated**, matching B3/B5, so every card on a page describes one cohort.                                                                         |
| **U8** | **RESOLVED — dropped from this wave**, and it must not ship inert. Wiring it is its own slice.                                                                        |

**Two of these are the same question as D1**, one level down: U3 and U5 both ask _who is
in the cohort and what is its centre_. D1 settled which banding applies; it did not settle
which students the banding is computed over.

---

## 9. Course grading policy — the weights, the FAT gate, and what may enter a mean

Resolves U3, U5 and D5 together, because they were one question: _what combines into a
grand total, and which marks are allowed to contribute_.

**The mechanism already existed and was not being used.** `lib/lms-export/final-grade.ts`
computes a weighted grand total from a `FinalGradeConfig` of categories summing to 100,
each holding assessments with optional relative weights — and it already applies the
published-only rule and _excludes_ missing assessments rather than zero-filling them.
Two things were missing:

1. **Persistence.** The config was request-body only, so a teacher could pass weights to
   one export call and lose them. Weights are course configuration: it now belongs on the
   offering (`CourseOffering.gradingConfig`).
2. **A derivable default.** `defaultFinalGradeConfig` weights everything equally in one
   category — honest, but it does not express the CAT/FAT shape a VIT course has.

`lib/grading/policy.ts` supplies both, plus the FAT gate.

### The model

| Pool    | What it holds                                                                                                                                                          | Default weight |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **CAT** | every mini-assessment through the term, weighted **equally** unless the teacher pins explicit weights — so the relative weight follows how much assessed work there is | 40             |
| **FAT** | a **single** assessment at the end of the term                                                                                                                         | 60             |

**The default is CAT 40 / FAT 60, and it is a stored default rather than a constant —
deliberately.** VIT's FFCS regulations (v4.0 §9.1, v5.0) state the _opposite_ for theory:
CAM 60 + FAT 40, the continuous pool carrying the larger share. The classic VIT split is
CAT 40 + FAT 60. Both are real institutional configurations, so the number belongs to the
course, not to the code, and a teacher edits it at creation or during the term.

**The FAT is identified by due date**, because nothing in the schema marks one — there is
no `FAT` in `AssessmentType` and no `isFinal` flag. That is a heuristic and it is labelled
as one: an offering whose last-due assessment is not its final exam gets a wrong default,
and the teacher corrects it. A flag was not added instead because a course can legitimately
grade its final as several components, which the category model already expresses and a
single flag cannot.

### Which marks may enter a mean

`isMarkIncludedInMean` requires **two** conditions:

- **the due date has passed** — a mean taken mid-term must not contain an assessment
  students have not sat, and this is also what keeps a weekly point stable while its
  assessment is open; and
- **the mark is published** — unpublished stays _excluded_, never zero.

**"Exclude 0" is deliberately not implemented as "drop the value zero".** A student who
submitted and scored 0 has a real mark, and dropping it would inflate their average —
the same error as zero-filling, in the opposite direction, and equally silent. What is
excluded is a mark that _does not exist_: no submission, or not yet published. That is
the failure mode the rule is protecting against, and §8/U5 shows why it matters — treating
five unmarked students as zero drove a boundary from 38.01 to −23.52, which flags nobody
and makes the roster empty itself as marking gets under way.

### FAT eligibility

`evaluateFatEligibility` gates the final assessment on a **minimum CAT percentage**, and
returns **three** outcomes rather than a boolean:

| Outcome                 | Meaning                                                                        |
| ----------------------- | ------------------------------------------------------------------------------ |
| `eligible`              | the CAT pool is marked enough and the student is at or above the minimum       |
| `below-cat-minimum`     | judged, and the student is short — carries their percentage and the minimum    |
| `insufficient-cat-work` | **not judged.** Too little of the CAT pool is marked, so the platform abstains |

The third outcome is the point. Collapsing it into "ineligible" would tell a student they
cannot sit the exam when the truth is that their teacher has not finished marking — and it
is the same distinction `lib/student-assessments.ts` already draws between _not marked_ and
_marked but unreleased_.

**The minimum is 30%, supplied by the owner.** `DEFAULT_FAT_MINIMUM_CAT_PERCENT = 30`,
overridable per offering, and `null` still means "this course has no CAT gate" — which is
a different statement from "the gate is at zero".

### `CourseCategory` — the field that unlocked this

`Course.category CourseCategory?` is now on the schema (migration
`20260916170000_course_category`, additive and nullable), and the demo course is seeded
`THEORY`.

**Nullable, and null is not `THEORY`.** The platform cannot infer a course's kind from its
data, and guessing would silently put a laboratory course on relative bands — the failure the
column exists to prevent. So an unset category is a fifth absolute reason,
`category-unset`, with its own notice asking for it. That is the same treatment as missing
base metrics: withhold and explain rather than assume.

The enum is defined **once**, in Prisma. `lib/analytics/grading-bands.ts` re-exports it via a
type-only import, which is erased at build time, so that module stays pure and loadable from
a client component while the vocabulary has a single home.

The category lives on `Course` rather than `CourseOffering` because "what kind of course is
this" is a property of the course, not of a particular section or term.

**Two new readers/writers:**

| Surface                                                                          | Purpose                                                                                                                                       |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `getOfferingGradingRegime(user, offeringId)`                                     | gathers the category, the enrolment count and the students' published grand totals, and returns the decision with its notice, ready to render |
| `PATCH /api/teacher/courses/[courseId]/category` → `setCourseCategoryForTeacher` | the write path, without which the field could only ever be set by the seed and every course would permanently fall back to absolute           |

The write path's authorization is **teaches at least one offering of this course**, since the
field is on `Course` but a teacher owns _offerings_. A course they do not teach reports 404
rather than 403, so the endpoint never confirms another teacher's course exists — the same
convention the assessment release action uses. Clearing is deliberately not expressible by
omitting the field, because that is how a category gets wiped by a client that never knew
about it.

**Grand totals for the σ are one number per student**, computed from published `Grade` rows
with `publishedAt` set. Reading attempts instead would band a different population from the
one the grade sheet describes, and counting rows rather than students would band a cohort
several times the real size — both are pinned by tests.

### Which regime is actually used

`resolveRegimeForCourse({ category, enrolledCount, publishedTotals })` decides, and returns
the **notice** to render whenever the answer is absolute. Four outcomes:

| Outcome                              | When                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `relative`                           | theory or lab-embedded theory, > 10 enrolled, **and** ≥ 11 students with a published grand total |
| `absolute` / `non-theory-course`     | lab, project, soft-skills, extra-curricular or NGCR — permanently, at any size                   |
| `absolute` / `small-class`           | ≤ 10 students enrolled                                                                           |
| `absolute` / `awaiting-base-metrics` | the class qualifies, but too few marks are published **or** σ is 0                               |

**`awaiting-base-metrics` is the reason this function exists.** Relative grading needs the
cohort's own mean and σ, and σ computed from four marks is not a base. So the relative view
is **withheld rather than approximated**: the course falls back to absolute bands with a
warning that names the numbers — _"4 of the 11 published totals needed"_ — so a teacher can
see what is being waited on rather than wondering why the bands changed.

The minimum is `RELATIVE_MIN_MARKED_STUDENTS = 11`, deliberately the same constant as VIT's
class-strength threshold: the rule is a statement about how many students a banding needs,
and applying it to the _marked_ cohort rather than only the enrolled one is the same rule
read honestly.

**σ = 0 is also a fallback, and it was a real gap.** A cohort whose published totals are all
identical has no spread, so `gradeBandRanges` returns `null` and every band would collapse
onto the mean — leaving a caller with a "relative" regime and no bands to draw. It falls back
with its own explanation. This was found by running the scenarios, not by reasoning: the
first version returned `relative`, σ 0, and nothing renderable.

The categorical and size checks come **first**, because they are permanent facts about the
course — telling a 6-student lab it is "awaiting metrics" would imply it might switch later,
and it never will.

### Passing the course

A student passes when their **combined CAT+FAT total is at least 50%**, checked _after_
the CAT gate — a student who may not sit the FAT cannot have a grand total, so a high
total must not rescue them. `evaluateCourseOutcome` returns a four-way union:

| Outcome                    | Meaning                                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `pass`                     | gate cleared, total at or above 50                                                                                                        |
| `fail` / `below-pass-mark` | gate cleared, total short — carries the total                                                                                             |
| `fail` / `fat-ineligible`  | the CAT gate was not cleared, so the FAT cannot be sat                                                                                    |
| `not-judged`               | **not a failure.** Either too little of the CAT pool is marked (`insufficient-cat-work`) or the FAT has not been taken (`no-grand-total`) |

`not-judged` is the outcome that matters most in practice: mid-term, most students have a
part-marked CAT pool and no FAT, and reporting them as failures would be wrong for all of
them. It is the same distinction `lib/student-assessments.ts` already draws between
_not marked_ and _marked but unreleased_.

**The pass mark is inclusive — `>= 50` passes.** The rule was stated as "above 50%", and
read literally that is `> 50`, which would fail a student on exactly 50. VIT's absolute
Table-6 puts the `E` band at 50–55, inclusive of 50, so the inclusive reading is used and
the discrepancy is pinned by a test rather than assumed.

### One contract that cannot be enforced from inside

`catProgress` takes **one entry per CAT assessment**, unmarked ones included as
`included: false`. `totalCount` is the array length, so a caller who passes only the
marked assessments reports 100% completion from a part-marked pool, which clears the
insufficient-evidence guard and judges a student on evidence that does not exist. That is
a precondition the function cannot check, so it is documented on the function _and_
demonstrated by a test that asserts the wrong answer on purpose — the failure mode is
visible in the suite rather than only in prose.

### D5 is resolved BY this

There were three disagreeing "class averages". With a persisted config and one inclusion
rule there is now **one** definition: the weighted grand total over past-due published
marks, computed by `computeFinalGrade`. The dashboards, the analytics page and the at-risk
roster all read that, so they cannot disagree about the same class.
