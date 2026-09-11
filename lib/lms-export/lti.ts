import {
  AGS_ACTIVITY_PROGRESS_VALUES,
  AGS_GRADING_PROGRESS_VALUES,
  type AgsLineItemPayload,
  type AgsScorePayload,
} from "@/lib/contracts/lms-export"

import { LmsExportValidationError, LtiConfigurationError, LtiUnpublishedGradeError } from "./errors"

/**
 * Pure LTI 1.3 Assignment & Grade Services (AGS) groundwork.
 *
 * This module builds the JSON payloads a real integration posts and validates
 * the configuration it needs. It performs **no network calls** — sending is the
 * job of the injected client in `./lti-client`, and the only shipped client is
 * an in-memory dry-run implementation.
 *
 * What the frozen schema cannot supply: there are no LTI models, so there is no
 * registration, deployment, key, or platform-user persistence. This module reads
 * a registration from the environment and takes the LTI `userId` as an explicit
 * argument; persisting a registration needs a migration (see the feature doc).
 */

export const AGS_SCORE_CONTENT_TYPE = "application/vnd.ims.lis.v1.score+json"
export const AGS_LINE_ITEM_CONTENT_TYPE = "application/vnd.ims.lis.v1.lineitem+json"
export const AGS_RESULT_CONTENT_TYPE = "application/vnd.ims.lis.v1.result+json"

/** The scopes a score-posting integration needs. */
export const AGS_SCOPES = [
  "https://purl.imsglobal.org/spec/lti-ags/scope/score",
  "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem",
  "https://purl.imsglobal.org/spec/lti-ags/scope/result.readonly",
] as const

export type AgsActivityProgress = (typeof AGS_ACTIVITY_PROGRESS_VALUES)[number]
export type AgsGradingProgress = (typeof AGS_GRADING_PROGRESS_VALUES)[number]

export type PublishedGradeForAgs = {
  assessmentId: string
  studentId: string
  points: number
  maxPoints: number
  percentage?: number | null
  publishedAt: Date | string | null
}

export type BuildAgsScoreInput = {
  grade: PublishedGradeForAgs
  /** The LMS platform user id the score belongs to. */
  ltiUserId: string
  comment?: string
  timestamp?: Date
  activityProgress?: AgsActivityProgress
  gradingProgress?: AgsGradingProgress
}

/**
 * Build an AGS score payload (`application/vnd.ims.lis.v1.score+json`) from a
 * published `Grade`.
 *
 * Throws `LtiUnpublishedGradeError` (409) when the grade has no `publishedAt`:
 * a model suggestion that no teacher approved must never be sent to an LMS.
 */
export function buildAgsScorePayload(input: BuildAgsScoreInput): AgsScorePayload {
  const { grade, ltiUserId } = input

  if (!grade.publishedAt) {
    throw new LtiUnpublishedGradeError(
      `Grade for assessment "${grade.assessmentId}" and student "${grade.studentId}" is not published; refusing to build an AGS score payload.`,
    )
  }
  if (ltiUserId.trim().length === 0) {
    throw new LmsExportValidationError("An AGS score payload requires a non-empty ltiUserId.")
  }
  if (!Number.isFinite(grade.maxPoints) || grade.maxPoints <= 0) {
    throw new LmsExportValidationError("An AGS score payload requires a positive scoreMaximum.")
  }
  if (!Number.isFinite(grade.points) || grade.points < 0 || grade.points > grade.maxPoints) {
    throw new LmsExportValidationError(
      `AGS scoreGiven must be between 0 and ${grade.maxPoints} (got ${grade.points}).`,
    )
  }

  return {
    userId: ltiUserId,
    timestamp: (input.timestamp ?? new Date()).toISOString(),
    scoreGiven: grade.points,
    scoreMaximum: grade.maxPoints,
    ...(input.comment ? { comment: input.comment } : {}),
    activityProgress: input.activityProgress ?? "Completed",
    gradingProgress: input.gradingProgress ?? "FullyGraded",
  }
}

export type AgsLineItemSource = {
  id: string
  title: string
  maxMarks: number
  type?: string
  dueDate?: Date | string | null
}

export type BuildAgsLineItemOptions = {
  tag?: string
  resourceId?: string
  startDateTime?: Date | string
  endDateTime?: Date | string
  gradesReleased?: boolean
}

