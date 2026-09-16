import "server-only"

import type {
  GradingAssessmentOption,
  OfferingCatEligibilityRow,
  OfferingGradingConfigValue,
  OfferingGradingResponse,
} from "@/lib/contracts/courses"
import type { AssessmentType } from "@/lib/generated/prisma/client"
import { writeAuditLog } from "@/lib/grading/audit"
import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

import { resolveMarks, type GradeCandidateInput } from "@/lib/lms-export/final-grade"

import {
  derivedGradingMembership,
  resolveGradingPolicy,
  type StoredGradingConfig,
} from "./offering-config"
import { buildCatEligibility, type EligibilityStudent } from "./offering-eligibility"

/**
 * Read and write an offering's grading policy.
 *
 * ## Authorization
 *
 * A teacher owns *offerings*, so the rule is the offering's `teacherId` matching the caller's
 * staff profile. An offering the caller does not teach reports `not-found` rather than `403`,
 * so the endpoint never confirms that another teacher's offering exists — the same convention
 * `setCourseCategoryForTeacher` and the assessment release action use.
 *
 * ## Why the final-assessment id is validated on write but tolerated on read
 *
 * The asymmetry is deliberate and is the interesting part of this module.
 *
 * - **On write, an id that is not one of this offering's assessments is rejected.** Without
 *   that check a caller could name another offering's assessment as this course's final one,
 *   and the weighted total would silently include a mark that belongs to a different class.
 *   It is a client error and it should be reported as one.
 * - **On read, a stale id is tolerated** and falls back to the due-date heuristic. A stored
 *   policy can outlive the assessment it names — the assessment is deleted, or a policy is
 *   copied between offerings — and a stale id must not stop a teacher exporting their grades.
 *   `resolveFinalGradeConfig` handles that, and `derivedGradingMembership` reports it so the
 *   editor can show "derived" rather than implying the teacher chose it.
 */

export type OfferingGradingReadResult =
  { kind: "ok"; payload: OfferingGradingResponse } | { kind: "not-found" }

export type OfferingGradingWriteResult =
  | { kind: "ok"; payload: OfferingGradingResponse }
  | { kind: "not-found" }
  | { kind: "invalid-final-assessment" }

/** The caller's staff id, or `null` when they have no staff profile. */
async function staffIdFor(user: AuthUser): Promise<string | null> {
  const staff = await prisma.staffProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  return staff?.id ?? null
}

/**
 * Load the offering together with the assessments the policy resolves against.
 *
 * Scoped by `teacherId` in the query itself rather than fetched-then-compared, so a
 * non-owner's offering is indistinguishable from one that does not exist.
 */
async function loadOwnedOfferingForGrading(offeringId: string, staffId: string) {
  return prisma.courseOffering.findFirst({
    where: { id: offeringId, teacherId: staffId },
    select: {
      id: true,
      gradingConfig: true,
      course: { select: { code: true, name: true } },
      assessments: {
        orderBy: { dueDate: "asc" },
        select: { id: true, title: true, type: true, dueDate: true, maxMarks: true },
      },
    },
  })
}

function toAssessmentOption(assessment: {
  id: string
  title: string
  type: AssessmentType
  dueDate: Date
  maxMarks: number
}): GradingAssessmentOption {
  return {
    id: assessment.id,
    title: assessment.title,
    type: assessment.type,
    dueDate: assessment.dueDate.toISOString(),
    maxMarks: assessment.maxMarks,
  }
}

/** Build the response payload from a loaded offering and an effective policy. */
function toPayload(
  offering: {
    id: string
    course: { code: string; name: string }
    assessments: {
      id: string
      title: string
      type: AssessmentType
      dueDate: Date
      maxMarks: number
    }[]
  },
  config: OfferingGradingConfigValue,
  source: "stored" | "defaults" | "stored-invalid",
  roster: OfferingCatEligibilityRow[],
): OfferingGradingResponse {
  const assessments = offering.assessments.map((assessment) => ({
    id: assessment.id,
    type: assessment.type,
    dueDate: assessment.dueDate,
  }))
  const membership = derivedGradingMembership(config, assessments)

  return {
    success: true,
    offeringId: offering.id,
    courseCode: offering.course.code,
    courseName: offering.course.name,
    config,
    // A stored-but-unusable policy is reported as defaulted, because that is what is in
    // force. The editor shows a warning distinguishing it from a never-configured offering.
    usingDefaults: source !== "stored",
    assessments: offering.assessments.map(toAssessmentOption),
    derived: membership,
    roster,
  }
}

/**
 * Per-student CAT standing for an offering, for the eligibility panel.
 *
 * **The marks come from the export's own resolver** (`resolveMarks`), not from a second query
 * written here. That matters more than it looks: the gate's verdict and the exported grand
 * total are about the same marks, and two independent implementations of "which marks count"
 * would eventually disagree — one saying a student cleared the CAT gate while the other
 * excluded the very marks that cleared it.
 *
 * `resolveMarks` already applies the published-only rule, so unpublished marks are excluded
 * rather than zero-filled here too.
 */
