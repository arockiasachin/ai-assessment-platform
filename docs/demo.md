# Phase 4 — the seeded demo course

`prisma/seed-demo.ts` creates **one coherent course** that exercises the whole product spine in a
single run:

```text
teacher authors material → AI generates a quiz → student takes and submits
→ server scores it → AI/rubric produces a suggestion → teacher review queue
→ a human publishes → analytics + LMS export reflect it
```

This is the missing proof the [docs README](./README.md#end-to-end-proof-on-one-real-course-is-phase-4-work)
called out: every Phase 2 pod had route/service tests, but nothing had ever been run through as one
continuous flow. The demo also closes the seed-coverage gap — the old `prisma/seed.ts` left
seventeen models with **zero** rows.

Run it with the `prisma:seed:demo` npm script. It is **deterministic** (fixed ids, mock provider) and
**idempotent** (a second run replaces the demo graph instead of duplicating or crashing).

## What the demo creates

Everything is scoped to the course `DEMO-MATH-101 — Algebra Foundations` and the teacher
`demo.teacher@school.edu`. Counts are from the seed's own summary output.

| Area          | Entities                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| People        | 1 teacher + 1 second teacher (for the ownership-scoping check) + 5 students, with `StaffProfile`/`StudentProfile`, `Enrollment` rows and 2 `ClassRoom`s            |
| Course        | 1 `Course`; 2 `CourseOffering`s (an active Term-1 2026 offering and a **completed** 2025 offering so course ratings have a rateable course)                        |
| Material      | 2 `Material`s with real pgvector embeddings and **9 `MaterialChunk`** rows written through `lib/vector/embed.ts` (raw SQL, never a hand-rolled insert)             |
| Quiz          | 1 `Assessment` (QUIZ, 20 marks, 5 attempts) with **4 generated `Question`s + 16 `QuestionOption`s**, published via `Question.status`/`publishedAt`/`publishedById` |
| Quiz attempts | **3 `QuizAttempt` + 12 `QuizResponse`** rows, scored server-side by `lib/quiz-scoring.ts`                                                                          |
| Grading       | **6 `AIGradeSuggestion`** rows (3 deterministic quiz auto-scores + 3 rubric criteria), **4 `GradeReview`s**, of which **3 are `PENDING`/`NEEDS_REVIEW`**           |
| Grades        | **4 published `Grade`s** (1 quiz accepted through the review queue + 3 group-project manual marks), each with its `AuditLog` row; drafts remain unpublished        |
| Rubric        | 1 `Rubric` (30 points) + **3 `RubricCriterion`s** on the descriptive assessment, plus a student `Submission` and a second unevaluated submission                   |
| Code task     | 1 CODE `Assessment` + **1 `CodeTask`** + **3 `TestCase`s** + 1 `TestRun`                                                                                           |
| Groups        | 1 `Group` ("Team Alpha"), **3 `GroupMember`s**, **6 `PeerEvaluation`s** (all five CATME dimensions), **5 `ContributionEvent`s**, **2 `Milestone`s**                |
| Ratings       | **3 `CourseRating`s** on the completed offering (average 4.33)                                                                                                     |
| LTI           | 1 `LtiRegistration` (no secret stored, only a `privateKeyRef`) + its `LtiUserMapping`                                                                              |

All seventeen previously-unseeded models now have rows: `Material`, `MaterialChunk`, `Rubric`,
`RubricCriterion`, `AIGradeSuggestion`, `GradeReview`, `CodeTask`, `TestCase`, `Group`,
`GroupMember`, `PeerEvaluation`, `QuizAttempt`, `QuizResponse`, `LtiRegistration`, `CourseRating`,
`ContributionEvent`, `Milestone`.

The product invariant is visible in the data: **the only published grades come from explicit teacher
actions** (`submitReviewDecision({ action: "accept" })` and `recordManualMark`), and each has an
`AuditLog` row. Every model-generated score is an `AIGradeSuggestion` on an unpublished draft.

## Run it from an empty database

The database name **must contain `test`**; `tests/helpers/env.ts` refuses anything else. Never point
this at the developer `assessment_dashboard` database.

```bash
cd .worktrees/demo-course

# 1. Create a dedicated database (pgvector is required; the baseline migration
#    runs `CREATE EXTENSION vector`).
psql "postgresql://<user>@127.0.0.1:5432/postgres" \
  -c "CREATE DATABASE assessment_demo_test;"

# 2. Point at it and apply the committed migration history.
export DATABASE_URL="postgresql://<user>@127.0.0.1:5432/assessment_demo_test"
export SESSION_SECRET="demo-secret"      # any value; production requires a real one
export LLM_PROVIDER=mock                 # offline + deterministic
npx prisma generate
npx prisma migrate deploy

# 3. Create the demo course.
npm run prisma:seed:demo

# 4. Serve it (dev or production).
npm run dev                              # http://localhost:3000
# or: npm run build && npm start
```

Logins (all password `demo1234`):

| Role                   | Email                      |
| ---------------------- | -------------------------- |
| Teacher (owns)         | `demo.teacher@school.edu`  |
| Teacher (no offerings) | `demo.teacher2@school.edu` |
| Student 1              | `demo.student1@school.edu` |
| … Student 5            | `demo.student5@school.edu` |

Re-running step 3 is safe: it deletes the previous demo graph and recreates it.

## What each screen should show

### Teacher

| Route                      | Expected content from the demo data                                                                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/teacher`                 | 5 students, class average, "Top performer: Demo Student One".                                                                                                                       |
| `/teacher/quiz-generation` | "Linear Equations Check-in (AI-generated)" with 4 published questions (provenance from the mock provider + retrieved chunk ids).                                                    |
| `/teacher/reviews`         | The pending queue: student 2 and 3's quiz attempts plus student 1's three per-criterion rubric suggestions on "Describing a linear model (rubric-graded)".                          |
| `/teacher/groups`          | "Team Alpha" with 3 members, both milestones, peer-evaluation adjustment factors, free-rider/contribution evidence.                                                                 |
| `/teacher/code-tasks`      | "Fix the slope calculator" with 3 active test cases and 1 test run.                                                                                                                 |
| `/teacher/analytics`       | Item analysis for the quiz over 3+ real attempts, cohort distribution, and the honest "insufficient data" notes for small samples.                                                  |
| `/teacher/export`          | Weighted final grades for the active offering; published quiz + group marks counted, the unpublished rubric draft **excluded** and listed under `excludedUnpublishedAssessmentIds`. |
| `/teacher/reports`         | Course ratings report for the completed offering: 3 ratings, average 4.33.                                                                                                          |

### Student

| Route                       | Expected content                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `/student`                  | Student 1's average and grades.                                                                   |
| `/student/quizzes`          | "Linear Equations Check-in (AI-generated)", 4 questions, attempt history. No answer key anywhere. |
| `/student/courses`          | "Algebra Foundations" enrollment.                                                                 |
| `/student/assessments`      | 4 assessments including the descriptive and group project.                                        |
| `/student/peer-evaluation`  | The five CATME dimensions for teammates.                                                          |
| `/student/code-submissions` | "Fix the slope calculator" and the seeded test run.                                               |

## The automated end-to-end proof

`tests/demo-spine.test.ts` seeds the demo itself (so it is self-contained on the shared test
database) and then walks the spine. Run it alone:

```bash
TEST_DATABASE_URL="postgresql://<user>@127.0.0.1:5432/assessment_demo_test" \
  LLM_PROVIDER=mock npx vitest run tests/demo-spine.test.ts
```

It asserts (10 tests, all passing):

1. every previously-uncovered model has rows and the seed is idempotent (`seedDemo()` twice returns
   the same summary);
2. the quiz questions resolve as **published** (real `status`/`publishedAt`/`publishedById`
   columns), the teacher payload carries `correctOptionId`, and the **student payload contains no
   key** (`isCorrect`, `correctOptionId`, `correctIndex`, `rationale`, `explanation`);
3. submitting an attempt scores server-side, writes `QuizAttempt` + one `QuizResponse` per question,
   and produces a `GradeReview` whose `Grade` is **not published**;
4. a human `accept` publishes the grade with `approvedById` set, and a deliberately worse second
   attempt leaves `points` and `publishedAt` unchanged (exactly one `grade.published` audit row);
5. the descriptive rubric path produces one suggestion per criterion, each with a rationale, quoted
   evidence, confidence, and a ceiling bounded by its criterion;
6. `listReviewQueueForTeacher` returns the pending items for the owning teacher and nothing for a
   teacher who owns none of them;
7. LMS export reflects the published grades and **excludes** unpublished ones for both the teacher
   and the student view;
8. item analysis runs over the seeded attempts and honestly withholds difficulty/discrimination
   below the documented sample minimum;
9. course ratings aggregate for the completed offering;
10. no grade is published except through a recorded human action (every published `Grade` is
    attributed, and the published-grade count equals the human publish-audit count).

## Browser verification

Performed against a real Chromium tab, with the app started as `next dev` on port 3100 against the
demo-seeded database (`DATABASE_URL=…/assessment_demo_test`, `SESSION_SECRET=…`,
`LLM_PROVIDER=mock`). Browser automation was available and used; a console capture hooked
`console.error`/`console.warn`, `window.onerror`, and `unhandledrejection` before each navigation.

**Result:** every listed teacher and student route returned HTTP 200, rendered its demo data, and
showed **no 500s and no React "Hydration failed" errors**. The student quiz payload exposed no answer
key. Two findings are worth recording:

1. **A real hydration bug was found (and fixed).** `/student/quizzes` raised
   `Hydration failed because the server rendered text didn't match the client` at
   `components/student-quiz-attempts.tsx` because a date was formatted with a bare
   `new Date(...).toLocaleString()` — the Node server rendered `11/30/2026, 1:30:00 PM` (its default
   `en-US` locale) while the browser rendered the user's locale (`30/11/2026, 13:30:00`). Both call
   sites in that component, and the same pattern in `components/student-code-submissions.tsx`, now
   use an explicit `en-US` locale via a shared local `formatDateTime` helper. Re-verified in the
   browser: the server HTML and the hydrated DOM now both read `Nov 30, 2026, 01:30 PM`, with zero
   hydration errors on `/student/quizzes`, `/student/code-submissions`, `/teacher/reviews`, and
   `/teacher/analytics`.
2. **`127.0.0.1` does not hydrate in `next dev`; `localhost` does.** Next.js dev refuses to serve its
   dev chunks cross-origin, so a tab opened at `http://127.0.0.1:3100` received the server HTML but
   never attached React (and logged `Blocked cross-origin request to Next.js dev resource`). This is
   a dev-server/origin behaviour, not a product defect; use `http://localhost:3100` locally, and it
   does not affect a production build. The `curl` checks below used `127.0.0.1` and, as expected,
   only confirmed server rendering.

The only console noise during verification was an attribute mismatch on `data-cursor-ref`, an
attribute injected by the browser-automation snapshot tooling itself; it does not occur without that
tooling. All other observed console output was clean.

### Server-rendered route check (curl, same session)

Login through the real API (`POST /api/auth/login`) and GET each route:

| Route                                                                                                                                                             | Status |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `/teacher`, `/teacher/quiz-generation`, `/teacher/reviews`, `/teacher/groups`, `/teacher/code-tasks`, `/teacher/analytics`, `/teacher/export`, `/teacher/reports` | 200    |
| `/student`, `/student/quizzes`, `/student/courses`, `/student/assessments`, `/student/resources`, `/student/events`, `/student/peer-evaluation`                   | 200    |

`POST /api/student/quiz-attempts` returned a payload whose questions carry only
`id`/`order`/`prompt`/`points`/`options[{id, order, text}]` — no `isCorrect`, `correctOptionId`,
`correctIndex`, or `rationale`. Screenshots of `/teacher/reviews` and `/student/quizzes` were
captured during browser verification.

## Limitations and honest caveats

- The demo proves **composability**, not scale or grading quality: the mock provider and a five-student
  cohort are deliberately small.
- The rating rows are written directly by the seed because `lib/course-ratings.ts` is a `server-only`
  module that cannot be imported by the `tsx` CLI; the read path
  (`getTeacherRatingsReport`) is exercised by the spine test.
- The LTI dry run needs real `LTI_*` environment values, so the seed only persists the non-secret
  `LtiRegistration`/`LtiUserMapping`; the offline dry-run payload builders are covered by their own
  tests.
- `next dev` on `127.0.0.1` does not hydrate (see above).
