# Feature: LLM quiz generation (Phase 2, pod 1)

A teacher supplies a topic or lesson description; the system retrieves the most
relevant chunks of their own course material and generates multiple-choice
questions with credible, misconception-targeting distractors, tagged by subtopic
and difficulty. Generated questions are **drafts** until the teacher explicitly
publishes them.

Branch: `p2/quiz-generation`.

## Goal and product rules

This pod implements product-spec §1 (quiz generation) and keeps the two
non-negotiable rules it touches intact:

- **Generated questions are drafts until the teacher publishes them.** Nothing in
  the generation path sets a published state.
- **Grading stays server-authoritative.** Correct answers live only in
  `QuestionOption.isCorrect` on the server; there is no client-side correctness
  logic anywhere in this pod.

## API surface

All routes are `requireRole("teacher")` **plus** an object-level ownership check
(`Assessment.createdById === staffId` or `offering.teacherId === staffId`).

| Method + path                                     | Input                                                                                                                | Output                                                                                               |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /api/teacher/quiz-generation`                | —                                                                                                                    | `{ success, assessments: GenerationAssessmentSummary[] }` (own assessments + draft/published counts) |
| `GET /api/teacher/quiz-generation?assessmentId=`  | query                                                                                                                | `{ success, questions: GeneratedQuestionResponse[] }` (drafts and published)                         |
| `POST /api/teacher/quiz-generation`               | `{ assessmentId, topic, questionCount (1-20), difficulty (easy\|medium\|hard\|mixed), subtopics?, retrievalLimit? }` | `{ success, retrieval, questions: GeneratedQuestionResponse[] }` — new **unpublished drafts**        |
| `GET /api/teacher/quiz-generation/[questionId]`   | path                                                                                                                 | `{ success, question }` — teacher-authoring view                                                     |
| `PATCH /api/teacher/quiz-generation/[questionId]` | `{ prompt?, explanation?, subtopic?, difficulty?, points?, options? }`                                               | `{ success, question }` — draft only; published questions return 409                                 |
| `POST /api/teacher/quiz-generation/publish`       | `{ assessmentId, questionIds? }` (omit ids to publish every draft)                                                   | `{ success, published, alreadyPublished }`                                                           |

Error mapping is the shared convention: domain errors keep their status, zod
errors are 400, database errors are logged and reduced to a generic 500 (bug-fix
run 1, BUG-4).

## How retrieval works

`lib/quiz-generation/retrieval.ts` calls `searchMaterialChunks` from
`lib/vector/search.ts` (pgvector cosine search over `MaterialChunk`) in two
tiers, then merges and dedupes by `chunkId`, keeping the highest similarity:

1. chunks attached to the teacher's own `offeringId`, and
2. course-wide chunks (`courseId`, no offering).

The `(courseId, offeringId)` scope is read from the **owned assessment**, never
from the request body, so a teacher can never point retrieval at another
teacher's material. Only chunk text and material titles leave the module; raw
vectors never do.

## How generation works

`lib/quiz-generation/generation.ts`:

1. Parses the request, resolves the owned assessment, retrieves material.
2. Builds the versioned prompt (`buildQuizGenerationPrompt`,
   `QUIZ_GENERATION_PROMPT_VERSION = "quiz-generation-v1"`). The system message
   requires 4-5 options, **exactly one** correct answer, a subtopic tag, and a
   difficulty in `[0, 1]`, and explicitly instructs the model that every
   distractor must be "the answer a student with a specific, common
   misunderstanding would choose" with a rationale naming that misunderstanding.
3. Calls the provider with `task: "quiz-generation"`, `json: true`, temperature 0.
4. Validates the response with `parseGeneratedQuestions`, which rejects malformed
   JSON, a missing question array, the wrong option count, zero or multiple
   correct answers, duplicate option text, a missing subtopic, an out-of-range
   difficulty, and a shortfall against the requested count (502).
5. Persists the questions and their options in one transaction with per-question
   `AuditLog` rows (`quiz_question.generated`), at the next free
   `Question.order` values.

The offline `mock` provider synthesizes a deterministic, schema-valid quiz for
the `quiz-generation` task, so the full retrieval → generation → draft pipeline
runs end to end with `LLM_PROVIDER=mock` and with no network.

## Draft-vs-published state

`prisma/schema.prisma` is frozen and `Question` has no publish column, so the
state lives in the existing `Question.metadata` JSON field
(`lib/quiz-generation/metadata.ts`):

```json
{
  "generator": "quiz-generation",
  "generationStatus": "draft",
  "promptVersion": "quiz-generation-v1",
  "model": "...",
  "provider": "...",
  "generationId": "...",
  "topic": "...",
  "sourceChunkIds": ["..."],
  "createdByStaffId": "..."
}
```

Only `POST /api/teacher/quiz-generation/publish` sets
`generationStatus: "published"` (with `publishedAt` and `publishedByStaffId`) and
writes a `quiz_question.published` audit row. Publication re-checks server-side
that each question has exactly one correct option before its state flips.
Published questions are immutable (`PATCH` → 409). A question without this
metadata marker is never treated as a generated draft.

## Answer-key handling

- The answer key is `QuestionOption.isCorrect` and is read only on the server.
- `serializeQuestionForStudent` emits no key, no provenance, and no draft state.
  A test asserts the serialized student payload contains neither
  `correctOptionId` nor `isCorrect`.
- `serializeQuestionForTeacher` (the authoring view, owner only) includes
  `correctOptionId` so the teacher can inspect and edit a draft. This mirrors the
  rubric pod's rule that rubric internals are visible to the owning teacher only.
- `lib/quiz-generation/grading.ts` reuses the existing server-authoritative
  kernel: it projects generated `Question`/`QuestionOption` rows into
  `ScorableQuizQuestion` and calls `scoreQuiz` from `lib/quiz-scoring.ts`. There
  is no client-side correctness path.

## Tests

| File                                       | Coverage                                                                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/quiz-generation-prompt.test.ts`     | Versioning, determinism, distractor instruction, topic/count/difficulty/subtopic, source grounding.                                                                                              |
| `tests/quiz-generation-parsing.test.ts`    | Fenced JSON, bare arrays, malformed JSON, missing array, wrong option counts, zero/two correct, duplicates, subtopic/difficulty bounds, requested count.                                         |
| `tests/quiz-generation-grading.test.ts`    | Server-key scoring, unanswered handling, refusal to grade a question without a correct option.                                                                                                   |
| `tests/quiz-generation-route-auth.test.ts` | Route-level: anonymous 401, student 403 before the service runs, teacher 200, malformed body 400.                                                                                                |
| `tests/quiz-generation-pipeline.test.ts`   | DB-backed: retrieval scoping, draft persistence + audit, deterministic offline generation, publish state machine, edit validation, non-owner/student 403, malformed model output writes nothing. |