function optionalIso(value: Date | string | undefined | null): string | undefined {
  if (value === undefined || value === null) return undefined
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

/**
 * Build an AGS LineItem payload for an assessment. The caller posts it to the
 * registration's line-items context URL; this function only shapes the body.
 */
export function buildAgsLineItemPayload(
  assessment: AgsLineItemSource,
  options: BuildAgsLineItemOptions = {},
): AgsLineItemPayload {
  if (!Number.isFinite(assessment.maxMarks) || assessment.maxMarks <= 0) {
    throw new LmsExportValidationError("An AGS line item requires a positive scoreMaximum.")
  }
  if (assessment.title.trim().length === 0) {
    throw new LmsExportValidationError("An AGS line item requires a non-empty label.")
  }

  const endDateTime = optionalIso(options.endDateTime ?? assessment.dueDate)
  const startDateTime = optionalIso(options.startDateTime)
  const tag = options.tag ?? assessment.type

  return {
    scoreMaximum: assessment.maxMarks,
    label: assessment.title,
    resourceId: options.resourceId ?? `assessment:${assessment.id}`,
    ...(tag ? { tag } : {}),
    ...(startDateTime ? { startDateTime } : {}),
    ...(endDateTime ? { endDateTime } : {}),
    ...(options.gradesReleased !== undefined ? { gradesReleased: options.gradesReleased } : {}),
  }
}

// ---------------------------------------------------------------------------
// Registration configuration (environment-backed; persistence is deferred)
// ---------------------------------------------------------------------------

export const LTI_AGS_ENV_KEYS = {
  platformIssuer: "LTI_PLATFORM_ISSUER",
  clientId: "LTI_CLIENT_ID",
  deploymentId: "LTI_DEPLOYMENT_ID",
  keyId: "LTI_KEY_ID",
  privateKey: "LTI_PRIVATE_KEY",
  lineItemsUrl: "LTI_AGS_LINEITEMS_URL",
} as const

export type LtiAgsConfig = {
  platformIssuer: string
  clientId: string
  deploymentId: string
  keyId: string
  /** PEM private key. Never logged or serialized. */
  privateKey: string
  /** The context line-items endpoint a line item is posted to. */
  lineItemsUrl: string
  scopes: string[]
}

export type LtiAgsConfigStatus =
  | { configured: true; config: LtiAgsConfig }
  | { configured: false; missing: string[]; message: string }

function readEnv(env: Record<string, string | undefined>, key: string): string {
  return (env[key] ?? "").trim()
}

/**
 * Validate the LTI AGS configuration. Missing keys are returned rather than
 * thrown so a read-only summary can report status without failing the request.
 */
export function validateLtiAgsConfig(
  env: Record<string, string | undefined> = process.env,
): LtiAgsConfigStatus {
  const values = {
    platformIssuer: readEnv(env, LTI_AGS_ENV_KEYS.platformIssuer),
    clientId: readEnv(env, LTI_AGS_ENV_KEYS.clientId),
    deploymentId: readEnv(env, LTI_AGS_ENV_KEYS.deploymentId),
    keyId: readEnv(env, LTI_AGS_ENV_KEYS.keyId),
    privateKey: readEnv(env, LTI_AGS_ENV_KEYS.privateKey),
    lineItemsUrl: readEnv(env, LTI_AGS_ENV_KEYS.lineItemsUrl),
  }

  const missing = Object.entries(values)
    .filter(([, value]) => value.length === 0)
    .map(([field]) => field)

  if (missing.length > 0) {
    const envNames = missing
      .map((field) => LTI_AGS_ENV_KEYS[field as keyof typeof LTI_AGS_ENV_KEYS])
      .join(", ")
    return {
      configured: false,
      missing,
      message:
        `LTI 1.3 AGS is not configured. Set ${envNames}. ` +
        "Persisting a registration needs a schema migration (there are no LTI models); " +
        "until then these values are read from the environment, and no live LMS calls are made.",
    }
  }

  return {
    configured: true,
    config: {
      platformIssuer: values.platformIssuer,
      clientId: values.clientId,
      deploymentId: values.deploymentId,
      keyId: values.keyId,
      privateKey: values.privateKey,
      lineItemsUrl: values.lineItemsUrl,
      scopes: [...AGS_SCOPES],
    },
  }
}

/** Like `validateLtiAgsConfig`, but throws an actionable 422 when incomplete. */
export function requireLtiAgsConfig(
  env: Record<string, string | undefined> = process.env,
): LtiAgsConfig {
  const status = validateLtiAgsConfig(env)
  if (!status.configured) throw new LtiConfigurationError(status.message)
  return status.config
}
