-- Retake policy and the approval record.
--
-- Additive. `retakePolicy` defaults to `FIXED` and `retakesAllowed` is nullable, so **no
-- assessment changes behaviour** by gaining these columns: `FIXED` with a null cap is exactly
-- what the platform already did through `maxAttempts`.
--
-- `retakesAllowed` is separate from `maxAttempts` because they answer different questions and
-- the copy cannot be honest with one number. `maxAttempts` caps total sittings; "the teacher
-- allows one retake" is `maxAttempts = 2`, which reads as two attempts to a teacher who typed
-- "1". Null means "fall back to `maxAttempts`".
--
-- `RetakeRequest` is a record rather than a flag because an approval is a teacher action on a
-- student's record: it carries who decided it and when, and writes an `AuditLog` row like every
-- other high-trust mutation. `@@unique([assessmentId, studentId])` means one request per student
-- per assessment — a rejection keeps its row and a re-ask reverts it to PENDING, so the decision
-- history stays on one record instead of growing a pile of rejected rows.
--
-- Generated with:
--   prisma migrate diff \
--     --from-schema <prisma/schema.prisma at 2d4122f> \
--     --to-schema prisma/schema.prisma \
--     --script
--
-- Applied with `prisma migrate deploy` (never `migrate dev`, never `db push`).


-- CreateEnum
CREATE TYPE "RetakePolicy" AS ENUM ('NONE', 'FIXED', 'APPROVAL');

-- CreateEnum
CREATE TYPE "RetakeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "retakePolicy" "RetakePolicy" NOT NULL DEFAULT 'FIXED',
ADD COLUMN     "retakesAllowed" INTEGER;

-- CreateTable
CREATE TABLE "RetakeRequest" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "RetakeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "requestNote" TEXT,
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetakeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RetakeRequest_status_createdAt_idx" ON "RetakeRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RetakeRequest_studentId_idx" ON "RetakeRequest"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "RetakeRequest_assessmentId_studentId_key" ON "RetakeRequest"("assessmentId", "studentId");

-- AddForeignKey
ALTER TABLE "RetakeRequest" ADD CONSTRAINT "RetakeRequest_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetakeRequest" ADD CONSTRAINT "RetakeRequest_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetakeRequest" ADD CONSTRAINT "RetakeRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "StaffProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

