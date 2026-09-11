import {
  createMilestoneRequestSchema,
  recordContributionsRequestSchema,
  updateMilestoneRequestSchema,
  type ContributionEvidenceValue,
  type MilestoneResponse,
} from "@/lib/contracts/groups"
import { writeAuditLog } from "@/lib/grading/audit"
import { partialUpdate } from "@/lib/partial-update"
import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

import { analyzeCohortProgress, type GroupProgress } from "./milestones"
import { GroupError, GroupValidationError } from "./errors"
import { loadOwnedOffering, resolveTeacherStaffId } from "./authz"
import { buildContributionEvidence, serializeMilestone } from "./serialize"

/**
 * Contribution events and milestones.
 *
 * Contribution events are recorded as SECONDARY evidence. Every response path
 * here goes through `buildContributionEvidence`, which stamps `gradeBasis: false`
 * and the "not the sole basis for a grade" notice, so contribution data can never
 * silently become a grade.
 */

async function loadGroupForTeacher(user: AuthUser, groupId: string) {
  const staffId = await resolveTeacherStaffId(user)
  const group = await prisma.group.findFirst({
    where: { id: groupId, offering: { teacherId: staffId } },
    select: {
      id: true,
      offeringId: true,
      members: { select: { studentId: true } },
    },
  })
  if (!group) throw new GroupError(404, "Group not found.")
  return group
}

export type RecordContributionsOutcome = {
  recorded: number
  evidence: ContributionEvidenceValue
}

export async function recordContributionEventsForTeacher(
  user: AuthUser,
  input: unknown,
): Promise<RecordContributionsOutcome> {
  const request = recordContributionsRequestSchema.parse(input)
  const group = await loadGroupForTeacher(user, request.groupId)
  const memberIds = new Set(group.members.map((member) => member.studentId))

  for (const event of request.events) {
    if (event.studentId && !memberIds.has(event.studentId)) {
      throw new GroupValidationError("A contribution event's student is not a member of the group.")
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.contributionEvent.createMany({
      data: request.events.map((event) => ({
        groupId: group.id,
        studentId: event.studentId ?? null,
        type: event.type,
        source: event.source ?? null,
        externalId: event.externalId ?? null,
        summary: event.summary ?? null,
        weight: event.weight,
        occurredAt: new Date(event.occurredAt),
      })),
    })
    await writeAuditLog(tx, {
      entityType: "Group",
      entityId: group.id,
      action: "group.contributions_recorded",
      actor: { id: user.id, role: user.role },
      after: { recorded: request.events.length },
    })
  })

  const events = await prisma.contributionEvent.findMany({
    where: { groupId: group.id },
    orderBy: { occurredAt: "asc" },
  })
  return { recorded: request.events.length, evidence: buildContributionEvidence(group.id, events) }
}

export async function getContributionEvidenceForTeacher(
  user: AuthUser,
  groupId: string,
): Promise<ContributionEvidenceValue> {
  await loadGroupForTeacher(user, groupId)
  const events = await prisma.contributionEvent.findMany({
    where: { groupId },
    orderBy: { occurredAt: "asc" },
  })
  return buildContributionEvidence(groupId, events)
}

/** Define a milestone for one owned group. */
export async function createMilestoneForTeacher(
  user: AuthUser,
  input: unknown,
): Promise<MilestoneResponse> {
  const request = createMilestoneRequestSchema.parse(input)
  const group = await loadGroupForTeacher(user, request.groupId)

  const milestoneId = await prisma.$transaction(async (tx) => {
    const milestone = await tx.milestone.create({
      data: {
        groupId: group.id,
        title: request.title,
        description: request.description ?? null,
        weight: request.weight,
        dueDate: request.dueDate ? new Date(request.dueDate) : null,
        status: "PLANNED",
      },
    })
    await writeAuditLog(tx, {
      entityType: "Milestone",
      entityId: milestone.id,
      action: "milestone.created",
      actor: { id: user.id, role: user.role },
      after: { groupId: group.id, title: request.title, dueDate: request.dueDate ?? null },
    })
    return milestone.id
  })

  const created = await prisma.milestone.findUniqueOrThrow({ where: { id: milestoneId } })
  return serializeMilestone(created)
}

/**
 * Update or complete a milestone. Marking a milestone `COMPLETED` timestamps it;
 * moving it out of `COMPLETED` clears the timestamp so progress stays honest.
 */
export async function updateMilestoneForTeacher(
  user: AuthUser,
  milestoneId: string,
  input: unknown,
): Promise<MilestoneResponse> {
  const request = updateMilestoneRequestSchema.parse(input)
  const staffId = await resolveTeacherStaffId(user)
  const milestone = await prisma.milestone.findFirst({
    where: { id: milestoneId, group: { offering: { teacherId: staffId } } },
    select: { id: true, groupId: true, status: true, completedAt: true },
  })
  if (!milestone) throw new GroupError(404, "Milestone not found.")

  let completedAt: Date | null | undefined
  if (request.completedAt !== undefined) {
    completedAt = request.completedAt ? new Date(request.completedAt) : null
  } else if (request.status !== undefined) {
    if (request.status === "COMPLETED" && milestone.status !== "COMPLETED") {
      completedAt = new Date()
    } else if (request.status !== "COMPLETED" && milestone.status === "COMPLETED") {
      completedAt = null
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.milestone.update({
      where: { id: milestoneId },
      data: {
        ...partialUpdate(request, {
          title: true,
          description: true,
          weight: true,
          dueDate: (value) => (value === null ? null : new Date(value)),
          status: true,
        }),
        ...(completedAt !== undefined ? { completedAt } : {}),
      },
    })
    await writeAuditLog(tx, {
      entityType: "Milestone",
      entityId: milestoneId,
      action: "milestone.updated",
      actor: { id: user.id, role: user.role },
      before: {
        status: milestone.status,
        completedAt: milestone.completedAt?.toISOString() ?? null,
      },
      after: {
        status: request.status ?? milestone.status,
        completedAt: completedAt === undefined ? undefined : (completedAt?.toISOString() ?? null),
      },
    })
  })

  const updated = await prisma.milestone.findUniqueOrThrow({ where: { id: milestoneId } })
  return serializeMilestone(updated)
}

export type MilestonesForTeacher = {
  milestones: MilestoneResponse[]
  cohortProgress: GroupProgress[]
}

/** Milestones for one group, or for every group on an owned offering. */
export async function listMilestonesForTeacher(
  user: AuthUser,
  options: { groupId?: string; offeringId?: string },
): Promise<MilestonesForTeacher> {
  const staffId = await resolveTeacherStaffId(user)
  if (options.groupId) {
    const group = await loadGroupForTeacher(user, options.groupId)
    const milestones = await prisma.milestone.findMany({
      where: { groupId: group.id },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    })
    return {
      milestones: milestones.map(serializeMilestone),
      cohortProgress: analyzeCohortProgress([{ groupId: group.id, milestones }]),
    }
  }
  if (!options.offeringId) {
    throw new GroupValidationError("Either groupId or offeringId is required.")
  }
  await loadOwnedOffering(user, options.offeringId)
  const groups = await prisma.group.findMany({
    where: { offeringId: options.offeringId, offering: { teacherId: staffId } },
    select: { id: true, milestones: { orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }] } },
    orderBy: { name: "asc" },
  })
  return {
    milestones: groups.flatMap((group) => group.milestones.map(serializeMilestone)),
    cohortProgress: analyzeCohortProgress(
      groups.map((group) => ({ groupId: group.id, milestones: group.milestones })),
    ),
  }
}
