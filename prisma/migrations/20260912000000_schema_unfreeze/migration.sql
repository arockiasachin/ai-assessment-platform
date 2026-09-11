-- Schema unfreeze (first schema change after the squashed baseline).
--
-- Generated with:
--   prisma migrate diff \
--     --from-schema <baseline schema> \
--     --to-schema   prisma/schema.prisma \
--     --script
-- and applied with `prisma migrate deploy` against an empty database.
--
-- Adds the six capabilities the Phase 2/3 feature pods previously worked around
-- in JSON columns or request-supplied values:
--   1. StudentProfile.formationProfile       (team-formation attributes/availability)
--   2. CourseOffering.analyticsSettings      (persisted alert/extraction thresholds)
--   3. Question.status/publishedAt/publishedById (real draft/published state)
--   4. AIGradeSuggestion.seq                 (monotonic suggestion dedupe key)
--   5. LtiRegistration + LtiUserMapping      (LTI registration + student mapping)
--   6. Assessment.maxAttempts                (per-assessment quiz attempt cap)
--
-- and drops the seven dead models plus their back-relations, the
-- AttendanceStatus enum, every loose noSqlRefId column, and
-- User.legacyPassword. AssessmentGrade is deliberately NOT dropped (still the
-- LMS-export legacy fallback; retiring it is a product decision).

-- DropForeignKey
ALTER TABLE "StudentStream" DROP CONSTRAINT "StudentStream_studentId_fkey";

-- DropForeignKey
ALTER TABLE "StudentStream" DROP CONSTRAINT "StudentStream_streamId_fkey";

-- DropForeignKey
ALTER TABLE "CourseRating" DROP CONSTRAINT "CourseRating_offeringId_fkey";

-- DropForeignKey
ALTER TABLE "CourseRating" DROP CONSTRAINT "CourseRating_studentId_fkey";

-- DropForeignKey
ALTER TABLE "AttendanceSession" DROP CONSTRAINT "AttendanceSession_offeringId_fkey";

-- DropForeignKey
ALTER TABLE "AttendanceRecord" DROP CONSTRAINT "AttendanceRecord_attendanceSessionId_fkey";

-- DropForeignKey
ALTER TABLE "AttendanceRecord" DROP CONSTRAINT "AttendanceRecord_studentId_fkey";

-- DropForeignKey
ALTER TABLE "CourseGradeHistory" DROP CONSTRAINT "CourseGradeHistory_studentId_fkey";

-- DropForeignKey
ALTER TABLE "CourseGradeHistory" DROP CONSTRAINT "CourseGradeHistory_courseId_fkey";

-- DropForeignKey
ALTER TABLE "CourseGradeHistory" DROP CONSTRAINT "CourseGradeHistory_classId_fkey";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "password";

-- AlterTable
ALTER TABLE "StudentProfile" ADD COLUMN     "formationProfile" JSONB;

-- AlterTable
ALTER TABLE "CourseOffering" DROP COLUMN "noSqlRefId",
ADD COLUMN     "analyticsSettings" JSONB;

-- AlterTable
ALTER TABLE "Assessment" DROP COLUMN "noSqlRefId",
ADD COLUMN     "maxAttempts" INTEGER;

-- AlterTable
ALTER TABLE "Submission" DROP COLUMN "noSqlRefId";

-- AlterTable
ALTER TABLE "CalendarEvent" DROP COLUMN "noSqlRefId";

-- AlterTable
ALTER TABLE "AIGradeSuggestion" ADD COLUMN     "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "publishedById" TEXT,
ADD COLUMN     "status" TEXT;

-- DropTable
DROP TABLE "Stream";

-- DropTable
DROP TABLE "StudentStream";

-- DropTable
DROP TABLE "CourseRating";

-- DropTable
DROP TABLE "AttendanceSession";

-- DropTable
DROP TABLE "AttendanceRecord";

-- DropTable
DROP TABLE "CourseGradeHistory";

-- DropTable
DROP TABLE "ExternalReference";

-- DropEnum
DROP TYPE "AttendanceStatus";

-- CreateTable
CREATE TABLE "LtiRegistration" (
    "id" TEXT NOT NULL,
    "platformIssuer" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "privateKeyRef" TEXT,
    "lineItemsUrl" TEXT,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "name" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LtiRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LtiUserMapping" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "ltiUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LtiUserMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LtiRegistration_isActive_idx" ON "LtiRegistration"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "LtiRegistration_platformIssuer_clientId_deploymentId_key" ON "LtiRegistration"("platformIssuer", "clientId", "deploymentId");

-- CreateIndex
CREATE INDEX "LtiUserMapping_studentId_idx" ON "LtiUserMapping"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "LtiUserMapping_registrationId_ltiUserId_key" ON "LtiUserMapping"("registrationId", "ltiUserId");

-- CreateIndex
CREATE UNIQUE INDEX "LtiUserMapping_registrationId_studentId_key" ON "LtiUserMapping"("registrationId", "studentId");

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "StaffProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LtiUserMapping" ADD CONSTRAINT "LtiUserMapping_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "LtiRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LtiUserMapping" ADD CONSTRAINT "LtiUserMapping_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
