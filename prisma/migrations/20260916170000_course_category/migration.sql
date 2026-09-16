-- Course category: which VIT grading regime a course uses.
--
-- Additive and nullable. **Null is not "theory"** — the platform cannot infer a course's
-- category from its data, so an unset value falls back to absolute grading with a notice
-- asking for it rather than guessing. A guessed `THEORY` would silently put a laboratory
-- course on relative bands, which is the failure this column exists to prevent.
--
-- VIT's rule (Academic Regulations §9.5, Table-6): theory and lab-embedded theory are
-- graded *relatively* above 10 students; laboratory, project, soft-skills,
-- extra-curricular and NGCR courses are graded *absolutely* at any size, "irrespective of
-- the class strength".
--
-- No index: the column is read with the course row it belongs to, never filtered on.
--
-- Generated with:
--   prisma migrate diff \
--     --from-schema <prisma/schema.prisma at 3b3325c> \
--     --to-schema prisma/schema.prisma \
--     --script
--
-- Applied with `prisma migrate deploy` (never `migrate dev`, never `db push`).

-- CreateEnum
CREATE TYPE "CourseCategory" AS ENUM ('THEORY', 'LAB_EMBEDDED_THEORY', 'LABORATORY', 'PROJECT', 'SOFT_SKILLS', 'EXTRA_CURRICULAR', 'NGCR');

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "category" "CourseCategory";
