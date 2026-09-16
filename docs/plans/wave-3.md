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
