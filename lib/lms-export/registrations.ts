import type { AuthUser } from "@/lib/session"
import {
  ltiRegistrationInputSchema,
  saveLtiMappingsRequestSchema,
  type LtiRegistrationResponse,
  type LtiUserMappingsEnvelope,
} from "@/lib/contracts/lms-export"
import type { LtiRegistration } from "@/lib/generated/prisma/client"
import { prisma } from "@/lib/prisma"

import { loadOwnedOffering } from "./authz"
import { LmsExportValidationError } from "./errors"

/**
 * Persisted LTI 1.3 registration and student↔LTI-user mapping.
 *
 * Secrets policy: the schema has no private-key column. `privateKeyRef` is an
 * opaque pointer (an environment-variable name, secret-manager ARN, or vault
 * id); the PEM itself stays in the environment/secret store. This module never
 * reads or returns key material.
 *
 * Mappings are the substitute for the request-supplied `ltiUserIds` map: the
 * AGS dry run resolves every enrolled student through their active mapping and
 * only falls back to the internal id when no mapping exists.
 */

export function serializeLtiRegistration(registration: LtiRegistration): LtiRegistrationResponse {
  return {
    id: registration.id,
    platformIssuer: registration.platformIssuer,
    clientId: registration.clientId,
    deploymentId: registration.deploymentId,
    keyId: registration.keyId,
    privateKeyRef: registration.privateKeyRef,
    lineItemsUrl: registration.lineItemsUrl,
    scopes: registration.scopes,
    name: registration.name,
    isActive: registration.isActive,
    createdAt: registration.createdAt.toISOString(),
    updatedAt: registration.updatedAt.toISOString(),
  }
}

/** The most recently updated active registration, or `null`. */
export async function getActiveLtiRegistration(): Promise<LtiRegistration | null> {
  return prisma.ltiRegistration.findFirst({
    where: { isActive: true },
    orderBy: { updatedAt: "desc" },
  })
}

/** Upsert a registration keyed by (issuer, client, deployment). */
export async function saveLtiRegistration(input: unknown): Promise<LtiRegistrationResponse> {
  const data = ltiRegistrationInputSchema.parse(input)
  const registration = await prisma.ltiRegistration.upsert({
    where: {
      platformIssuer_clientId_deploymentId: {
        platformIssuer: data.platformIssuer,
        clientId: data.clientId,
        deploymentId: data.deploymentId,
      },
    },
    create: {
      platformIssuer: data.platformIssuer,
      clientId: data.clientId,
      deploymentId: data.deploymentId,
      keyId: data.keyId,
      privateKeyRef: data.privateKeyRef ?? null,
      lineItemsUrl: data.lineItemsUrl ?? null,
      scopes: data.scopes,
      name: data.name ?? null,
      isActive: data.isActive,
    },
    update: {
      keyId: data.keyId,
      privateKeyRef: data.privateKeyRef ?? null,
      lineItemsUrl: data.lineItemsUrl ?? null,
      scopes: data.scopes,
      name: data.name ?? null,
      isActive: data.isActive,
    },
  })
  return serializeLtiRegistration(registration)
}

/**
 * Resolve persisted LTI user ids for the given students. When a student has
 * mappings under more than one active registration the most recently updated
 * one wins, so the effective mapping is deterministic.
 */
export async function resolveLtiUserIds(
  studentIds: readonly string[],
): Promise<Map<string, string>> {
  if (studentIds.length === 0) return new Map()
  const mappings = await prisma.ltiUserMapping.findMany({
    where: { studentId: { in: [...studentIds] }, registration: { isActive: true } },
    orderBy: { updatedAt: "desc" },
    select: { studentId: true, ltiUserId: true },
  })
  const byStudent = new Map<string, string>()
  for (const mapping of mappings) {
    if (!byStudent.has(mapping.studentId)) byStudent.set(mapping.studentId, mapping.ltiUserId)
  }
  return byStudent
}

/**
 * Persist student↔LTI-user mappings for one owned offering. Every student must
 * have an active enrollment in that offering, so a teacher cannot map (or
 * discover) a student outside their roster.
 */
export async function saveLtiMappingsForTeacher(
  user: AuthUser,
  input: unknown,
): Promise<LtiUserMappingsEnvelope> {
  const request = saveLtiMappingsRequestSchema.parse(input)
  await loadOwnedOffering(user, request.offeringId)

  const registration = request.registrationId
    ? await prisma.ltiRegistration.findUnique({ where: { id: request.registrationId } })
    : await getActiveLtiRegistration()
  if (!registration) {
    throw new LmsExportValidationError(
      "No LTI registration is available. Create one before mapping students.",
    )
  }

  const studentIds = [...new Set(request.mappings.map((mapping) => mapping.studentId))]
  const enrollments = await prisma.enrollment.findMany({
    where: { offeringId: request.offeringId, status: "active", studentId: { in: studentIds } },
    select: { studentId: true },
  })
  const enrolled = new Set(enrollments.map((row) => row.studentId))
  const notEnrolled = studentIds.filter((studentId) => !enrolled.has(studentId))
  if (notEnrolled.length > 0) {
    throw new LmsExportValidationError(
      "Every mapped student must be actively enrolled in the offering.",
    )
  }

  await prisma.$transaction(
    request.mappings.map((mapping) =>
      prisma.ltiUserMapping.upsert({
        where: {
          registrationId_studentId: {
            registrationId: registration.id,
            studentId: mapping.studentId,
          },
        },
        create: {
          registrationId: registration.id,
          studentId: mapping.studentId,
          ltiUserId: mapping.ltiUserId,
        },
        update: { ltiUserId: mapping.ltiUserId },
      }),
    ),
  )

  const stored = await listLtiMappings(request.offeringId, registration.id)
  return { success: true, registrationId: registration.id, mappings: stored }
}

/** Mappings for the active (or given) registration, limited to an offering's roster. */
export async function listLtiMappings(
  offeringId: string,
  registrationId: string,
): Promise<LtiUserMappingsEnvelope["mappings"]> {
  const enrollments = await prisma.enrollment.findMany({
    where: { offeringId, status: "active" },
    select: { studentId: true },
  })
  const studentIds = enrollments.map((row) => row.studentId)
  if (studentIds.length === 0) return []
  const mappings = await prisma.ltiUserMapping.findMany({
    where: { registrationId, studentId: { in: studentIds } },
    orderBy: { studentId: "asc" },
  })
  return mappings.map((mapping) => ({
    id: mapping.id,
    studentId: mapping.studentId,
    ltiUserId: mapping.ltiUserId,
    updatedAt: mapping.updatedAt.toISOString(),
  }))
}
