-- Retire the legacy Quiz / QuizQuestion store.
--
-- The duplicate quiz store is closed. The import path
-- (`createQuizFromImportForSessionUser`, `POST /api/teacher/quiz`) now writes
-- the modern `Question` / `QuestionOption` rows as *published*, attributed to
-- the importing teacher, so an imported quiz is delivered and scored by the
-- same server-authoritative pipeline as a generated one. Every reader — the
-- gradebook payload, the server-side quiz grader, the student assessments
-- payload, the admin explorer and both seeds — reads the modern store.
-- Nothing references `QuizQuestion` or `Quiz` any more, so the tables are
-- dropped. The baseline and the three later migrations are left untouched;
-- this drops the tables they created.
--
-- Drop the child first: `QuizQuestion.quizId` references `Quiz`, and dropping
-- the parent first would need a CASCADE that could mask a missed dependency.
DROP TABLE "QuizQuestion";
DROP TABLE "Quiz";
