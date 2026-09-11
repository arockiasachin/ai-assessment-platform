-- Restore the CourseRating model that `20260912000000_schema_unfreeze` dropped.
--
-- The unfreeze dropped CourseRating on an audit that reported zero references,
-- but the feature was live (students rated completed courses; teachers read a
-- ratings report) and its consumer code was already modernized. This migration
-- re-creates the table with the exact shape the baseline had, including the
-- `@@unique([offeringId, studentId])` constraint that makes a rating an upsert
-- rather than a duplicate, plus the two lookup indexes and cascading FKs.
--
-- Generated with:
--   prisma migrate diff \
--     --from-schema <schema at 258108a> \
--     --to-schema   prisma/schema.prisma \
--     --script

-- CreateTable
CREATE TABLE "CourseRating" (
    "id" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourseRating_offeringId_idx" ON "CourseRating"("offeringId");

-- CreateIndex
CREATE INDEX "CourseRating_studentId_idx" ON "CourseRating"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseRating_offeringId_studentId_key" ON "CourseRating"("offeringId", "studentId");

-- AddForeignKey
ALTER TABLE "CourseRating" ADD CONSTRAINT "CourseRating_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseRating" ADD CONSTRAINT "CourseRating_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
