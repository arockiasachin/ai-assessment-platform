import {
  createGroupRequestSchema,
  formTeamsRequestSchema,
  saveFormationProfilesRequestSchema,
  updateGroupRequestSchema,
  type ContributionEvidenceValue,
  type FormationCriterionValue,
  type GroupSummary,
  type MilestoneResponse,
  type RosterStudent,
} from "@/lib/contracts/groups"
import type { Prisma } from "@/lib/generated/prisma/client"
import { writeAuditLog } from "@/lib/grading/audit"
import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

import {
  analyzeGroup,
  suggestIndividualGrades,
  type GroupAnalysis,
  type GroupEvaluationRow,
  type SuggestedIndividualGrade,
} from "./analysis"
import { loadOwnedOffering, resolveTeacherStaffId } from "./authz"
import { GroupError, GroupValidationError } from "./errors"
import {
  formTeams,
  type FormationCriterion,
  type FormationResult,
  type FormationStudent,
} from "./formation"
import {
  readFormationProfile,
  toFormationProfileJson,
  toFormationStudent,
} from "./formation-profile"
import { analyzeCohortProgress, summarizeMilestones, type GroupProgress } from "./milestones"
import { buildContributionEvidence, serializeGroupSummary, serializeMilestone } from "./serialize"
import { readStoredRatings } from "./storage"

const groupDetailInclude = {
  members: { include: { student: true } },
  milestones: true,
} as const

type GroupWithDetail = Prisma.GroupGetPayload<{ include: typeof groupDetailInclude }>

async function loadTeacherGroup(user: AuthUser, groupId: string): Promise<GroupWithDetail> {
  const staffId = await resolveTeacherStaffId(user)
  const group = await prisma.group.findFirst({
    where: { id: groupId, offering: { teacherId: staffId } },
    include: groupDetailInclude,
  })
  if (!group) throw new GroupError(404, "Group not found.")
  return group
}

async function loadEnrolledStudentIds(offeringId: string, studentIds: string[]): Promise<string[]> {
  if (studentIds.length === 0) return []
  const enrollments = await prisma.enrollment.findMany({
    where: { offeringId, status: "active", studentId: { in: studentIds } },
    select: { studentId: true },
  })
  return enrollments.map((enrollment) => enrollment.studentId)
}

async function assertUniqueGroupName(offeringId: string, name: string, excludingId?: string) {
  const existing = await prisma.group.findFirst({
    where: { offeringId, name, ...(excludingId ? { id: { not: excludingId } } : {}) },
    select: { id: true },
  })
  if (existing)
    throw new GroupError(409, `A group named "${name}" already exists in this offering.`)
}

const groupListInclude = {
  members: { include: { student: true } },
  milestones: true,
} as const

export type TeacherOffering = {
  id: string
  courseCode: string
  courseName: string
  className: string
  term: string
  academicYear: number
  groupCount: number
}

/** The teacher's own offerings, for the groups UI picker. */
export async function listTeacherOfferings(user: AuthUser): Promise<TeacherOffering[]> {
  const staffId = await resolveTeacherStaffId(user)
  const offerings = await prisma.courseOffering.findMany({
    where: { teacherId: staffId },
    select: {
      id: true,
      term: true,
      academicYear: true,
      course: { select: { code: true, name: true } },
      classRoom: { select: { name: true, section: true } },
      _count: { select: { groups: true } },
    },
    orderBy: [{ academicYear: "desc" }, { term: "asc" }],
    take: 200,
  })
  return offerings.map((offering) => {
    const section = offering.classRoom.section
    return {
      id: offering.id,
      courseCode: offering.course.code,
      courseName: offering.course.name,
      className: `${offering.classRoom.name}${section ? ` ${section}` : ""}`,
      term: offering.term,
      academicYear: offering.academicYear,
      groupCount: offering._count.groups,
    }
  })
}

