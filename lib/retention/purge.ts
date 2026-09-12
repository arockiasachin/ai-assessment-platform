import { Prisma } from "@/lib/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import {
  RESULT_RETENTION_WINDOW_DAYS,
  RESULT_RETENTION_WINDOW_MS,
  decideRetention,
} from "@/lib/retention/policy"

/**
 * Server-side retention purge.
 *
 * Removes the personal content of student work for offerings whose results were
 * published at least 15 days ago. The decision is derived **server-side** from
 * the stored `CourseOffering.resultsPublishedAt` and the server clock through
 * {@link decideRetention}; a caller can never nominate an offering or a cutoff.
 *
 * SAFETY PROPERTIES
 * -----------------
 * - **Never deletes a `Grade` row or an `AuditLog` row.** Neither table is
 *   referenced here at all. The purge only *redacts* content fields on other
 *   rows, so referential integrity and the academic record survive.
 * - **Never purges an unpublished or recent offering.** Eligibility is the pure
 *   policy decision (publication + 15 days, inclusive boundary); anything else
 *   is skipped.
 * - **Idempotent.** Every write is scoped to `purgedAt: null`, so a second run
 *   selects nothing and changes nothing.
 * - **Dry run by default.** `dryRun` defaults to `true` at every entry point, so
 *   a caller must opt in explicitly before any row is written. A dry run runs
 *   only `count()` queries.
 *
 * See `docs/privacy/retention-policy.md` for the entity-by-entity disposition.
 */

/** Value written to `AIGradeSuggestion.rationale`, which is non-nullable. */
export const PURGED_RATIONALE_PLACEHOLDER = "[redacted by retention policy]"

export type RetentionPurgeOptions = {
  /**
   * Injectable clock for deterministic tests. Production callers omit it and
   * the routine uses the server clock. It is never read from a request.
   */
  now?: Date
  /** Report only when true (default). Set false to actually redact. */
  dryRun?: boolean
}

/** How many rows of one entity a purge did (or would) redact. */
export type EntityPurgeResult = {
  entity: string
  /** The content fields that are cleared. */
  fields: string[]
  count: number
}

export type OfferingPurgeResult = {
  offeringId: string
  courseCode: string | null
  resultsPublishedAt: string
  cutoff: string
  entities: EntityPurgeResult[]
  totalRows: number
}

export type RetentionPurgeReport = {
  dryRun: boolean
  now: string
  windowDays: number
  eligibleOfferings: number
  skipped: {
    unpublished: number
    withinWindow: number
    invalidAnchor: number
  }
  offerings: OfferingPurgeResult[]
  /** Entity name → total rows redacted (or that would be). */
  totals: Record<string, number>
}

/** Run the count query (dry run) or the update, returning the affected count. */
async function countOrUpdate(
  dryRun: boolean,
  count: () => Promise<number>,
  update: () => Promise<{ count: number }>,
): Promise<number> {
  if (dryRun) return count()
  const result = await update()
  return result.count
}

/**
 * Redact one offering's student work and return the per-entity counts.
 *
 * `assessmentIds` and `groupIds` scope every child query to this offering.
 */
