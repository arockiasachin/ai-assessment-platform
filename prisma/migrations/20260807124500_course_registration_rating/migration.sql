-- Add course credits and offering registration/capacity fields.
ALTER TABLE "Course"
ADD COLUMN "credits" INTEGER NOT NULL DEFAULT 3;

ALTER TABLE "CourseOffering"
ADD COLUMN "studentLimit" INTEGER NOT NULL DEFAULT 40,
ADD COLUMN "registrationOpenAt" TIMESTAMP(3),
ADD COLUMN "registrationCloseAt" TIMESTAMP(3);

-- Store student course feedback after completion.
CREATE TABLE "CourseRating" (
  "id" TEXT NOT NULL,
  "offeringId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CourseRating_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CourseRating_rating_check" CHECK ("rating" >= 1 AND "rating" <= 5)
);

CREATE UNIQUE INDEX "CourseRating_offeringId_studentId_key" ON "CourseRating"("offeringId", "studentId");
CREATE INDEX "CourseRating_offeringId_idx" ON "CourseRating"("offeringId");
CREATE INDEX "CourseRating_studentId_idx" ON "CourseRating"("studentId");

ALTER TABLE "CourseRating"
ADD CONSTRAINT "CourseRating_offeringId_fkey"
FOREIGN KEY ("offeringId") REFERENCES "CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourseRating"
ADD CONSTRAINT "CourseRating_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
