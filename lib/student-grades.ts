import type { AssessmentType } from "@/lib/generated/prisma/enums"
import type { StudentAssessmentItem } from "@/lib/student-assessments"

/**
 * Pure grouping for the student grades page.
 *
 * ## What this module is
 *
 * It turns the assessment list the student reader already returns
 * (`listStudentAssessments`) into the shape a *grades* page needs: marks grouped
 * by **subject** (`courseId`) and **period** (`CourseOffering.term` +
 * `CourseOffering.academicYear`), with the period the student is in now split
 * from the periods they have finished.
 *
 * It owns no query. `Grade` rows are fetched per assessment by
 * `lib/student-assessments.ts`, which is the module the assessments hub already
 * renders from, so the grades page cannot disagree with the hub about which
 * marks exist or which of them are released. A second query here would be a
 * second answer to that question.
 *
 * ## What counts as a mark
 *
 * `Grade.publishedAt != null` — an unreleased mark is not a student-facing fact,
 * and `StudentAssessmentItem.published` is exactly that predicate after the
 * reader has hidden unpublished values. The two states `published: false`
 * collapses are kept apart deliberately, because they are different things to
 * tell a student:
 *
 * - `hasMark && !published` — marked, awaiting release;
 * - `!hasMark` — no mark exists at all.
 *
 * Neither is counted as a zero. There is no arithmetic anywhere in this module
 * that turns "no mark" into `0`.
 *
 * ## Why "current" is derived rather than read
 *
 * There is no semester model: `term` + `academicYear` is the whole period
 * concept, and there is no `isCurrent` flag on `CourseOffering` to read. So the
 * current period is derived from the student's own data, and the rule is stated
 * once here so the page, the course hub and the tests cannot each invent one:
 *
 * 1. the newest `academicYear` first — the year is the coarse period fact, so a
 *    2026 offering always outranks a 2025 one;
 * 2. then the **latest due date** in the period, descending — within a year, the
 *    period whose work is dated later is the more recent one, and the real dates
 *    are a better signal than comparing term labels like `"Term-2"` and
 *    `"Semester-1"` alphabetically;
 * 3. then `term` ascending, purely so the order is total rather than dependent
 *    on iteration order.
 *
 * The newest period is the current one; every other period is prior. A subject
 * with no work in the current period gets `current: null` rather than being
 * quietly folded into the current term.
 *
 * ## Imports
 *
 * Type-only, deliberately. `lib/student-assessments.ts` is `server-only`, and a
 * value import would drag that into every caller; `import type` is erased, so
 * this module stays pure and unit-testable without a database — the same trade
 * `lib/student-assessments-view.ts` makes.
 */

/** A term and its academic year. `CourseOffering` carries both; there is nothing else. */
export type GradePeriod = {
  term: string
  academicYear: number
}

/** Stable key for a period, so grouping cannot depend on string concatenation accidents. */
export function periodKey(period: GradePeriod): string {
  return `${period.academicYear}::${period.term}`
}

/** How a period is written for a reader, e.g. `Term-2 2025`. */
export function periodLabel(period: GradePeriod): string {
  return `${period.term} ${period.academicYear}`
}

/**
 * One released mark.
 *
 * `score` and `percentage` are nullable because the reader computes both from
 * the grade's own `maxPoints`, and a stored `maxPoints` of zero cannot produce
 * either. The mark is still released and still listed — dropping the row would
 * hide a real mark — but it renders as `—` rather than as `0`.
 */
export type ReleasedMark = {
  assessmentId: string
  title: string
  type: AssessmentType
  /** ISO. */
  dueDate: string
  score: number | null
  maxMarks: number
  /** 0–100, or null when the underlying max was zero. */
  percentage: number | null
}

/**
 * One subject's marks in one period.
 *
 * `marks` holds only released marks and is empty when nothing has been released.
 * The counts beside it are what lets the page say *why* it is empty without
 * guessing: `awaitingReleaseCount` marks exist but are withheld, `notMarkedCount`
 * do not exist yet.
 */
export type SubjectTermGroup = {
  period: GradePeriod
  /** Released marks, earliest due date first. */
  marks: ReleasedMark[]
  /** Mean of the released percentages, or null when none carry a percentage. */
  average: number | null
  /** Marked but not yet released. */
  awaitingReleaseCount: number
  /** No mark row exists. */
  notMarkedCount: number
  /** `awaitingReleaseCount + notMarkedCount`: assessments with no released mark. */
  unreleasedCount: number
  /** Every assessment this subject has in this period, released or not. */
  totalCount: number
}

/** One subject, across every period the student has taken it in. */
export type StudentSubjectGrades = {
  courseId: string
  courseCode: string
  courseName: string
  /**
   * The subject's group in the student's current period, or `null` when they
   * have no work for it in that period (a course they took last year only).
   */
  current: SubjectTermGroup | null
  /** Every other period, newest first. Empty when the current period is the only one. */
  prior: SubjectTermGroup[]
  /** Released marks across every period, so the page can say "no marks at all". */
  releasedMarkCount: number
}

export type StudentGrades = {
  /** The derived current period, or null when the student has no assessments. */
  currentPeriod: GradePeriod | null
  /** Every distinct period the student has work in, newest first. */
  periods: GradePeriod[]
  /** Subjects, most recently active first. */
  subjects: StudentSubjectGrades[]
}

/** A period plus the ordering facts derived from the rows inside it. */
type PeriodOrder = {
  period: GradePeriod
  /** Milliseconds, the latest `dueDate` seen in this period. */
  latestDueDate: number
}