async function purgeOffering(
  offering: { id: string; courseCode: string | null; resultsPublishedAt: Date; cutoff: Date },
  now: Date,
  dryRun: boolean,
): Promise<OfferingPurgeResult> {
  const [assessments, groups] = await Promise.all([
    prisma.assessment.findMany({ where: { offeringId: offering.id }, select: { id: true } }),
    prisma.group.findMany({ where: { offeringId: offering.id }, select: { id: true } }),
  ])
  const assessmentIds = assessments.map((assessment) => assessment.id)
  const groupIds = groups.map((group) => group.id)
  const hasAssessments = assessmentIds.length > 0
  const hasGroups = groupIds.length > 0

  const entities: EntityPurgeResult[] = []

  // Submission — student-authored content. The row survives (it is the
  // provenance of the grade and is referenced by versions/suggestions/runs);
  // teacher feedback is retained as part of the academic record.
  entities.push({
    entity: "Submission",
    fields: ["contentText", "artifactUrl"],
    count: hasAssessments
      ? await countOrUpdate(
          dryRun,
          () =>
            prisma.submission.count({
              where: { assessmentId: { in: assessmentIds }, purgedAt: null },
            }),
          () =>
            prisma.submission.updateMany({
              where: { assessmentId: { in: assessmentIds }, purgedAt: null },
              data: { contentText: null, artifactUrl: null, purgedAt: now },
            }),
        )
      : 0,
  })

  // SubmissionVersion — every snapshot of the student's submitted content.
  entities.push({
    entity: "SubmissionVersion",
    fields: ["contentText", "artifactUrl"],
    count: hasAssessments
      ? await countOrUpdate(
          dryRun,
          () =>
            prisma.submissionVersion.count({
              where: { submission: { assessmentId: { in: assessmentIds } }, purgedAt: null },
            }),
          () =>
            prisma.submissionVersion.updateMany({
              where: { submission: { assessmentId: { in: assessmentIds } }, purgedAt: null },
              data: { contentText: null, artifactUrl: null, purgedAt: now },
            }),
        )
      : 0,
  })

  // QuizResponse — the student's selected options and free-text answers.
  entities.push({
    entity: "QuizResponse",
    fields: ["selectedOptionIds", "answerText", "rationale"],
    count: hasAssessments
      ? await countOrUpdate(
          dryRun,
          () =>
            prisma.quizResponse.count({
              where: { attempt: { assessmentId: { in: assessmentIds } }, purgedAt: null },
            }),
          () =>
            prisma.quizResponse.updateMany({
              where: { attempt: { assessmentId: { in: assessmentIds } }, purgedAt: null },
              data: {
                selectedOptionIds: Prisma.DbNull,
                answerText: null,
                rationale: null,
                purgedAt: now,
              },
            }),
        )
      : 0,
  })

  // TestRun — the student's source code and raw execution artifacts.
  entities.push({
    entity: "TestRun",
    fields: ["sourceCode", "stdout", "stderr", "resultsJson"],
    count: hasAssessments
      ? await countOrUpdate(
          dryRun,
          () =>
            prisma.testRun.count({
              where: { codeTask: { assessmentId: { in: assessmentIds } }, purgedAt: null },
            }),
          () =>
            prisma.testRun.updateMany({
              where: { codeTask: { assessmentId: { in: assessmentIds } }, purgedAt: null },
              data: {
                sourceCode: null,
                stdout: null,
                stderr: null,
                resultsJson: Prisma.DbNull,
                purgedAt: now,
              },
            }),
        )
      : 0,
  })

  // AIGradeSuggestion — the model's rationale and quoted evidence spans.
  // Scores, model, confidence and token counts are retained for provenance.
  entities.push({
    entity: "AIGradeSuggestion",
    fields: ["rationale", "evidence", "rawResponse"],
    count: hasAssessments
      ? await countOrUpdate(
          dryRun,
          () =>
            prisma.aIGradeSuggestion.count({
              where: { assessmentId: { in: assessmentIds }, purgedAt: null },
            }),
          () =>
            prisma.aIGradeSuggestion.updateMany({
              where: { assessmentId: { in: assessmentIds }, purgedAt: null },
              data: {
                rationale: PURGED_RATIONALE_PLACEHOLDER,
                evidence: null,
                rawResponse: Prisma.DbNull,
                purgedAt: now,
              },
            }),
        )
      : 0,
  })

  // CourseRating — the free-text comment. The numeric rating is retained for
  // aggregate reporting.
  entities.push({
    entity: "CourseRating",
    fields: ["comment"],
    count: await countOrUpdate(
      dryRun,
      () => prisma.courseRating.count({ where: { offeringId: offering.id, purgedAt: null } }),
      () =>
        prisma.courseRating.updateMany({
          where: { offeringId: offering.id, purgedAt: null },
          data: { comment: null, purgedAt: now },
        }),
    ),
  })

  // PeerEvaluation — the confidential free-text comments. Numeric dimensions and
  // the overall score are retained for group-adjustment history.
  entities.push({
    entity: "PeerEvaluation",
    fields: ["comments"],
    count: hasGroups
      ? await countOrUpdate(
          dryRun,
          () =>
            prisma.peerEvaluation.count({ where: { groupId: { in: groupIds }, purgedAt: null } }),
          () =>
            prisma.peerEvaluation.updateMany({
              where: { groupId: { in: groupIds }, purgedAt: null },
              data: { comments: null, purgedAt: now },
            }),
        )
      : 0,
  })

  return {
    offeringId: offering.id,
    courseCode: offering.courseCode,
    resultsPublishedAt: offering.resultsPublishedAt.toISOString(),
    cutoff: offering.cutoff.toISOString(),
    entities,
    totalRows: entities.reduce((sum, entity) => sum + entity.count, 0),
  }
}

