import "server-only"

import { arrearFor, type ArrearReason } from "@/lib/arrears"
import { liveEnrollmentStatuses } from "@/lib/enrollment-scope"
import type { AssessmentType } from "@/lib/generated/prisma/client"
import {
  derivedGradingMembership,
  resolveFinalGradeConfig,
  resolveGradingPolicy,
} from "@/lib/grading/offering-config"
import { buildCatEligibility, type EligibilityStudent } from "@/lib/grading/offering-eligibility"
import { evaluateCourseOutcome, type CatProgress, type CourseOutcome } from "@/lib/grading/policy"
import {
  computeFinalGrade,
  resolveMarks,
  type GradeCandidateInput,
} from "@/lib/lms-export/final-grade"
import { defaultFinalGradeConfig } from "@/lib/lms-export/weights"
import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

/**
 * The outcome of each course a student is enrolled in, assembled from the pieces
 * the grading machinery already owns.
 *
 * ## Why this module exists
 *
 * `evaluateCourseOutcome` has been implemented and unit-tested since the grading
 * policy landed, but it had **no production caller**: `lib/lms-export` computes a
 * weighted total and never judges it, and the teacher's roster reports the CAT gate
 * without the pass verdict. So "did this student pass, fail, or is it too early to
 * say" was answerable by the library and asked by nobody. This is the composition
 * that answers it, and it is the one later pages (Grades, Arrears, the enrolment
 * gate) are meant to read.
 *
 * ## It composes; it does not re-implement
 *
 * Every number comes from the module that already owns the rule:
 *
 * - `resolveGradingPolicy` + `derivedGradingMembership` locate the CAT pool and the
 *   FAT (`lib/grading/offering-config.ts`), honouring a stored
 *   `finalAssessmentId` and falling back to the due-date heuristic;
 * - `buildCatEligibility` (which calls `catProgress` and `isMarkIncludedInMean`)
 *   computes the CAT progress and gate verdict;
 * - `computeFinalGrade` produces the weighted grand total, applying the
 *   published-only rule and excluding missing assessments rather than zero-filling;
 * - `evaluateCourseOutcome` gives the `pass` / `fail` / `not-judged` verdict against
 *   `PASS_MARK` and the CAT gate;
 * - `arrearFor` (`lib/arrears.ts`) turns the verdict plus the offering's end into an
 *   arrear reason.
 *
 * There is deliberately **no second pass threshold** here. If the rule changes, it
 * changes in `lib/grading/policy.ts` and every surface follows.
 *
 * ## Scope
 *
 * Mirrors `lib/student-grading-regime.ts`: the offering ids come only from the
 * caller's own live enrollments, read from the signed session. There is no id
 * parameter, so a caller cannot point this at another student's cohort. A user with
 * no student profile gets an empty list rather than an error.
 *
 * ## Absence is `null`, never `0`
 *
 * `grandTotal` is `null` whenever the FAT has no published mark, because a weighted
 * total without the final assessment is not a final total — `computeFinalGrade`
 * renormalises over the weight that has marks, so a CAT-only total would read as a
 * pass and lie to a student who never sat the FAT. The CAT progress is still exposed,
 * so a caller can show what *is* known without presenting it as a verdict.
 */

/** A published final-assessment mark, or the honest absence of one. */
export type StudentFinalAssessment = {
  assessmentId: string
  title: string
  /** ISO. */
  dueDate: string
  maxMarks: number
  /** Published percentage (0-100), or `null` when no published mark exists. */
  percentage: number | null
  /** `true` only when a published `Grade` row exists for this assessment. */
  published: boolean
}

/** The CAT gate, flattened for display. */
export type StudentCatProgress = {
  markedCount: number
  totalCount: number
  completionRatio: number
  percent: number | null
  status: "eligible" | "below-cat-minimum" | "insufficient-cat-work" | "no-cat-gate"
  /**
   * The mark the CAT pool must reach for the FAT to be sat, or `null` when the
   * offering sets no gate (a course with no CAT/FAT split).
   *
   * Surfaced here rather than only on the `fat-ineligible` verdict branch so a
   * reader can show "where this student stands against the requirement" *before*
   * the requirement is breached — the verdict only tells you once it is too late.
   */
  minimumPercent: number | null
}

