# Phase 4 — Legacy quiz store retirement (`Quiz` / `QuizQuestion`)

Retires the last duplicate store from the schema unfreeze list. The JSON quiz
import now writes the modern `Question` / `QuestionOption` spine, every reader
was migrated, and the legacy tables were dropped after a repo-wide reference
check.

## Hypothesis verdict: **partly REFUTED**

The brief hypothesised that the legacy store was _write-only plus an admin
explorer read_, and therefore that an imported quiz "creates questions that
nothing can grade". The token grep behind that hypothesis was incomplete. Two
relation-based readers were missed because they reach the models through
`assessment.quiz` rather than the literal model name:

- **`lib/quiz-grading.ts` grades the legacy store.** `gradeQuizSubmission` loaded
  `quiz: { questions: { … optionsJson, correctIndex } }` and scored it with the
  shared `scoreQuiz` kernel. It is exposed at `POST /api/quiz/grade`
  (`app/api/quiz/grade/route.ts`) and called by `components/quiz-runner.tsx`
  (`components/quiz-runner.tsx:95`) from the `/quiz` page.
- **`lib/gradebook-db.ts` reads the legacy store for its `quizzes` payload.**
  Both the teacher and student gradebook payloads `include: { quiz: { include:
{ questions } } }` and projected `optionsJson` into the key-free `quizzes`
  array consumed by `components/gradebook-provider.tsx` / `quiz-runner.tsx`.

So the legacy store **was** gradeable — by a second, transient grader that
persists nothing. What is true, and is the real defect: the _modern_ pipeline
(`lib/quiz-generation/grading.ts` + `lib/quiz-attempts/**`, surfaced at
`/student/quizzes`) reads only `Question` / `QuestionOption`, and
`createQuizFromImportForSessionUser` wrote only `Quiz` / `QuizQuestion`. An
imported quiz therefore appeared in the quiz center with `questionCount: 0` and
`canStart: false ("no questions yet")`, was never delivered, and never reached
the audited `Grade` pipeline. The retirement below closes that gap and also
removes the duplicate grader.

## Reference check before the drop

Command (run from the worktree root):

```bash
rg -n '\b(prisma|tx|db)\.(quiz|quizQuestion)\.' app lib components prisma
rg -n 'assessment\.quiz|\bquiz:\s*\{' app lib components prisma
```

Output (before this change):

```
prisma/seed.ts:33:  await prisma.quizQuestion.deleteMany()
prisma/seed.ts:34:  await prisma.quiz.deleteMany()
prisma/seed.ts:634:    const quiz = await prisma.quiz.create({
prisma/seed.ts:641:      await prisma.quizQuestion.create({
lib/gradebook-db.ts:777:    const quiz = await tx.quiz.create({
lib/gradebook-db.ts:783:    await tx.quizQuestion.createMany({
app/(dashboard)/admin/data/page.tsx:100:    prisma.quiz.findMany({ ... })
app/(dashboard)/admin/data/page.tsx:101:    prisma.quizQuestion.findMany({
app/(dashboard)/admin/data/page.tsx:129:      prisma.quiz.count(),
app/(dashboard)/admin/data/page.tsx:130:      prisma.quizQuestion.count(),
app/api/auth/seed/route.ts:704:      (await prisma.quiz.findUnique({ ... }))
app/api/auth/seed/route.ts:705:      (await prisma.quiz.create({ ... }))
app/api/auth/seed/route.ts:707:    const questionCount = await prisma.quizQuestion.count({ ... })
app/api/auth/seed/route.ts:709:      await prisma.quizQuestion.createMany({

lib/quiz-grading.ts:35:  quiz: {
lib/quiz-grading.ts:110:      quiz: {
lib/quiz-grading.ts:122:  if (assessment.type !== "QUIZ" || !assessment.quiz) {
lib/quiz-grading.ts:133:  const questions: ScorableQuizQuestion[] = assessment.quiz.questions.map(...
lib/gradebook-db.ts:129:            quiz: {
lib/gradebook-db.ts:295:                  quiz: {
```

The second grep is the load-bearing one: the literal-token grep alone found only
the seeds, the admin explorer and the importer, which is exactly the mistaken
"write-only" conclusion. Every match above was migrated before the drop.

## Post-retirement reference check

```bash
rg -n '\b(prisma|tx|db)\.(quiz|quizQuestion)\.' app lib components prisma   # (no matches)
rg -n 'assessment\.quiz|\bquiz:\s*\{' app lib components prisma             # only quizAttempts / quizQuestionCount
rg -n '^model (Quiz|QuizQuestion)\b|^\s+quiz\s+Quiz\?' prisma/schema.prisma  # (no matches)
```

Remaining `QuizQuestion` tokens are **not** the Prisma model:

- `lib/gradebook.ts:52` — `export type QuizQuestion`, the client-safe
  `{ id, prompt, options }` view type (deliberately has no `correctIndex`).
- `lib/gradebook-db.ts:110` — a doc comment referring to that type.

`rg 'assessment\.quiz'` now only matches `assessment.quizAttempts` (the modern
`QuizAttempt` model) and the UI field `assessment.quizQuestionCount`; there is no
`assessment.quiz` relation left.