## Shared files touched

- `lib/contracts/index.ts` — one line: re-exports the new pod contract.
- `lib/llm/providers/mock.ts` — deterministic quiz synthesis for
  `task === "quiz-generation"` (other tasks unchanged).
- `components/role-routes-menu.tsx` — one teacher nav entry ("Quiz AI").

`prisma/schema.prisma`, `prisma/migrations/**`, `package.json`, and
`package-lock.json` are unchanged.

## Deferred items and limits

- **Student delivery/grading routes for the `Question` model are not part of this
  pod.** `gradeGeneratedQuiz` is the server-side reuse point; wiring it to a
  student-facing route with enrollment checks belongs to the quiz-grading pod.
- **HTML generated by react server components** — the teacher review page renders
  the correct option in the authoring teacher's browser (that is the point of
  review). "Never reaches a client" is enforced for the student-facing
  serialization and for all non-owner callers.
- **Answer-key disclosure after submission** follows the existing product rule:
  a student learns the correct answer only from the post-submission grading
  response, not from any generation/read payload.
- **Draft state is convention-based** (`Question.metadata`). A future migration
  could promote `generationStatus`/`publishedAt` to real columns once the schema
  is unfrozen; the service boundary would not change.
- **Prompt quality is not yet proven against real models.** The mock provider
  makes the pipeline offline-testable; a human-labeled fixture set and a
  distractor-quality rubric remain a Phase 3 deliverable.
- **No bulk regenerate.** Re-running generation appends a new batch of drafts; it
  does not supersede a previous batch.
- `retrievalLimit` defaults to 8 (max 20) chunks; there is no reranking step.