export type StudentCourseOutcome = {
  offeringId: string
  courseId: string
  courseCode: string
  courseName: string
  term: string
  academicYear: number
  /** ISO, or `null` when the offering carries no boundary. */
  startsOn: string | null
  /** ISO, or `null` when the offering carries no boundary. */
  endsOn: string | null
  /** Whether the offering's end has passed. Absence only becomes an arrear when true. */
  ended: boolean
  /**
   * The identified final assessment, or `null` when the policy resolves to no
   * CAT/FAT split (fewer than two assessments).
   */
  finalAssessment: StudentFinalAssessment | null
  cat: StudentCatProgress
  /**
   * The weighted grand total, or `null` when it cannot honestly be stated — no
   * published FAT mark, or no marks at all.
   */
  grandTotal: number | null
  /** Share of the configured weight carrying a published mark. */
  completedWeight: number
  totalWeight: number
  /** True when some configured weight has no published mark behind it. */
  incomplete: boolean
  /** `evaluateCourseOutcome`'s verdict, reusing `PASS_MARK` and the CAT gate. */
  outcome: CourseOutcome
  /** The arrear this outcome represents, or `null`. */
  arrear: ArrearReason | null
}

type OfferingRow = {
  id: string
  courseId: string
  term: string
  academicYear: number
  startsOn: Date | null
  endsOn: Date | null
  gradingConfig: unknown
  course: { code: string; name: string }
}

type AssessmentRow = {
  id: string
  offeringId: string
  title: string
  type: AssessmentType
  dueDate: Date
  maxMarks: number
}

type GradeRow = {
  assessmentId: string
  points: number
  maxPoints: number
  publishedAt: Date | null
}

function buildOutcome(
  offering: OfferingRow,
  assessments: readonly AssessmentRow[],
  gradesByAssessment: ReadonlyMap<string, GradeRow>,
  studentProfileId: string,
  now: Date,
): StudentCourseOutcome {
  const resolvedPolicy = resolveGradingPolicy(offering.gradingConfig)
  const config = resolvedPolicy.config

  // The resolved CAT/FAT membership — the teacher's stored choice when there is one,
  // the due-date heuristic otherwise. `null` with fewer than two assessments.
  const membership = derivedGradingMembership(config, assessments)
  const fatAssessmentId = membership?.fatAssessmentId ?? null

  // The weighted total uses the same resolved configuration the membership came from,
  // so the gate and the total cannot disagree about which assessments are CAT.
  const resolvedConfig =
    resolveFinalGradeConfig(config, assessments) ?? defaultFinalGradeConfig(assessments)

  const candidates: GradeCandidateInput[] = assessments.map((assessment) => {
    const grade = gradesByAssessment.get(assessment.id)
    return {
      assessmentId: assessment.id,
      modern: grade
        ? {
            points: grade.points,
            maxPoints: grade.maxPoints,
            publishedAt: grade.publishedAt,
          }
        : null,
    }
  })
  const resolvedMarks = resolveMarks(candidates)
  const computation = computeFinalGrade(resolvedConfig, resolvedMarks)
  const markByAssessment = new Map(resolvedMarks.marks.map((mark) => [mark.assessmentId, mark]))

  const student: EligibilityStudent = {
    id: studentProfileId,
    name: "",
    registerNumber: "",
    marks: resolvedMarks.marks.map((mark) => ({
      assessmentId: mark.assessmentId,
      percentage: mark.percentage,
      publishedAt: mark.publishedAt,
    })),
  }
  const [eligibilityRow] = buildCatEligibility(config, assessments, [student], { now })

  const hasSplit = fatAssessmentId !== null
  const progress: CatProgress = eligibilityRow?.progress ?? {
    markedCount: 0,
    totalCount: 0,
    completionRatio: 0,
    percent: null,
  }
  const catStatus: StudentCatProgress["status"] = hasSplit
    ? (eligibilityRow?.status ?? "insufficient-cat-work")
    : "no-cat-gate"

  const fatAssessment = fatAssessmentId
    ? (assessments.find((assessment) => assessment.id === fatAssessmentId) ?? null)
    : null
  const fatMark = fatAssessmentId ? (markByAssessment.get(fatAssessmentId) ?? null) : null
  const finalAssessment: StudentFinalAssessment | null = fatAssessment
    ? {
        assessmentId: fatAssessment.id,
        title: fatAssessment.title,
        dueDate: fatAssessment.dueDate.toISOString(),
        maxMarks: fatAssessment.maxMarks,
        percentage: fatMark?.percentage ?? null,
        published: fatMark !== null,
      }
    : null
  const fatPublished = finalAssessment?.published ?? false

  /*
   * A CAT/FAT course is only judged once its FAT has a published mark. Without one
   * we pass `null`, and `evaluateCourseOutcome` reports `not-judged` rather than
   * passing a CAT-only renormalised total off as final.
   *
   * A course with no CAT/FAT split has no FAT to wait for, so its total is judged
   * directly and the gate is disabled (`minimumCatPercent: null`) — there is no
   * CAT pool to set a minimum against.
   */
  const grandTotal = hasSplit
    ? fatPublished
      ? computation.percentage
      : null
    : computation.percentage

  const outcome = evaluateCourseOutcome(progress, grandTotal, {
    minimumCatPercent: hasSplit ? config.minimumCatPercent : null,
    minimumCatCompletionRatio: config.minimumCatCompletionRatio,
  })

  const ended = offering.endsOn !== null && offering.endsOn.getTime() <= now.getTime()

  return {
    offeringId: offering.id,
    courseId: offering.courseId,
    courseCode: offering.course.code,
    courseName: offering.course.name,
    term: offering.term,
    academicYear: offering.academicYear,
    startsOn: offering.startsOn?.toISOString() ?? null,
    endsOn: offering.endsOn?.toISOString() ?? null,
    ended,
    finalAssessment,
    cat: {
      markedCount: progress.markedCount,
      totalCount: progress.totalCount,
      completionRatio: progress.completionRatio,
      percent: progress.percent,
      status: catStatus,
      minimumPercent: hasSplit ? config.minimumCatPercent : null,
    },
    grandTotal,
    completedWeight: computation.completedWeight,
    totalWeight: computation.totalWeight,
    incomplete: computation.incomplete,
    outcome,
    arrear: arrearFor({
      outcome,
      finalAssessmentIdentified: finalAssessment !== null,
      finalAssessmentPublished: fatPublished,
      offeringEnded: ended,
    }),
  }
}