async function loadCatEligibility(
  offeringId: string,
  stored: StoredGradingConfig,
): Promise<OfferingCatEligibilityRow[]> {
  const [assessmentRows, enrollmentRows, gradeRows] = await Promise.all([
    prisma.assessment.findMany({
      where: { offeringId },
      orderBy: { dueDate: "asc" },
      select: { id: true, title: true, type: true, dueDate: true },
    }),
    prisma.enrollment.findMany({
      where: { offeringId, status: "active" },
      orderBy: { student: { registerNumber: "asc" } },
      select: { student: { select: { id: true, fullName: true, registerNumber: true } } },
    }),
    prisma.grade.findMany({
      where: { assessment: { offeringId } },
      select: {
        assessmentId: true,
        studentId: true,
        points: true,
        maxPoints: true,
        publishedAt: true,
      },
    }),
  ])

  const byStudent = new Map<string, GradeCandidateInput[]>()
  for (const enrollment of enrollmentRows) {
    byStudent.set(
      enrollment.student.id,
      assessmentRows.map((assessment) => ({ assessmentId: assessment.id, modern: null })),
    )
  }
  for (const grade of gradeRows) {
    const candidates = byStudent.get(grade.studentId)
    if (!candidates) continue
    const index = candidates.findIndex((candidate) => candidate.assessmentId === grade.assessmentId)
    if (index === -1) continue
    candidates[index] = {
      assessmentId: grade.assessmentId,
      modern: {
        points: Number(grade.points),
        maxPoints: Number(grade.maxPoints),
        publishedAt: grade.publishedAt,
      },
    }
  }

  const students: EligibilityStudent[] = enrollmentRows.map((enrollment) => ({
    id: enrollment.student.id,
    name: enrollment.student.fullName,
    registerNumber: enrollment.student.registerNumber,
    marks: resolveMarks(byStudent.get(enrollment.student.id) ?? []).marks.map((mark) => ({
      assessmentId: mark.assessmentId,
      percentage: mark.percentage,
      publishedAt: mark.publishedAt,
    })),
  }))

  const rows = buildCatEligibility(stored, assessmentRows, students)

  return rows.map((row) => ({
    studentId: row.studentId,
    name: row.name,
    registerNumber: row.registerNumber,
    catPercent: row.progress.percent,
    markedCount: row.progress.markedCount,
    totalCount: row.progress.totalCount,
    completionRatio: row.progress.completionRatio,
    status: row.status,
  }))
}

/** The policy in force for an offering, plus what it resolves to against its assessments. */
export async function getOfferingGradingForTeacher(
  user: AuthUser,
  offeringId: string,
): Promise<OfferingGradingReadResult> {
  const staffId = await staffIdFor(user)
  if (!staffId) return { kind: "not-found" }

  const offering = await loadOwnedOfferingForGrading(offeringId, staffId)
  if (!offering) return { kind: "not-found" }

  const resolved = resolveGradingPolicy(offering.gradingConfig)
  // No roster without a stored policy: reporting "below the CAT minimum" against a gate the
  // teacher never set would fail students on a rule the course does not have. An unconfigured
  // offering shows the default as a starting point and no verdicts.
  const roster =
    resolved.source === "stored" ? await loadCatEligibility(offering.id, resolved.config) : []
  return { kind: "ok", payload: toPayload(offering, resolved.config, resolved.source, roster) }
}

/**
 * Store a new policy for an offering.
 *
 * Audited, because this changes how every student's final grade is computed. The row records
 * the before and after policies so "why did the total change" is answerable later — the same
 * reason a manual mark publishes through the audited pipeline rather than writing `Grade`
 * directly.
 */
export async function setOfferingGradingForTeacher(
  user: AuthUser,
  offeringId: string,
  config: OfferingGradingConfigValue,
): Promise<OfferingGradingWriteResult> {
  const staffId = await staffIdFor(user)
  if (!staffId) return { kind: "not-found" }

  const offering = await loadOwnedOfferingForGrading(offeringId, staffId)
  if (!offering) return { kind: "not-found" }

  // A named final assessment must belong to this offering. See the module docblock for why
  // this is stricter than the read path.
  if (
    config.finalAssessmentId !== null &&
    !offering.assessments.some((assessment) => assessment.id === config.finalAssessmentId)
  ) {
    return { kind: "invalid-final-assessment" }
  }

  const before = resolveGradingPolicy(offering.gradingConfig)

  await prisma.$transaction(async (tx) => {
    await tx.courseOffering.update({
      where: { id: offering.id },
      data: { gradingConfig: config },
    })
    await writeAuditLog(tx, {
      entityType: "CourseOffering",
      entityId: offering.id,
      action: "offering.grading_config.updated",
      actor: { id: user.id, role: user.role },
      before: { gradingConfig: before.config, source: before.source },
      after: { gradingConfig: config, source: "stored" },
    })
  })

  const roster = await loadCatEligibility(offering.id, config)
  return { kind: "ok", payload: toPayload(offering, config, "stored", roster) }
}

