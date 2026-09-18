-- `SubmissionAttachment`: the uploaded files a submission may carry.
--
-- The file body is stored in object storage (see `lib/storage.ts`), not in Postgres; only the
-- opaque `storageKey` pointer and the descriptive metadata live here. A child table rather than a
-- column on `Submission` because a submission can carry more than one file, and because the
-- retention purge needs a row per file to redact.
--
-- ## Nullable content columns, deliberately
--
-- `filename`, `mimeType` and `storageKey` are nullable so the retention purge can clear them the
-- same way it nulls `Submission.contentText`/`artifactUrl`. The row survives as provenance (the
-- attachment existed and how many bytes it was), while the identifying metadata and the pointer to
-- the file are removed together with the stored file. `sizeBytes` stays non-null and is retained,
-- like `CourseRating.rating`.
--
-- `purgedAt` is the "processed by this sweep" marker that makes the purge idempotent
-- (`where: purgedAt: null`) and lets its report count the row, matching `Submission`,
-- `SubmissionVersion`, `QuizResponse`, `TestRun`, `CourseRating` and `PeerEvaluation`.
--
-- ## Additive
--
-- A brand-new table: no existing row or column changes, so no backfill and no behaviour change.
--
-- Generated with:
--   prisma migrate diff \
--     --from-schema <prisma/schema.prisma at HEAD> \
--     --to-schema prisma/schema.prisma \
--     --script
--
-- Applied with `prisma migrate deploy` (never `migrate dev`, never `db push`).

-- CreateTable
CREATE TABLE "SubmissionAttachment" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "filename" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT,
    "purgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubmissionAttachment_submissionId_idx" ON "SubmissionAttachment"("submissionId");

-- AddForeignKey
ALTER TABLE "SubmissionAttachment" ADD CONSTRAINT "SubmissionAttachment_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
