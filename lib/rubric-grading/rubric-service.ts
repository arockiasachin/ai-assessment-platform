import type { Prisma } from "@/lib/generated/prisma/client"
import { writeAuditLog } from "@/lib/grading/audit"
import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

import { validateRubricCoherence, type RubricCoherence } from "./validation"
import { RubricGradingError } from "./errors"
import { serializeRubric } from "./serialize"
import {
  rubricUpsertRequestSchema,
  type RubricResponse,
  type TeacherAssessmentSummary,
} from "./contracts"

/**
 * Rubric authoring for teachers.
 *
 * A teacher may only author a rubric for an assessment they own. Ownership means
 * either "I created the assessment" or "I teach the offering it belongs to" —
 * the same rule the grading pipeline and review queue use.
 */

export async function resolveTeacherStaffId(user: AuthUser): Promise<string> {
  if (user.role !== "teacher") throw new RubricGradingError(403, "Forbidden")
  const staff = await prisma.staffProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (!staff) throw new RubricGradingError(403, "Teacher profile not found.")
  return staff.id
}

export function teacherOwnsAssessment(
  assessment: { createdById: string; offering: { teacherId: string } | null },
  staffId: string,
): boolean {
  return assessment.createdById === staffId || assessment.offering?.teacherId === staffId
}

async function loadOwnedAssessment(
  user: AuthUser,
  assessmentId: string,
): Promise<{ id: string; type: string; maxMarks: number; title: string; staffId: string }> {
  const staffId = await resolveTeacherStaffId(user)
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      id: true,
      type: true,
      title: true,
      maxMarks: true,
      createdById: true,
      offering: { select: { teacherId: true } },
    },
  })
  if (!assessment) throw new RubricGradingError(404, "Assessment not found.")
  if (!teacherOwnsAssessment(assessment, staffId)) {
    throw new RubricGradingError(403, "Forbidden")
  }
  return {
    id: assessment.id,
    type: assessment.type,
    title: assessment.title,
    maxMarks: assessment.maxMarks,
    staffId,
  }
}

function toSummary(assessment: {
  id: string
  title: string
  type: string
  maxMarks: number
  dueDate: Date
  offering: {
    course: { code: string; name: string }
    classRoom: { name: string; section: string | null }
  }
  rubric: RubricResponse | null
}): TeacherAssessmentSummary {
  const section = assessment.offering.classRoom.section
  return {
    id: assessment.id,
    title: assessment.title,
    type: assessment.type,
    maxMarks: assessment.maxMarks,
    dueDate: assessment.dueDate.toISOString(),
    courseCode: assessment.offering.course.code,
    courseName: assessment.offering.course.name,
    className: `${assessment.offering.classRoom.name}${section ? ` ${section}` : ""}`,
    rubric: assessment.rubric,
  }
}

const assessmentInclude = {
  offering: {
    select: {
      course: { select: { code: true, name: true } },
      classRoom: { select: { name: true, section: true } },
    },
  },
  rubric: { include: { criteria: { orderBy: { order: "asc" as const } } } },
} satisfies Prisma.AssessmentInclude

/** Every assessment the teacher owns, with its rubric when one exists. */
export async function listRubricsForTeacher(user: AuthUser): Promise<TeacherAssessmentSummary[]> {
  const staffId = await resolveTeacherStaffId(user)
  const assessments = await prisma.assessment.findMany({
    where: { OR: [{ createdById: staffId }, { offering: { teacherId: staffId } }] },
    select: {
      id: true,
      title: true,
      type: true,
      maxMarks: true,
      dueDate: true,
      ...assessmentInclude,
    },
    orderBy: { dueDate: "desc" },
    take: 200,
  })
  return assessments.map((assessment) =>
    toSummary({
      ...assessment,
      rubric: assessment.rubric ? serializeRubric(assessment.rubric) : null,
    }),
  )
}

/** A single owned assessment and its rubric (or `null` when none exists yet). */
export async function getRubricForAssessment(
  user: AuthUser,
  assessmentId: string,
): Promise<TeacherAssessmentSummary> {
  const owned = await loadOwnedAssessment(user, assessmentId)
  const assessment = await prisma.assessment.findUniqueOrThrow({
    where: { id: owned.id },
    select: {
      id: true,
      title: true,
      type: true,
      maxMarks: true,
      dueDate: true,
      ...assessmentInclude,
    },
  })
  return toSummary({
    ...assessment,
    rubric: assessment.rubric ? serializeRubric(assessment.rubric) : null,
  })
}

