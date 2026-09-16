-- Quiz attempt kind: graded sittings versus practice.
--
-- Adds the column and re-scopes the attempt numbering. **No data migration is needed**: the
-- column is `NOT NULL DEFAULT 'GRADED'`, which is both the safe value and the correct reading
-- of every row that predates it — before this, nothing could produce a practice sitting, so
-- every existing attempt *is* graded.
--
-- Why the unique constraint changes. It was `(assessmentId, studentId, attemptNumber)`, global
-- across kinds. Once practice sittings exist, a student who practises before their first graded
-- sitting has practice #1 AND graded #1, which that constraint forbids. Sharing one sequence
-- instead would be worse: after three practice sittings the first graded attempt would be
-- labelled "#4", and the teacher-facing attempt number would be nonsense. So numbering is
-- kind-scoped, and the constraint moves with it.
--
-- The old `(assessmentId, studentId)` index is dropped because the new
-- `(assessmentId, studentId, kind, status)` has the same leading columns and therefore serves
-- every query it did, plus the two hot filters — counting a student's graded sittings and
-- finding their in-progress one. Keeping both would be a redundant index.
--
-- Generated with:
--   prisma migrate diff \
--     --from-schema <prisma/schema.prisma at b214690> \
--     --to-schema prisma/schema.prisma \
--     --script
--
-- Applied with `prisma migrate deploy` (never `migrate dev`, never `db push`).

-- CreateEnum
CREATE TYPE "QuizAttemptKind" AS ENUM ('GRADED', 'PRACTICE');

-- DropIndex
DROP INDEX "QuizAttempt_assessmentId_studentId_idx";

-- DropIndex
DROP INDEX "QuizAttempt_assessmentId_studentId_attemptNumber_key";

-- AlterTable
ALTER TABLE "QuizAttempt" ADD COLUMN     "kind" "QuizAttemptKind" NOT NULL DEFAULT 'GRADED';

-- CreateIndex
CREATE INDEX "QuizAttempt_assessmentId_studentId_kind_status_idx" ON "QuizAttempt"("assessmentId", "studentId", "kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "QuizAttempt_assessmentId_studentId_kind_attemptNumber_key" ON "QuizAttempt"("assessmentId", "studentId", "kind", "attemptNumber");
