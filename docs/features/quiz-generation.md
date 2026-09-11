# Feature: LLM quiz generation (Phase 2, pod 1)

Material-grounded multiple-choice question generation. A teacher supplies a topic
or lesson description; the system retrieves the relevant `MaterialChunk`s for
their own course/offering and drafts questions with misconception-targeting
distractors, a subtopic tag, and a difficulty value. Drafts stay hidden from
students until an explicit teacher publish action.

Branch: `feat/quiz-generation` (off `dev` at `d5f949b`).

## What it does

1. A teacher picks one of their own quiz assessments and describes a topic.
2. `lib/vector` retrieves the top course chunks for that topic, scoped to the
   assessment's course and offering.
3. `lib/llm` is asked, with a versioned prompt (`quiz-generation-v1`), for
   exactly N questions; each must have 4-5 options, exactly one correct answer,
   a subtopic, a 1-5 difficulty, and a rationale per option that names the
   misconception it targets.
4. The response is parsed and validated strictly (fail closed) and persisted to
   `Question` / `QuestionOption` as unpublished `DRAFT`s.
5. The teacher reviews, edits, and publishes. Publishing is the only action that
   makes a question visible to learners, and it freezes the question from edits.

## New files

### Library — `lib/quiz-generation/`

| File           | Responsibility                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------- |
| `prompt.ts`    | `buildQuizGenerationPrompt` and `QUIZ_GENERATION_PROMPT_VERSION` (`quiz-generation-v1`).           |
| `parsing.ts`   | Strict JSON extraction, zod validation, and semantic checks (counts, one correct, no duplicates).  |
| `state.ts`     | Draft/published state in `Question.metadata`; the reader fails closed to `DRAFT`.                  |
| `authz.ts`     | `resolveTeacherStaffId`, `teacherOwnsAssessment`, `loadOwnedQuizAssessment`.                       |
| `retrieval.ts` | Offering/course-scoped chunk retrieval over `lib/vector`.                                          |
| `service.ts`   | Generate drafts, list, edit, and publish; every mutation is transactional and audited.             |
| `serialize.ts` | Owner view (with key) and student view (keyless).                                                  |
| `grading.ts`   | Keyless delivery + server-authoritative grading via the shared `scoreQuiz` kernel.                 |
| `errors.ts`    | `QuizGenerationError` (status-carrying), `QuizGenerationParseError` (502), validation error (400). |
| `http.ts`      | Maps thrown errors to JSON without leaking database internals (bug-fix run 1, BUG-4).              |
| `index.ts`     | Barrel export.                                                                                     |

### Contracts — `lib/contracts/quiz-generation.ts`

Request/response schemas for generate, edit, publish, the owner list, and the
learner delivery view, plus the option-count and difficulty bounds. The delivery
routes reuse `quizGradeRequestSchema` / `quizGradeResponseSchema` from
`lib/contracts/quiz.ts` so the server-authoritative grade path has one definition.

### API

| Method + path                                    | Purpose                                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| `POST /api/teacher/quiz/generate`                | Retrieve material and draft N questions (never publishes).              |
| `GET /api/teacher/quiz/[assessmentId]`           | Owner view of drafts + published, with the key and counts.              |
| `PATCH /api/teacher/quiz/questions/[questionId]` | Edit an unpublished draft (prompt, subtopic, difficulty, options).      |
| `POST /api/teacher/quiz/publish`                 | Explicitly publish one or more drafts (idempotent, audited).            |
| `GET /api/quiz/[assessmentId]/questions`         | Learner delivery: published questions only, with no answer-key fields.  |
| `POST /api/quiz/[assessmentId]/grade`            | Server-side grading; the key appears only in this post-submission view. |

All teacher routes use `requireRole("teacher")` plus object-level ownership.
The learner routes use `requireRole("student", "teacher", "admin")` and an
enrolment/ownership check. Students have no route that reaches generation.

### UI

- `app/(dashboard)/teacher/quiz-generator/page.tsx` — Server Component that
  loads the teacher's quiz assessments and the first one's questions server-side.
- `components/teacher-quiz-generator.tsx` — client workspace: generate, edit
  options/rationales, pick the correct option, save a draft, publish one or all.
  No fetch-on-mount effect, so the pod adds no `react-hooks/set-state-in-effect`
  warnings.

## How retrieval and generation work

`retrieveMaterialChunks(scope, topic, { provider, limit })` calls
`searchMaterialChunks` from `lib/vector` with the assessment's `courseId`, then
drops any hit whose `offeringId` belongs to a different offering. Course-level
material (`offeringId === null`) is shared; another offering's material is never
returned, so a teacher cannot pull from a colleague's class even when it shares
the course.

`generateQuizDraftsForTeacher` then:

1. Loads the owned assessment and rejects a non-`QUIZ` type.
2. Retrieves chunks; zero chunks is a 409 (there is nothing to ground on).
3. Builds the `quiz-generation-v1` prompt and calls the injected `LlmProvider`
   (`task: "quiz-generation"`, `json: true`, temperature 0.4).
4. Parses with `parseGeneratedQuestions`, which rejects malformed JSON, a
   non-array `questions`, the wrong question count, an option count outside 4-5,
   zero or multiple correct options, duplicate option wording, duplicate prompts,
   an out-of-range difficulty, or a missing distractor rationale (HTTP 502).