/** Active students enrolled in one owned offering, for the group pickers. */
export async function listOfferingRosterForTeacher(
  user: AuthUser,
  offeringId: string,
): Promise<RosterStudent[]> {
  await loadOwnedOffering(user, offeringId)
  const enrollments = await prisma.enrollment.findMany({
    where: { offeringId, status: "active" },
    select: {
      student: {
        select: {
          id: true,
          fullName: true,
          registerNumber: true,
          formationProfile: true,
        },
      },
    },
    orderBy: { student: { fullName: "asc" } },
  })
  return enrollments.map((enrollment) => {
    const profile = readFormationProfile(enrollment.student.formationProfile)
    return {
      studentId: enrollment.student.id,
      fullName: enrollment.student.fullName,
      registerNumber: enrollment.student.registerNumber,
      attributes: profile.attributes,
      availability: profile.availability ?? null,
    }
  })
}

/**
 * Persist per-student formation attributes/availability for one owned offering,
 * so the roster is configured once instead of re-sent on every formation run.
 * Every student must be actively enrolled, so a teacher cannot write profiles
 * for a student outside their roster.
 */
export async function saveFormationProfilesForTeacher(
  user: AuthUser,
  input: unknown,
): Promise<RosterStudent[]> {
  const request = saveFormationProfilesRequestSchema.parse(input)
  await loadOwnedOffering(user, request.offeringId)

  const uniqueStudentIds = [...new Set(request.profiles.map((profile) => profile.studentId))]
  const enrolled = await loadEnrolledStudentIds(request.offeringId, uniqueStudentIds)
  if (enrolled.length !== uniqueStudentIds.length) {
    throw new GroupValidationError(
      "Every formation profile must belong to a student actively enrolled in the offering.",
    )
  }

  await prisma.$transaction(
    request.profiles.map((profile) =>
      prisma.studentProfile.update({
        where: { id: profile.studentId },
        data: {
          formationProfile: toFormationProfileJson({
            attributes: profile.attributes,
            ...(profile.availability !== undefined ? { availability: profile.availability } : {}),
          }),
        },
      }),
    ),
  )

  return listOfferingRosterForTeacher(user, request.offeringId)
}

/** Every group on every offering the signed-in teacher owns. */
export async function listGroupsForTeacher(
  user: AuthUser,
  offeringId?: string,
): Promise<GroupSummary[]> {
  const staffId = await resolveTeacherStaffId(user)
  let where: Prisma.GroupWhereInput = { offering: { teacherId: staffId } }
  if (offeringId) {
    await loadOwnedOffering(user, offeringId)
    where = { offeringId }
  }
  const groups = await prisma.group.findMany({
    where,
    include: groupListInclude,
    orderBy: [{ offeringId: "asc" }, { name: "asc" }],
  })

  const cohort = analyzeCohortProgress(
    groups.map((group) => ({ groupId: group.id, milestones: group.milestones })),
  )
  const cohortById = new Map(cohort.map((entry) => [entry.groupId, entry]))

  return groups.map((group) => {
    const entry = cohortById.get(group.id)
    return serializeGroupSummary(group, entry?.progress ?? summarizeMilestones(group.milestones), {
      behind: entry?.behind ?? false,
      lopsided: entry?.lopsided ?? false,
    })
  })
}

export type GroupDetail = { group: GroupSummary; milestones: MilestoneResponse[] }

export async function getGroupDetailForTeacher(
  user: AuthUser,
  groupId: string,
): Promise<GroupDetail> {
  const group = await loadTeacherGroup(user, groupId)
  const progress = summarizeMilestones(group.milestones)
  return {
    group: serializeGroupSummary(group, progress),
    milestones: group.milestones.map(serializeMilestone),
  }
}