// ---------------------------------------------------------------------------
// The FAT gate, enforced
// ---------------------------------------------------------------------------

/**
 * The verdict on whether a student may sit an offering's final assessment.
 *
 * A union rather than a boolean because the two ways of not being allowed are different facts, and
 * only one of them is about the student — the same distinction `evaluateFatEligibility` draws for
 * the roster.
 */
export type FatGateDecision =
  | { allowed: true }
  /** The CAT minimum is genuinely not met. This is the only case that refuses. */
  | { allowed: false; reason: "below-cat-minimum"; message: string }

/**
 * Whether the CAT gate refuses this student their final assessment.
 *
 * ## Why this exists
 *
 * The gate has been *reported* since the policy was wired — the teacher's offering page shows each
 * student's verdict — but nothing enforced it, so the rule the owner asked for ("students should have
 * a minimum CAT score to appear FAT") applied to nobody. This is the enforcement.
 *
 * ## Three narrowings, each deliberate
 *
 * 1. **Only when a policy is stored.** An unconfigured offering has no gate, exactly as it has no
 *    CAT/FAT split, and this must not invent one — same rule as the export.
 * 2. **Only for the resolved FAT.** Resolving the final assessment is the policy's own job
 *    (`resolveFinalGradeConfig`), so a teacher's explicit choice is honoured and everything else is
 *    allowed through. A course whose FAT is a group project therefore does not refuse a quiz attempt.
 * 3. **Never on `insufficient-cat-work`.** If too little of the CAT pool is marked, the verdict is
 *    "not enough evidence yet", and refusing a student on unfinished *marking* would be the same class
 *    of error as zero-filling a mean. Only a genuine `below-cat-minimum` refuses.
 *
 * ## Advisory elsewhere, enforced here
 *
 * The offering page's roster stays advisory — a teacher needs to see verdicts without them blocking
 * anything. This function is the enforcement point, called from the attempt-start path. Submission-based
 * finals (descriptive, code, group) are not gated yet; only a quiz FAT is, which is recorded in
 * `docs/plans/wave-4.md` §11 rather than half-built here.
 */
export async function evaluateFatGateForStudent(input: {
  offeringId: string
  assessmentId: string
  studentId: string
  now?: Date
}): Promise<FatGateDecision> {
  const offering = await prisma.courseOffering.findUnique({
    where: { id: input.offeringId },
    select: {
      gradingConfig: true,
      assessments: {
        orderBy: { dueDate: "asc" },
        select: { id: true, title: true, type: true, dueDate: true },
      },
    },
  })
  if (!offering) return { allowed: true }

  const resolved = resolveGradingPolicy(offering.gradingConfig)
  // (1) No stored policy means no gate to enforce.
  if (resolved.source !== "stored") return { allowed: true }

  // (2) Only the resolved FAT is gated.
  const fatAssessmentId = derivedGradingMembership(
    resolved.config,
    offering.assessments,
  )?.fatAssessmentId
  if (fatAssessmentId !== input.assessmentId) return { allowed: true }

  const grades = await prisma.grade.findMany({
    where: { studentId: input.studentId, assessment: { offeringId: input.offeringId } },
    select: {
      assessmentId: true,
      points: true,
      maxPoints: true,
      publishedAt: true,
    },
  })

  // `resolveMarks` applies the published-only rule, so an unapproved suggestion is excluded here for
  // the same reason it is excluded from every mean.
  const candidates: GradeCandidateInput[] = offering.assessments.map((assessment) => {
    const grade = grades.find((row) => row.assessmentId === assessment.id)
    return {
      assessmentId: assessment.id,
      modern: grade
        ? {
            points: Number(grade.points),
            maxPoints: Number(grade.maxPoints),
            publishedAt: grade.publishedAt,
          }
        : null,
    }
  })

  const student: EligibilityStudent = {
    id: input.studentId,
    name: "",
    registerNumber: "",
    marks: resolveMarks(candidates).marks.map((mark) => ({
      assessmentId: mark.assessmentId,
      percentage: mark.percentage,
      publishedAt: mark.publishedAt,
    })),
  }

  const [row] = buildCatEligibility(
    resolved.config,
    offering.assessments,
    [student],
    input.now ? { now: input.now } : {},
  )
  // No row means the policy resolves to no CAT/FAT split (fewer than two assessments), so there is
  // nothing to judge and nothing to refuse.
  if (!row) return { allowed: true }

  // (3) `insufficient-cat-work` and `eligible` both pass. Only a real shortfall refuses.
  if (row.status !== "below-cat-minimum") return { allowed: true }

  const minimum = resolved.config.minimumCatPercent
  const scored = row.progress.percent === null ? "no" : `${row.progress.percent}%`
  return {
    allowed: false,
    reason: "below-cat-minimum",
    message:
      `You have not met the minimum continuous-assessment score for this course, so the final ` +
      `assessment is not available to you yet. Your continuous assessment is ${scored} of the ` +
      `${minimum}% required. Speak to your teacher if you believe this is wrong.`,
  }
}