5. Persists each question and its options in one transaction, appending after the
   current maximum `order`, with `metadata.quizGeneration` describing the state,
   prompt version, model, generating timestamp, and source chunk ids. Each write
   carries a `quiz_question.draft_created` `AuditLog` row in the same transaction.

`questionCount` omitted defaults to 5; the acceptance requirement is that N
requested equals N returned, which the strict count check enforces.

## How drafts stay unpublished

`prisma/schema.prisma` is frozen and `Question` has no publish column, so state
is stored in the existing `Question.metadata` JSON under `quizGeneration.state`.
The reader (`readQuestionState`) fails closed: a missing, malformed, or foreign
metadata value is treated as `DRAFT`. Only `publishGeneratedQuestionsForTeacher`
writes `PUBLISHED`, and it also freezes the row from edits (409). Publishing
validates that each question still has 4-5 options and exactly one correct answer
before flipping the state, so a corrupt or hand-edited draft cannot be exposed.

## Answer-key boundary (evidence)

- `serializeQuestionForStudent` returns only `{ id, order, text }` per option and
  omits `explanation`; `serializeQuestionForOwner` is the only serializer that
  includes `isCorrect`, `rationale`, and `explanation`.
- The learner delivery route uses the student serializer, so its payload contains
  no answer-key field. `tests/quiz-generation-state.test.ts` asserts the exact
  option key set and that the JSON has no `isCorrect` / `rationale` /
  `explanation`; `tests/quiz-generation-pipeline.test.ts` asserts the same on the
  real delivery payload.
- Grading is server-authoritative and reuses the existing `scoreQuiz` kernel from
  `lib/quiz-scoring.ts` (the same kernel `lib/quiz-grading.ts` uses). The
  client sends only `{ questionId, selectedIndex }`; `scoreQuiz` derives
  `correctIndex` / `correctText` server-side and returns them only in the graded
  response. The pipeline test asserts the learner payload has no key before
  submission and that `correctIndex` appears only afterwards.

## Authorization

- Every teacher route is `requireRole("teacher")` and then ownership-checked via
  `loadOwnedQuizAssessment` (creator or offering teacher). A non-owner teacher
  gets 403 on generate, list, edit, and publish.
- A student who calls the generation service directly is rejected with 403 before
  any ownership lookup; no student route reaches it.
- Learner delivery and grading require enrolment (student) or ownership
  (teacher) or admin.

## Tests

| File                                     | Coverage                                                                                                                                                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/quiz-generation-prompt.test.ts`   | Topic/excerpts/count present; misconception and one-correct instructions; version constant.                                                                                                                       |
| `tests/quiz-generation-parsing.test.ts`  | Fenced/valid JSON; malformed and empty responses; wrong question count; wrong option counts (3 and 6); zero/two correct; duplicates; difficulty range; missing rationale.                                         |
| `tests/quiz-generation-state.test.ts`    | Fail-closed state reads; draft→published metadata; key present in the owner view and absent from the student view.                                                                                                |
| `tests/quiz-generation-pipeline.test.ts` | DB-backed: real pgvector retrieval, drafting, invisible-while-draft, publish, edit-then-freeze, grading discloses the key only post-submission, non-owner and student 403s, no-material 409, publish fail-closed. |

## Gates

- `npm run verify` — 0 errors, 9 pre-existing warnings.
- `DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:59999/ci" SESSION_SECRET=x LLM_PROVIDER=mock npm run build` — exit 0.
- `TEST_DATABASE_URL=… npm test` — 22 files, 127 tests passed (was 18/98).

## Shared files touched

- `lib/contracts/index.ts` — one `export * from "./quiz-generation"` line.
- `components/role-routes-menu.tsx` — one "Quiz Generator" teacher nav entry.
- `next.config.mjs` — widen Turbopack's root only when `node_modules` is a
  symlink pointing outside the project (the disk-saving worktree layout). A
  normal checkout with a real `node_modules` is unchanged, so CI is unaffected.
- `CHANGELOG.md` — one `[Unreleased]` line.

`prisma/schema.prisma`, `prisma/migrations/**`, `package.json`, and
`package-lock.json` are untouched.

## Deferred / known limits

- **The mock provider does not synthesize questions.** `LLM_PROVIDER=mock`
  returns a generic JSON envelope, so a real generation against the mock fails
  parsing (502) unless a response is pinned; tests inject a fake provider. A
  deterministic offline generator for manual demos is a possible follow-up.
- **No rich diff UI.** The generator shows options inline; a side-by-side
  draft-vs-material review is Phase 3 polish.
- **Publishing is per-question.** There is no scheduled/"publish at" concept.
- **Generated questions are not wired into the legacy `Quiz`/`QuizQuestion`
  import store**, so the existing `/api/quiz/grade` route does not see them. The
  pod exposes its own server-authoritative grade route over the same kernel.
- **Retrieval quality** is not evaluated here; a labelled retrieval/agreement
  benchmark remains Phase 3 work.
- **No persistence of the raw model response** for a generation run (unlike
  `AIGradeSuggestion`); only the question rows and `AuditLog` entries are kept.