/** Create one team manually and place its members. */
export async function createGroupForTeacher(user: AuthUser, input: unknown): Promise<GroupSummary> {
  const request = createGroupRequestSchema.parse(input)
  await loadOwnedOffering(user, request.offeringId)
  await assertUniqueGroupName(request.offeringId, request.name)

  const uniqueStudentIds = [...new Set(request.studentIds)]
  const enrolled = await loadEnrolledStudentIds(request.offeringId, uniqueStudentIds)
  if (enrolled.length !== uniqueStudentIds.length) {
    throw new GroupValidationError("Every group member must be actively enrolled in the offering.")
  }

  const groupId = await prisma.$transaction(async (tx) => {
    const group = await tx.group.create({
      data: {
        offeringId: request.offeringId,
        name: request.name,
        projectTitle: request.projectTitle ?? null,
        status: "FORMING",
        metadata: { source: "manual", createdByUserId: user.id },
      },
    })
    await tx.groupMember.createMany({
      data: uniqueStudentIds.map((studentId) => ({ groupId: group.id, studentId })),
    })
    await writeAuditLog(tx, {
      entityType: "Group",
      entityId: group.id,
      action: "group.created",
      actor: { id: user.id, role: user.role },
      after: {
        offeringId: request.offeringId,
        name: request.name,
        memberCount: uniqueStudentIds.length,
      },
    })
    return group.id
  })

  const created = await prisma.group.findUniqueOrThrow({
    where: { id: groupId },
    include: groupDetailInclude,
  })
  return serializeGroupSummary(created, summarizeMilestones(created.milestones))
}

/** Rename, retitle, archive, or re-roster a group. Members are soft-removed. */
export async function updateGroupForTeacher(
  user: AuthUser,
  groupId: string,
  input: unknown,
): Promise<GroupSummary> {
  const request = updateGroupRequestSchema.parse(input)
  const group = await loadTeacherGroup(user, groupId)
  if (request.name && request.name !== group.name) {
    await assertUniqueGroupName(group.offeringId, request.name, groupId)
  }

  const addStudentIds = [...new Set(request.addStudentIds ?? [])]
  const removeStudentIds = [...new Set(request.removeStudentIds ?? [])].filter(
    (studentId) => !addStudentIds.includes(studentId),
  )
  if (addStudentIds.length > 0) {
    const enrolled = await loadEnrolledStudentIds(group.offeringId, addStudentIds)
    if (enrolled.length !== addStudentIds.length) {
      throw new GroupValidationError(
        "Every group member must be actively enrolled in the offering.",
      )
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.group.update({
      where: { id: groupId },
      data: {
        ...(request.name !== undefined ? { name: request.name } : {}),
        ...(request.projectTitle !== undefined ? { projectTitle: request.projectTitle } : {}),
        ...(request.status !== undefined ? { status: request.status } : {}),
      },
    })

    if (removeStudentIds.length > 0) {
      await tx.groupMember.updateMany({
        where: { groupId, studentId: { in: removeStudentIds } },
        data: { leftAt: new Date() },
      })
    }
    if (addStudentIds.length > 0) {
      for (const studentId of addStudentIds) {
        await tx.groupMember.upsert({
          where: { groupId_studentId: { groupId, studentId } },
          create: { groupId, studentId },
          update: { leftAt: null },
        })
      }
    }

    await writeAuditLog(tx, {
      entityType: "Group",
      entityId: groupId,
      action: "group.updated",
      actor: { id: user.id, role: user.role },
      after: {
        fields: Object.keys(request),
        added: addStudentIds,
        removed: removeStudentIds,
      },
    })
  })

  const updated = await prisma.group.findUniqueOrThrow({
    where: { id: groupId },
    include: groupDetailInclude,
  })
  return serializeGroupSummary(updated, summarizeMilestones(updated.milestones))
}

export type FormationOutcome = {
  formation: FormationResult
  persistedGroupIds: string[]
}

/**
 * Run the CATME maximin formation over the offering's students. Formation
 * criteria and weights are supplied per run; per-student attributes and
 * availability are read from `StudentProfile.formationProfile` (persisted once
 * through `saveFormationProfilesForTeacher`). A `students` array in the request
 * is an explicit one-off override. Setting `persist: true` stores the result as
 * `Group` + `GroupMember` rows.
 */