/**
 * Order periods newest-first, using the three-step rule in the module docblock.
 *
 * Exported because the course hub needs the same order for one subject's terms
 * and the page for all of them; two comparators would be two definitions of
 * "newer".
 */
export function comparePeriodsDescending(a: PeriodOrder, b: PeriodOrder): number {
  if (a.period.academicYear !== b.period.academicYear) {
    return b.period.academicYear - a.period.academicYear
  }
  if (a.latestDueDate !== b.latestDueDate) return b.latestDueDate - a.latestDueDate
  return a.period.term.localeCompare(b.period.term)
}

function dueTime(item: StudentAssessmentItem): number {
  const time = new Date(item.dueDate).getTime()
  return Number.isFinite(time) ? time : 0
}

function toReleasedMark(item: StudentAssessmentItem): ReleasedMark {
  return {
    assessmentId: item.id,
    title: item.title,
    type: item.type,
    dueDate: item.dueDate,
    score: item.score,
    maxMarks: item.maxMarks,
    percentage: item.percentage,
  }
}

/**
 * Collapse one subject's rows in one period into a group.
 *
 * `released` is `item.published`, which is `Grade.publishedAt != null` as the
 * reader projects it. A released mark whose percentage is null (a zero max) is
 * still a mark and still listed; it simply does not move the average, because
 * averaging in a `0` for "cannot be computed" would be the exact falsification
 * this module exists to avoid.
 */
function toTermGroup(
  period: GradePeriod,
  rows: readonly StudentAssessmentItem[],
): SubjectTermGroup {
  const marks = rows
    .filter((item) => item.published)
    .map(toReleasedMark)
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())

  const percentages = marks
    .map((mark) => mark.percentage)
    .filter((value): value is number => value !== null)

  let awaitingReleaseCount = 0
  let notMarkedCount = 0
  for (const item of rows) {
    if (item.published) continue
    if (item.hasMark) awaitingReleaseCount += 1
    else notMarkedCount += 1
  }

  return {
    period,
    marks,
    average:
      percentages.length > 0
        ? percentages.reduce((sum, value) => sum + value, 0) / percentages.length
        : null,
    awaitingReleaseCount,
    notMarkedCount,
    unreleasedCount: awaitingReleaseCount + notMarkedCount,
    totalCount: rows.length,
  }
}

/** Group rows by period, tracking each period's latest due date for the ordering. */
function groupByPeriod(rows: readonly StudentAssessmentItem[]): Map<
  string,
  PeriodOrder & {
    rows: StudentAssessmentItem[]
  }
> {
  const grouped = new Map<string, PeriodOrder & { rows: StudentAssessmentItem[] }>()
  for (const item of rows) {
    const key = periodKey({ term: item.term, academicYear: item.academicYear })
    const existing = grouped.get(key)
    if (existing) {
      existing.rows.push(item)
      existing.latestDueDate = Math.max(existing.latestDueDate, dueTime(item))
      continue
    }
    grouped.set(key, {
      period: { term: item.term, academicYear: item.academicYear },
      latestDueDate: dueTime(item),
      rows: [item],
    })
  }
  return grouped
}

/**
 * Build the grades view model from the student's assessment list.
 *
 * Deterministic and total: the same rows always produce the same order, and an
 * empty list produces `currentPeriod: null` with no subjects rather than a
 * synthetic term.
 */
export function buildStudentGrades(items: readonly StudentAssessmentItem[]): StudentGrades {
  const periods = [...groupByPeriod(items).values()].sort(comparePeriodsDescending)
  const currentPeriod = periods[0]?.period ?? null

  const bySubject = new Map<string, StudentAssessmentItem[]>()
  for (const item of items) {
    const rows = bySubject.get(item.courseId)
    if (rows) rows.push(item)
    else bySubject.set(item.courseId, [item])
  }

  const subjects: StudentSubjectGrades[] = []
  for (const [courseId, rows] of bySubject) {
    const subjectPeriods = [...groupByPeriod(rows).values()].sort(comparePeriodsDescending)
    const groups = subjectPeriods.map((entry) => toTermGroup(entry.period, entry.rows))

    const first = rows[0]
    const currentKey = currentPeriod ? periodKey(currentPeriod) : null
    const current = groups.find((group) => periodKey(group.period) === currentKey) ?? null
    const prior = groups.filter((group) => periodKey(group.period) !== currentKey)

    subjects.push({
      courseId,
      courseCode: first.courseCode,
      courseName: first.courseName,
      current,
      prior,
      releasedMarkCount: groups.reduce((total, group) => total + group.marks.length, 0),
    })
  }

  // Subjects with work in the current period first, then the most recently active,
  // then by code so the order is stable when nothing separates two subjects.
  const latestActivity = new Map(
    [...bySubject.entries()].map(([courseId, rows]) => [courseId, Math.max(...rows.map(dueTime))]),
  )
  subjects.sort((a, b) => {
    const aCurrent = a.current !== null
    const bCurrent = b.current !== null
    if (aCurrent !== bCurrent) return aCurrent ? -1 : 1
    const aLatest = latestActivity.get(a.courseId) ?? 0
    const bLatest = latestActivity.get(b.courseId) ?? 0
    if (aLatest !== bLatest) return bLatest - aLatest
    return a.courseCode.localeCompare(b.courseCode)
  })

  return {
    currentPeriod,
    periods: periods.map((entry) => entry.period),
    subjects,
  }
}
