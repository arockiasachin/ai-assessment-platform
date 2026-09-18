-- `ArrearAcknowledgement`: a student's explicit acknowledgement of an outstanding arrear.
--
-- The enrolment gate (`app/api/student/courses/enroll/route.ts`) refuses a **new** course
-- registration while an arrear stands, and this table is what keeps that refusal from being a
-- dead end: once the arrear's own offering is acknowledged for a student, it no longer blocks,
-- while the arrear's own course is always allowed so the student can re-register and clear it.
--
-- ## Why persisted rather than a client-side confirm
--
-- The block is an institutional rule, so the acknowledgement is the institution's evidence that
-- the student was *told* rather than silently refused. A boolean on the request would be a
-- per-request gesture with no record and would re-prompt on every attempt; a row is an audit
-- trail, keyed to the student and the arrear-bearing offering, and it survives sessions.
--
-- ## The arrear is derived; this is not its source of truth
--
-- `lib/arrears.ts` computes the arrear from published grades, so `reason` here records how it
-- read when the student acknowledged (`"failed"` / `"did-not-appear"`). A corrected grade can
-- retire the arrear and leaves this row as a historical record; the gate always re-derives the
-- arrear and only consults this table to see whether it has been acknowledged.
--
-- ## Additive
--
-- A brand-new table: no existing row or column changes, so no backfill and no behaviour change
-- on its own.
--
-- Generated with:
--   prisma migrate diff \
--     --from-schema <prisma/schema.prisma at HEAD> \
--     --to-schema prisma/schema.prisma \
--     --script
--
-- Applied with `prisma migrate deploy` (never `migrate dev`, never `db push`).

-- CreateTable
CREATE TABLE "ArrearAcknowledgement" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArrearAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArrearAcknowledgement_offeringId_idx" ON "ArrearAcknowledgement"("offeringId");

-- CreateIndex
CREATE UNIQUE INDEX "ArrearAcknowledgement_studentId_offeringId_key" ON "ArrearAcknowledgement"("studentId", "offeringId");

-- AddForeignKey
ALTER TABLE "ArrearAcknowledgement" ADD CONSTRAINT "ArrearAcknowledgement_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArrearAcknowledgement" ADD CONSTRAINT "ArrearAcknowledgement_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;
