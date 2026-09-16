import "server-only"

import type { AssessmentType } from "@/lib/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"
import { resolveTeacherStaffId } from "@/lib/teacher-staff"

/**
 * The teacher planner's assessment-deadline query.
 *
 * Separate from `lib/calendar.ts` because a deadline is not a calendar event. The
 * planner shows both, and decision E3 gives them different tables: the events table
 * cannot serve `maxMarks`, submission counts or release state, and the deadlines
 * table cannot serve `endAt` or a location. One row per fact means each table owns
 * its own — so `Assessment`-type events are filtered out of the planner's events
 * table rather than being listed twice.
 *
 * `Assessment.dueDate` is the source, not the paired `CalendarEvent`. The seed
 * happens to create one event per assessment, but a due date is a property of the
 * assessment: deriving the deadline list from the calendar would make a deadline
 * disappear whenever its event was missing or renamed.
 *
 * **Columns the mockup drew that are absent on purpose:**
 *
 * - `weightPercent` — no column exists anywhere in the schema. Teaching a fake
 *   weighting would be worse than dropping it.
 * - `state` — no backing. `Question.status` is quiz-only and says nothing about an
 *   assessment's progress, so any value here would be invented.
 * - `averagePercent` — **droppable, and deliberately dropped.** The plan marks this
 *   DERIVE, and a per-assessment average does exist, but it lives behind
 *   `getTeacherAnalyticsOverview`, which is scoped to a *single* offering; the
 *   planner spans every offering a teacher teaches, so reusing it would mean one
 *   call per offering. The alternative — a second aggregation here — would be a
 *   parallel implementation of a number the analytics page already owns, and the two
 *   could silently disagree. The honest fix is to extract the per-assessment summary
 *   so both callers share one computation; until then the column is omitted rather
 *   than approximated. Recorded as a follow-up.
 *
 * The counts **are** real: `_count` on the two relations that back them.
 */

export type TeacherDeadlineItem = {
  id: string
  title: string
  /** `AssessmentType`; its five names match the mockup's union verbatim. */
  kind: AssessmentType
  /** ISO. */
  dueDate: string
  maxMarks: number
  courseCode: string
  /**
   * Whether students can see it. From `Assessment.releasedAt`, which is a different
   * fact from `CourseOffering.resultsPublishedAt` (the retention anchor) and from
   * `Grade.publishedAt` (one student's mark).
   */
  released: boolean
  /** ISO, or null when not released. */
  releasedAt: string | null
  /** Submissions received. */
  submitted: number
  /** Marks published — `Grade` rows, which only exist once a human publishes. */
  graded: number
}

/** The subset of an `assessment.findMany` row the projection reads. */
export type TeacherDeadlineQueryRow = {
  id: string
  title: string
  type: AssessmentType
  dueDate: Date
  maxMarks: number
  releasedAt: Date | null
  offering: { course: { code: string } }
  _count: { submissions: number; finalGrades: number }
}

/**
 * Pure projection, so the read path has a test that needs no database.
 *
 * The invariant worth naming: `released` is derived from `releasedAt` being
 * non-null, never from a separate flag, so the two cannot disagree. `releasedAt`
 * itself is kept so the page can show *when*, and a null is a real absence rather
 * than a missing value.
 */
export function toTeacherDeadlineItem(row: TeacherDeadlineQueryRow): TeacherDeadlineItem {
  return {
    id: row.id,
    title: row.title,
    kind: row.type,
    dueDate: row.dueDate.toISOString(),
    maxMarks: row.maxMarks,
    courseCode: row.offering.course.code,
    released: row.releasedAt !== null,
    releasedAt: row.releasedAt?.toISOString() ?? null,
    submitted: row._count.submissions,
    graded: row._count.finalGrades,
  }
}

/**
 * Every assessment deadline the teacher owns, soonest first.
 *
 * Ownership follows the same rule as the release action — created it, **or** teach
 * its offering — so a teacher sees the deadlines they can act on and nothing else.
 * A colleague's assessment on a shared offering is visible, because they can
 * release it.
 *
 * Returns `[]` for a teacher-shaped user with no staff profile: a broken invariant,
 * but not worth taking a page down for.
 */
export async function listAssessmentDeadlinesForTeacher(
  user: AuthUser,
): Promise<TeacherDeadlineItem[]> {
  const staffId = await resolveTeacherStaffId(user.id)
  if (!staffId) return []

  const rows = await prisma.assessment.findMany({
    where: {
      OR: [{ offering: { is: { teacherId: staffId } } }, { createdById: staffId }],
    },
    // Soonest first: a planner is read forwards, unlike the student's newest-first
    // materials list.
    orderBy: { dueDate: "asc" },
    select: {
      id: true,
      title: true,
      type: true,
      dueDate: true,
      maxMarks: true,
      releasedAt: true,
      offering: { select: { course: { select: { code: true } } } },
      _count: { select: { submissions: true, finalGrades: true } },
    },
  })

  return rows.map(toTeacherDeadlineItem)
}