/**
 * Run the retention purge.
 *
 * Returns a report of every row redacted (or that a dry run *would* redact).
 * Dry run is the default; pass `dryRun: false` to write.
 */
export async function runRetentionPurge(
  options: RetentionPurgeOptions = {},
): Promise<RetentionPurgeReport> {
  const now = options.now ?? new Date()
  const dryRun = options.dryRun ?? true
  const windowMs = RESULT_RETENTION_WINDOW_MS

  const allOfferings = await prisma.courseOffering.findMany({
    select: {
      id: true,
      resultsPublishedAt: true,
      course: { select: { code: true } },
    },
  })

  const skipped = { unpublished: 0, withinWindow: 0, invalidAnchor: 0 }
  const eligible: {
    id: string
    courseCode: string | null
    resultsPublishedAt: Date
    cutoff: Date
  }[] = []

  for (const offering of allOfferings) {
    const decision = decideRetention(offering, now, windowMs)
    if (decision.eligible) {
      eligible.push({
        id: offering.id,
        courseCode: offering.course.code,
        resultsPublishedAt: offering.resultsPublishedAt as Date,
        cutoff: decision.cutoff,
      })
      continue
    }
    if (decision.reason === "unpublished") skipped.unpublished += 1
    else if (decision.reason === "within-window") skipped.withinWindow += 1
    else skipped.invalidAnchor += 1
  }

  const offerings: OfferingPurgeResult[] = []
  for (const offering of eligible) {
    offerings.push(await purgeOffering(offering, now, dryRun))
  }

  const totals: Record<string, number> = {}
  for (const offering of offerings) {
    for (const entity of offering.entities) {
      totals[entity.entity] = (totals[entity.entity] ?? 0) + entity.count
    }
  }

  // Record an audit entry per offering that actually had rows redacted (never
  // for dry runs, and never when there was nothing to do — so a second run
  // writes nothing and the routine stays idempotent). Audit rows are append
  // only; the purge never deletes one.
  if (!dryRun) {
    for (const offering of offerings) {
      if (offering.totalRows === 0) continue
      await prisma.auditLog.create({
        data: {
          entityType: "CourseOffering",
          entityId: offering.offeringId,
          action: "retention.purged",
          actorId: null,
          actorRole: "system",
          metadata: {
            resultsPublishedAt: offering.resultsPublishedAt,
            cutoff: offering.cutoff,
            windowDays: RESULT_RETENTION_WINDOW_DAYS,
            entities: Object.fromEntries(
              offering.entities.map((entity) => [entity.entity, entity.count]),
            ),
          },
        },
      })
    }
  }

  return {
    dryRun,
    now: now.toISOString(),
    windowDays: RESULT_RETENTION_WINDOW_DAYS,
    eligibleOfferings: offerings.length,
    skipped,
    offerings,
    totals,
  }
}
