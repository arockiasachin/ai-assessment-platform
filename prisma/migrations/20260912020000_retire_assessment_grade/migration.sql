-- Retire the legacy AssessmentGrade store.
--
-- The duplicate-grade gap is closed: a teacher's manual mark now writes the
-- modern `Grade` (published + audited) through `lib/grading/review-service.ts`,
-- and every reader (gradebook payload, student assessments, submission
-- grading, group-grade resolution, LMS export, admin explorer, seeds) reads the
-- modern store. Nothing references `AssessmentGrade` any more, so the table is
-- dropped. The baseline and the two later migrations are left untouched; this
-- drops the table they created.
DROP TABLE "AssessmentGrade";
