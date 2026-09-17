-- `Group.assessmentId`: link a team to the `GROUP_PROJECT` assessment it exists to do.
--
-- The TN-49 finding: a group was scoped to a course offering only, so nothing in the data
-- said which project assessment a team belonged to. A teacher reading a `GROUP_PROJECT`
-- could not tell which teams were in it, and a team carried no attributable project. This
-- is the schema half of the fix; the milestone half landed in 35f07fd.
--
-- ## Nullable, additively
--
-- Every existing group has no assessment, and the seed may form a team with no project
-- assessment at all, so the column is nullable and the migration needs **no backfill**:
-- null is the correct reading of every row that predates it ("not linked"). Nothing changes
-- behaviour until a group is linked.
--
-- ## `onDelete: RESTRICT`, deliberately
--
-- Deleting an assessment that still has linked teams is refused. The other two options both
-- lose information silently:
--   - `SET NULL` would unscope a project team on delete, leaving a row indistinguishable
--     from a team that never had a project — the orphan-promotion shape this project has
--     hit twice with `CalendarEvent`, where a parentless row became offering-wide.
--   - `CASCADE` would delete the teams and, through them, members, milestones, peer
--     evaluations and contribution evidence. That is student work, and it is not the
--     assessment's to destroy.
-- `RESTRICT` makes the teacher's choice explicit: unlink or remove the teams first.
--
-- ## Index
--
-- `@@index([assessmentId])` serves the reader that answers "which teams belong to this
-- project assessment?" — the direction that did not exist before. The model's existing
-- compound index leads with `offeringId`, so it cannot serve an assessment-scoped filter.
--
-- Generated with:
--   prisma migrate diff \
--     --from-schema <prisma/schema.prisma at HEAD> \
--     --to-schema prisma/schema.prisma \
--     --script
--
-- Applied with `prisma migrate deploy` (never `migrate dev`, never `db push`).

-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "assessmentId" TEXT;

-- CreateIndex
CREATE INDEX "Group_assessmentId_idx" ON "Group"("assessmentId");

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