/**
 * Every course the caller is enrolled in, with its outcome and any arrear.
 *
 * Two queries beyond the enrollment lookup (assessments and the caller's own grades
 * for those offerings), issued in parallel, so a student with a handful of courses
 * pays one round trip of fan-out rather than one per course.
 *
 * `now` is injectable so the closed-term boundary and the due-date inclusion rule can
 * be tested at a fixed instant instead of around the day the suite runs.
 */
export async function listStudentCourseOutcomes(
  user: AuthUser,
  options: { now?: Date } = {},
): Promise<StudentCourseOutcome[]> {
  const now = options.now ?? new Date()

  const student = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (!student) return []

  const enrollments = await prisma.enrollment.findMany({
    where: { studentId: student.id, status: { in: liveEnrollmentStatuses() } },
    select: {
      offering: {
        select: {
          id: true,
          courseId: true,
          term: true,
          academicYear: true,
          startsOn: true,
          endsOn: true,
          gradingConfig: true,
          course: { select: { code: true, name: true } },
        },
      },
    },
  })
  if (enrollments.length === 0) return []

  const offeringIds = enrollments.map((enrollment) => enrollment.offering.id)

  const [assessmentRows, gradeRows] = await Promise.all([
    prisma.assessment.findMany({
      where: { offeringId: { in: offeringIds } },
      orderBy: { dueDate: "asc" },
      select: {
        id: true,
        offeringId: true,
        title: true,
        type: true,
        dueDate: true,
        maxMarks: true,
      },
    }),
    prisma.grade.findMany({
      where: { studentId: student.id, assessment: { offeringId: { in: offeringIds } } },
      select: { assessmentId: true, points: true, maxPoints: true, publishedAt: true },
    }),
  ])

  const assessmentsByOffering = new Map<string, AssessmentRow[]>()
  for (const assessment of assessmentRows) {
    const rows = assessmentsByOffering.get(assessment.offeringId)
    if (rows) rows.push(assessment)
    else assessmentsByOffering.set(assessment.offeringId, [assessment])
  }

  const gradesByAssessment = new Map<string, GradeRow>(
    gradeRows.map((grade) => [
      grade.assessmentId,
      {
        assessmentId: grade.assessmentId,
        points: Number(grade.points),
        maxPoints: Number(grade.maxPoints),
        publishedAt: grade.publishedAt,
      },
    ]),
  )

  const outcomes = enrollments.map(({ offering }) =>
    buildOutcome(
      offering,
      assessmentsByOffering.get(offering.id) ?? [],
      gradesByAssessment,
      student.id,
      now,
    ),
  )

  outcomes.sort(
    (a, b) =>
      b.academicYear - a.academicYear ||
      a.term.localeCompare(b.term) ||
      a.courseCode.localeCompare(b.courseCode),
  )
  return outcomes
}