export async function formTeamsForTeacher(
  user: AuthUser,
  input: unknown,
): Promise<FormationOutcome> {
  const request = formTeamsRequestSchema.parse(input)
  const offering = await loadOwnedOffering(user, request.offeringId)

  const students: FormationStudent[] = await (async () => {
    if (request.students && request.students.length > 0) {
      const ids = request.students.map((student) => student.studentId)
      const enrolled = await loadEnrolledStudentIds(request.offeringId, ids)
      if (enrolled.length !== new Set(ids).size) {
        throw new GroupValidationError(
          "Every formation candidate must be actively enrolled in the offering.",
        )
      }
      return request.students.map((student) => ({
        studentId: student.studentId,
        attributes: student.attributes,
        availability: student.availability,
      }))
    }
    const enrollments = await prisma.enrollment.findMany({
      where: { offeringId: request.offeringId, status: "active" },
      select: {
        studentId: true,
        student: { select: { formationProfile: true } },
      },
      orderBy: { studentId: "asc" },
    })
    return enrollments.map((enrollment) => ({
      studentId: enrollment.studentId,
      ...toFormationStudent(readFormationProfile(enrollment.student.formationProfile)),
    }))
  })()

  if (students.length < 2) {
    throw new GroupValidationError("At least two enrolled students are required to form teams.")
  }

  const criteria: FormationCriterion[] = request.criteria.map(
    (criterion: FormationCriterionValue) => ({
      id: criterion.id,
      label: criterion.label,
      kind: criterion.kind,
      weight: criterion.weight,
      attribute: criterion.attribute,
    }),
  )

  const formation = formTeams({
    students,
    criteria,
    teamSize: request.teamSize,
    teamCount: request.teamCount,
  })

  const persistedGroupIds: string[] = []
  if (request.persist) {
    const prefix = request.groupNamePrefix ?? "Team"
    const names = formation.teams.map((team) => `${prefix} ${team.index + 1}`)
    for (const name of names) await assertUniqueGroupName(request.offeringId, name)

    await prisma.$transaction(async (tx) => {
      for (const team of formation.teams) {
        const group = await tx.group.create({
          data: {
            offeringId: request.offeringId,
            name: `${prefix} ${team.index + 1}`,
            status: "FORMING",
            metadata: {
              source: "auto-formation",
              formation: {
                generator: "groups-peereval",
                objective: formation.objective,
                teamCount: formation.teamCount,
                criteria: formation.criteria,
                score: team.score,
                commonAvailability: team.commonAvailability,
                formedAt: new Date().toISOString(),
              },
            },
          },
        })
        await tx.groupMember.createMany({
          data: team.memberIds.map((studentId) => ({ groupId: group.id, studentId })),
        })
        await writeAuditLog(tx, {
          entityType: "Group",
          entityId: group.id,
          action: "group.formed",
          actor: { id: user.id, role: user.role },
          after: {
            offeringId: offering.id,
            memberIds: team.memberIds,
            objective: formation.objective,
          },
        })
        persistedGroupIds.push(group.id)
      }
    })
  }

  return { formation, persistedGroupIds }
}

export type GroupAnalysisResult = {
  analysis: GroupAnalysis
  contributionEvidence: ContributionEvidenceValue
  suggestedIndividualGrades: SuggestedIndividualGrade[] | null
}

export type OfferingAnalysis = {
  groups: GroupAnalysisResult[]
  cohortProgress: GroupProgress[]
}

/**
 * Assemble the instructor analysis for every group in an offering: both
 * adjustment factors, free-rider signals, contribution evidence and milestone
 * progress. When a `groupGrade` (or an owned GROUP_PROJECT assessment whose
 * members all carry the same mark) is available, per-student suggestions are
 * returned but never published.
 */
