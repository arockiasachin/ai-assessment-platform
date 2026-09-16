-- Make SimilarityCheck's uniqueness unconditional.
--
-- ## The defect
--
-- The key was `[assessmentId, codeTaskId, studentId, comparedStudentId]`, and `assessmentId` was
-- nullable. **Postgres treats NULLs as distinct in a unique index**, so any row with a null
-- `assessmentId` could be inserted twice. Two identical rows for one student pair were reachable
-- — reproduced against a real database before this migration was written — which a pairwise
-- comparison must never allow, because every reader that counts or ranks pairs would double-count
-- them.
--
-- A NULL in `assessmentId` is not hypothetical: `scanCohortSimilarityForTeacher` passes the value
-- it was given, and nothing in the column's definition prevented a null.
--
-- ## The fix, and why it is this one
--
-- `codeTaskId` becomes **required** and the key becomes
-- `[codeTaskId, studentId, comparedStudentId]`. With no nullable column left in the key,
-- uniqueness holds unconditionally rather than having to be argued for each combination of nulls.
--
-- `codeTaskId` is required rather than merely preferred because a similarity check with no code
-- task has nothing to compare, and the one writer (`scanCohortSimilarityForTeacher`) always
-- requires a task — it loads the code task before it compares anything.
--
-- `assessmentId` is **kept** as a denormalized convenience (the readers filter by assessment) but
-- removed from the key: `CodeTask.assessmentId` is `@unique`, so an assessment is fully determined
-- by its code task and the column adds nothing to uniqueness. A key carrying a redundant,
-- nullable column is what created the hole.
--
-- ## The two destructive steps, stated plainly
--
-- Both operate on a **derived analysis table** — a row is a comparison result, reproducible from
-- the stored submissions by re-running the scan (`POST` the similarity scan for the assessment).
-- Neither step touches work a student submitted, a mark, or an audit row.
--
-- 1. **Rows with a null `codeTaskId` are deleted**, because no code path can produce one and the
--    column is about to become required. There is nowhere for such a row to have come from, and
--    nothing to compare in it.
-- 2. **Duplicate groups are collapsed to the most recently checked row**, keeping `id` as the
--    tie-break so the survivor is deterministic. These are exactly the rows the defect allowed.
--
-- Both were no-ops on this repository's development and test databases (zero rows, zero duplicate
-- groups), and both are written to be safe on one that is not.
--
-- Generated with:
--   prisma migrate diff \
--     --from-schema <prisma/schema.prisma at 094fc7b> \
--     --to-schema prisma/schema.prisma \
--     --script
-- and the cleanup below was prepended; `migrate diff` cannot know about the data it has to move
-- aside, so it emits only the constraint change.
--
-- Applied with `prisma migrate deploy` (never `migrate dev`, never `db push`).

-- 1. Rows no code path can produce: a comparison with no code task to compare.
DELETE FROM "SimilarityCheck" WHERE "codeTaskId" IS NULL;

-- 2. Collapse duplicates allowed by the nullable-key defect, keeping the most recently checked
--    (and the higher `id` on a tie, so the survivor does not depend on scan order).
DELETE FROM "SimilarityCheck" AS a
USING "SimilarityCheck" AS b
WHERE a."codeTaskId" = b."codeTaskId"
  AND a."studentId" = b."studentId"
  AND a."comparedStudentId" = b."comparedStudentId"
  AND (a."checkedAt" < b."checkedAt" OR (a."checkedAt" = b."checkedAt" AND a."id" < b."id"));

-- 3. The task becomes required, so no nullable column remains in the key.
ALTER TABLE "SimilarityCheck" ALTER COLUMN "codeTaskId" SET NOT NULL;

-- 4. Swap the constraint for the null-safe one.
DROP INDEX "SimilarityCheck_assessmentId_codeTaskId_studentId_comparedS_key";
CREATE UNIQUE INDEX "SimilarityCheck_codeTaskId_studentId_comparedStudentId_key" ON "SimilarityCheck"("codeTaskId", "studentId", "comparedStudentId");
