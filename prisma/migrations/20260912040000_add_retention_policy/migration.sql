-- Data-retention policy: the results-published anchor and per-row purge markers.
--
-- Adds the columns the retention policy needs and nothing else. Additive only:
-- no existing column, table, index, or migration is changed.
--
-- Generated with:
--   prisma migrate diff \
--     --from-schema <schema at e89724c> \
--     --to-schema   prisma/schema.prisma \
--     --script
--
-- 1. `CourseOffering.resultsPublishedAt` is the retention anchor. Null means
--    "results not published", so no student work for that offering may be
--    purged. It is set once by an explicit teacher action and the purge clock is
--    `resultsPublishedAt + 15 days`, enforced server-side.
-- 2. `*.purgedAt` marks a row whose personal content the purge has redacted. It
--    is both the audit trail of the purge and the idempotency key: the purge
--    only ever selects rows where `purgedAt IS NULL`, so a second run is a
--    no-op. Redaction (nulling content) is preferred over row deletion so
--    referential integrity and the academic record survive; see
--    docs/privacy/retention-policy.md for the entity-by-entity disposition.
--
-- PERMANENTLY RETAINED and deliberately absent here: `Grade` (the transcript)
-- and `AuditLog` (the evidence trail) get no purge marker because they are
-- never purged.

-- AlterTable
ALTER TABLE "CourseOffering" ADD COLUMN     "resultsPublishedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CourseRating" ADD COLUMN     "purgedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "purgedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AIGradeSuggestion" ADD COLUMN     "purgedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "QuizResponse" ADD COLUMN     "purgedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TestRun" ADD COLUMN     "purgedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PeerEvaluation" ADD COLUMN     "purgedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SubmissionVersion" ADD COLUMN     "purgedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "CourseOffering_resultsPublishedAt_idx" ON "CourseOffering"("resultsPublishedAt");