## What writes the modern store now

| Entry point                                                                           | Change                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/gradebook-db.ts` `createQuizFromImportForSessionUser` (`POST /api/teacher/quiz`) | Writes one **published** `Question` (`status: "published"`, `publishedAt`, `publishedById` = importing staff) per imported question with `QuestionOption` rows (`isCorrect` from the resolved `correctIndex`/`correctAnswerId`), `points` from each question's `marks`. Requires the body's `offeringId`. |
| `app/api/auth/seed/route.ts`                                                          | Dev seed writes published modern questions attributed to the offering teacher.                                                                                                                                                                                                                            |
| `prisma/seed.ts`                                                                      | Full-faculty seed writes published modern questions attributed to the assessment creator.                                                                                                                                                                                                                 |
| `prisma/seed-demo.ts`                                                                 | Already the modern pipeline; unchanged (verified).                                                                                                                                                                                                                                                        |

## What reads the modern store now

| Reader                                                                        | Change                                                                                                                                                      |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/gradebook-db.ts` `getGradebookPayloadForSessionUser` (teacher + student) | `quizzes` is projected from modern `questions`/`options` via `toUiQuizzes`, gated by `quizDeliveryStatus` so drafts are never delivered.                    |
| `lib/quiz-grading.ts` (`POST /api/quiz/grade`)                                | Scores modern rows; derives `correctIndex` from `QuestionOption.isCorrect`, honours `Question.points`, and rejects a question with no correct option (409). |
| `app/api/student/assessments/route.ts`                                        | `quizQuestionCount` counts a deliverable modern question set (draft quizzes report 0, as before).                                                           |
| `app/(dashboard)/admin/data/page.tsx`                                         | Explorer datasets swap `quizzes`/`quiz_questions` for `questions`/`question_options`.                                                                       |

## Offering-resolution fix

The importer no longer matches an offering by `courseId`/course name. The zod
contract (`quizImportRequestSchema`) requires `offeringId`; the service resolves
`courseOffering.findFirst({ where: { id: offeringId, teacherId: staff.id } })`
and throws `"Offering not found or not owned by you."` when it is missing or
owned by another teacher, which the route maps to a clear **403**. A missing and
a non-owned id are the same response so the endpoint never confirms another
teacher's offering exists. `components/teacher-assignments-manager.tsx` now has
an offering selector on the import card and sends `offeringId`.

Coverage: `tests/legacy-quiz-retirement.test.ts` (service rejection + route
`403` + nothing written), mirroring the earlier
`tests/assessment-offering-selection.test.ts` for assessment creation.

## Migration

`prisma/migrations/20260912030000_retire_quiz/migration.sql` (fifth migration;
the tree had four before this change — the baseline squash consolidated the
earlier migration dirs, so the brief's "five existing" is off by one): drops `QuizQuestion`
then `Quiz`. The four earlier migrations are untouched. `prisma/schema.prisma`
removes the two models and `Assessment.quiz`.

`tests/global-setup.ts` applies the full migration history to an empty database
with `prisma migrate deploy` on every run, so the suite proves all five
migrations build the current schema from empty. `tests/legacy-quiz-retirement.test.ts` also
asserts `pg_tables` no longer contains `Quiz` / `QuizQuestion`.

## Tests

- `tests/legacy-quiz-retirement.test.ts` (new, 5 tests): import lands published
  modern questions attributed to the teacher and the attempt pipeline scores them
  end to end (import → `startQuizAttempt` → `submitQuizAttempt`), plus the
  legacy `gradeQuizSubmission` scorer; non-owner offering rejected (service +
  route 403, nothing written); student rejected at the route (403); imported
  question appears in the student-facing payload with no key
  (`correctIndex`/`isCorrect`/`correctOptionId` absent in both the gradebook
  payload and the attempt view); retired tables absent.
- `tests/quiz-grading.test.ts`: fixture migrated from `quiz.questions`/
  `optionsJson`/`correctIndex` to modern `questions`/`options[].isCorrect`, and
  two cases added (question with no correct option → 409, no questions → 409).
  Reason: the module under test now reads the modern store; the assertions on
  score/disclosure are unchanged.

Full suite: **82 files passed, 2 skipped; 523 tests passed, 5 skipped (536
total)**. Before this change: 7 fewer tests (529 total), the delta being the 5
new retirement tests and 2 new grader cases.

## Residual / notes

- `lib/gradebook.ts`'s client types `Quiz` / `QuizQuestion` keep their names for
  now; they describe the key-free JSON view, not a schema model. Renaming is
  cosmetic and out of scope.
- The `/quiz` page and `POST /api/quiz/grade` remain a second, transient grader
  (it persists no `QuizAttempt`/`Grade`). It now reads the single modern store,
  so it cannot disagree with the attempt pipeline about correctness. Folding the
  page into `/student/quizzes` would be a product decision.
- `docs/verification/grading-integrity.md` recorded this importer ambiguity as an
  open residual; it is resolved by this change (that point-in-time record was
  left as written).