export async function getOfferingAnalysisForTeacher(
  user: AuthUser,
  options: { offeringId: string; assessmentId?: string; groupGrade?: number },
): Promise<OfferingAnalysis> {
  const offering = await loadOwnedOffering(user, options.offeringId)
  const groups = await prisma.group.findMany({
    where: { offeringId: offering.id },
    include: groupDetailInclude,
    orderBy: { name: "asc" },
  })
  const groupIds = groups.map((group) => group.id)

  const [evaluations, contributions] = await Promise.all([
    prisma.peerEvaluation.findMany({
      where: { groupId: { in: groupIds } },
      select: {
        groupId: true,
        evaluatorId: true,
        evaluateeId: true,
        status: true,
        dimensions: true,
      },
    }),
    prisma.contributionEvent.findMany({
      where: { groupId: { in: groupIds } },
      orderBy: { occurredAt: "asc" },
    }),
  ])

  let groupGrade = options.groupGrade ?? null
  if (groupGrade === null && options.assessmentId) {
    groupGrade = await resolveUniformGroupGrade(user, options.assessmentId, groups, offering.id)
  }

  const analysisByGroup = new Map<string, GroupAnalysis>()
  for (const group of groups) {
    // Soft-removed members (`leftAt != null`) keep their historical evaluations
    // for audit, but they are no longer on the roster: they must not receive an
    // adjustment factor or a suggested individual grade, and their past ratings
    // must not skew the team norm. `serializeGroupSummary` already hides them.
    const memberIds = group.members
      .filter((member) => member.leftAt === null)
      .map((member) => member.studentId)
    const rows: GroupEvaluationRow[] = evaluations
      .filter((evaluation) => evaluation.groupId === group.id)
      .map((evaluation) => ({
        evaluatorId: evaluation.evaluatorId,
        evaluateeId: evaluation.evaluateeId,
        status: evaluation.status,
        ratings: readStoredRatings(evaluation.dimensions) ?? {
          contributing: 0,
          interacting: 0,
          keepingOnTrack: 0,
          expectingQuality: 0,
          knowledgeSkillsAbilities: 0,
        },
      }))
      .filter((row) => Object.values(row.ratings).every((value) => value >= 1 && value <= 5))
    analysisByGroup.set(
      group.id,
      analyzeGroup({
        groupId: group.id,
        memberIds,
        evaluations: rows,
        contributions: contributions
          .filter((event) => event.groupId === group.id)
          .map((event) => ({
            studentId: event.studentId,
            type: event.type,
            weight: event.weight,
            occurredAt: event.occurredAt,
          })),
        milestones: group.milestones,
      }),
    )
  }

  const cohortProgress = analyzeCohortProgress(
    groups.map((group) => ({ groupId: group.id, milestones: group.milestones })),
  )

  return {
    groups: groups.map((group) => {
      const analysis = analysisByGroup.get(group.id)!
      const groupContributions = contributions.filter((event) => event.groupId === group.id)
      return {
        analysis,
        contributionEvidence: buildContributionEvidence(group.id, groupContributions),
        suggestedIndividualGrades:
          groupGrade === null ? null : suggestIndividualGrades(groupGrade, analysis),
      }
    }),
    cohortProgress,
  }
}

/**
 * A GROUP_PROJECT assessment can supply the group grade when every active member
 * carries the same mark. Differing marks mean the grade has already been
 * individualised, so no suggestion is produced.
 */
async function resolveUniformGroupGrade(
  user: AuthUser,
  assessmentId: string,
  groups: GroupWithDetail[],
  offeringId: string,
): Promise<number | null> {
  const staffId = await resolveTeacherStaffId(user)
  const assessment = await prisma.assessment.findFirst({
    where: {
      id: assessmentId,
      offeringId,
      type: "GROUP_PROJECT",
      OR: [{ createdById: staffId }, { offering: { teacherId: staffId } }],
    },
    select: { id: true },
  })
  if (!assessment) throw new GroupError(404, "Group-project assessment not found.")

  const memberIds = [
    ...new Set(
      groups.flatMap((group) =>
        group.members.filter((member) => member.leftAt === null).map((m) => m.studentId),
      ),
    ),
  ]
  if (memberIds.length === 0) return null
  const grades = await prisma.assessmentGrade.findMany({
    where: { assessmentId, studentId: { in: memberIds } },
    select: { studentId: true, marksObtained: true },
  })
  if (grades.length !== memberIds.length) return null
  const values = grades.map((grade) => Number(grade.marksObtained))
  const first = values[0]
  if (!values.every((value) => Math.abs(value - first) < 1e-9)) return null
  return first
}

/** Convenience for route handlers that need the evidence block for one group. */
export async function getGroupContributionEvidenceForTeacher(user: AuthUser, groupId: string) {
  await loadTeacherGroup(user, groupId)
  const events = await prisma.contributionEvent.findMany({
    where: { groupId },
    orderBy: { occurredAt: "asc" },
  })
  return buildContributionEvidence(groupId, events)
}