export type UpsertRubricResult = {
  rubric: RubricResponse
  coherence: RubricCoherence
}

/**
 * Create or replace the rubric attached to one owned assessment. Criteria are
 * replaced wholesale so the stored rubric always matches the authored version;
 * existing suggestions keep their `criterionLabel` even if a criterion id goes
 * away, so the dedupe bucket in `latestSuggestionTotals` still holds.
 */
export async function upsertRubricForTeacher(
  user: AuthUser,
  input: unknown,
): Promise<UpsertRubricResult> {
  const request = rubricUpsertRequestSchema.parse(input)
  const owned = await loadOwnedAssessment(user, request.assessmentId)

  // A quiz is auto-scored by the deterministic scorer, which records its own
  // whole-quiz bucket. A rubric on the same assessment would be a second,
  // independent grading kind and the two would silently contaminate the same
  // grade total (bug-fix run 3, S-2). Refuse the illegal combination at the
  // point the rubric is added; an automatic multiple-choice quiz has no
  // descriptive criteria to author against.
  if (owned.type === "QUIZ") {
    throw new RubricGradingError(409, "A quiz is auto-scored and cannot have a rubric.")
  }

  const coherence = validateRubricCoherence(request, { assessmentMaxMarks: owned.maxMarks })

  // A published grade was produced against a specific rubric, so that rubric is
  // frozen. This also keeps the AI suggestion buckets stable: replacing criteria
  // would orphan their suggestions into a second, label-keyed bucket.
  const publishedGrades = await prisma.grade.count({
    where: { assessmentId: request.assessmentId, publishedAt: { not: null } },
  })
  if (publishedGrades > 0) {
    throw new RubricGradingError(
      409,
      "Cannot edit a rubric after a grade has been published for this assessment.",
    )
  }

  const saved = await prisma.$transaction(async (tx) => {
    const existing = await tx.rubric.findUnique({
      where: { assessmentId: request.assessmentId },
      select: { id: true, title: true },
    })

    const rubric = await tx.rubric.upsert({
      where: { assessmentId: request.assessmentId },
      create: {
        assessmentId: request.assessmentId,
        courseId: null,
        createdById: owned.staffId,
        title: request.title,
        description: request.description ?? null,
        maxPoints: coherence.maxPoints,
        promptVersion: request.promptVersion ?? "v1",
      },
      update: {
        title: request.title,
        description: request.description ?? null,
        maxPoints: coherence.maxPoints,
        ...(request.promptVersion ? { promptVersion: request.promptVersion } : {}),
      },
    })

    const oldCriteria = await tx.rubricCriterion.findMany({
      where: { rubricId: rubric.id },
      select: { id: true },
    })

    await tx.rubricCriterion.deleteMany({ where: { rubricId: rubric.id } })

    // Drop the AI drafts scored against the criteria just replaced. Their
    // `rubricCriterionId` would otherwise be nulled into a separate label-keyed
    // bucket, and a re-run would sum old and new scores (the bug-fix run 1
    // defect). No published grade exists at this point, so nothing human-facing
    // is affected; the audit rows for the old suggestions remain.
    if (oldCriteria.length > 0) {
      await tx.aIGradeSuggestion.deleteMany({
        where: {
          assessmentId: request.assessmentId,
          rubricCriterionId: { in: oldCriteria.map((criterion) => criterion.id) },
        },
      })
    }

    if (coherence.criteria.length > 0) {
      await tx.rubricCriterion.createMany({
        data: coherence.criteria.map((criterion) => ({
          rubricId: rubric.id,
          order: criterion.order,
          label: criterion.label,
          description: criterion.description,
          weight: criterion.weight,
          maxPoints: criterion.maxPoints,
          levelsJson:
            criterion.levels.length > 0
              ? (criterion.levels as unknown as Prisma.InputJsonValue)
              : undefined,
        })),
      })
    }

    const withCriteria = await tx.rubric.findUniqueOrThrow({
      where: { id: rubric.id },
      include: { criteria: { orderBy: { order: "asc" } } },
    })

    await writeAuditLog(tx, {
      entityType: "Rubric",
      entityId: rubric.id,
      action: existing ? "rubric.updated" : "rubric.created",
      actor: { id: user.id, role: user.role },
      before: existing ? { title: existing.title } : undefined,
      after: {
        assessmentId: request.assessmentId,
        title: request.title,
        maxPoints: coherence.maxPoints,
        criterionCount: coherence.criteria.length,
      },
    })

    return serializeRubric(withCriteria)
  })

  return { rubric: saved, coherence }
}
