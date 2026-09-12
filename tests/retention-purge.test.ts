import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { PURGED_RATIONALE_PLACEHOLDER, runRetentionPurge } from "@/lib/retention/purge"
import { DEMO_IDS, seedDemo } from "@/prisma/seed-demo"
import { disconnectTestDatabase, prisma as db, truncateAll } from "./helpers/db"

/**
 * Database-backed retention-purge tests over the full demo graph.
 *
 * The demo seed is used deliberately: it creates real content on every purge
 * entity (submissions, quiz responses, a code-run artifact, AI rationale and
 * quoted evidence, ratings, peer comments) plus real published `Grade` rows and
 * `AuditLog` rows, so the safety invariants are asserted against the actual
 * data rather than hand-built stubs.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = new Date("2026-09-12T00:00:00.000Z")

const PURGE_ENTITIES = [
  "Submission",
  "SubmissionVersion",
  "QuizResponse",
  "TestRun",
  "AIGradeSuggestion",
  "CourseRating",
  "PeerEvaluation",
] as const

async function setAllPublishedAt(value: Date | null): Promise<void> {
  await db.courseOffering.updateMany({ data: { resultsPublishedAt: value } })
}

async function snapshotCounts() {
  return {
    courseOffering: await db.courseOffering.count(),
    assessment: await db.assessment.count(),
    grade: await db.grade.count(),
    auditLog: await db.auditLog.count(),
    submission: await db.submission.count(),
    submissionVersion: await db.submissionVersion.count(),
    quizAttempt: await db.quizAttempt.count(),
    quizResponse: await db.quizResponse.count(),
    testRun: await db.testRun.count(),
    aIGradeSuggestion: await db.aIGradeSuggestion.count(),
    courseRating: await db.courseRating.count(),
    peerEvaluation: await db.peerEvaluation.count(),
  }
}

async function retentionAuditCount(): Promise<number> {
  return db.auditLog.count({ where: { action: "retention.purged" } })
}

describe("retention purge", () => {
  beforeAll(async () => {
    await truncateAll()
    await seedDemo()

    // Make sure every purge entity carries content the purge can be seen to
    // remove. The demo seeds most of these; a submission version and the code
    // run's text artifacts are added here.
    await db.testRun.updateMany({
      data: { sourceCode: "def slope(x1, y1, x2, y2):\n    return 1\n", stdout: "ok", stderr: "" },
    })
    const essaySubmission = await db.submission.findFirstOrThrow({
      where: {
        assessmentId: DEMO_IDS.essayAssessmentId,
        studentId: DEMO_IDS.studentProfileIds[0],
      },
    })
    await db.submission.update({
      where: { id: essaySubmission.id },
      data: {
        artifactUrl: "https://files.test/essay.pdf",
        feedback: "Teacher feedback retained as part of the academic record.",
      },
    })
    await db.submissionVersion.create({
      data: {
        submissionId: essaySubmission.id,
        versionNumber: 1,
        contentText: "Original essay text that must be removed.",
        artifactUrl: "https://files.test/essay-v1.pdf",
        wordCount: 120,
      },
    })
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("dry run reports exactly what it would purge and modifies nothing", async () => {
    await setAllPublishedAt(new Date(NOW.getTime() - 16 * DAY_MS))

    const before = await snapshotCounts()
    const submissionBefore = await db.submission.findFirstOrThrow({
      where: { assessmentId: DEMO_IDS.essayAssessmentId },
    })

    const report = await runRetentionPurge({ now: NOW, dryRun: true })

    expect(report.dryRun).toBe(true)
    expect(report.windowDays).toBe(15)
    expect(report.eligibleOfferings).toBeGreaterThan(0)
    expect(report.now).toBe(NOW.toISOString())
    for (const entity of PURGE_ENTITIES) {
      expect(report.totals[entity] ?? 0).toBeGreaterThan(0)
    }

    // Nothing moved: same row counts, same content, and no purge audit rows.
    expect(await snapshotCounts()).toEqual(before)
    const submissionAfter = await db.submission.findUniqueOrThrow({
      where: { id: submissionBefore.id },
    })
    expect(submissionAfter.contentText).toBe(submissionBefore.contentText)
    expect(submissionAfter.artifactUrl).toBe(submissionBefore.artifactUrl)
    expect(submissionAfter.purgedAt).toBeNull()
    expect(await retentionAuditCount()).toBe(0)
  })

  it("never purges an offering whose results are unpublished", async () => {
    await setAllPublishedAt(null)

    const before = await snapshotCounts()
    const submissionBefore = await db.submission.findFirstOrThrow({
      where: { assessmentId: DEMO_IDS.essayAssessmentId },
    })

    const report = await runRetentionPurge({ now: NOW, dryRun: false })

    expect(report.eligibleOfferings).toBe(0)
    expect(report.skipped.unpublished).toBeGreaterThan(0)
    expect(await snapshotCounts()).toEqual(before)
    const submissionAfter = await db.submission.findUniqueOrThrow({
      where: { id: submissionBefore.id },
    })
    expect(submissionAfter.contentText).toBe(submissionBefore.contentText)
    expect(await retentionAuditCount()).toBe(0)
  })

  it("applies the 15-day boundary precisely", async () => {
    // 14 days and 23:59:59.999 — not eligible.
    await setAllPublishedAt(new Date(NOW.getTime() - (15 * DAY_MS - 1)))
    let report = await runRetentionPurge({ now: NOW, dryRun: true })
    expect(report.eligibleOfferings).toBe(0)
    expect(report.skipped.withinWindow).toBeGreaterThan(0)
    expect(await retentionAuditCount()).toBe(0)

    // Exactly 15 days — eligible.
    await setAllPublishedAt(new Date(NOW.getTime() - 15 * DAY_MS))
    report = await runRetentionPurge({ now: NOW, dryRun: true })
    expect(report.eligibleOfferings).toBeGreaterThan(0)
    // Still a dry run: no writes.
    expect(await retentionAuditCount()).toBe(0)
  })

  it("redacts student work but never deletes a Grade or an AuditLog row", async () => {
    await setAllPublishedAt(new Date(NOW.getTime() - 16 * DAY_MS))

    const gradesBefore = await db.grade.findMany({
      select: { id: true, publishedAt: true, points: true, maxPoints: true },
    })
    expect(gradesBefore.filter((grade) => grade.publishedAt !== null).length).toBeGreaterThan(0)
    const auditIdsBefore = new Set(
      (await db.auditLog.findMany({ select: { id: true } })).map((row) => row.id),
    )
    const ratingsBefore = await db.courseRating.findMany({
      select: { id: true, rating: true, comment: true },
    })
    const peersBefore = await db.peerEvaluation.findMany({
      select: { id: true, comments: true, overallScore: true },
    })
    expect(ratingsBefore.some((rating) => rating.comment !== null)).toBe(true)
    expect(peersBefore.some((peer) => peer.comments !== null)).toBe(true)

    const report = await runRetentionPurge({ now: NOW, dryRun: false })
    expect(report.dryRun).toBe(false)
    for (const entity of PURGE_ENTITIES) {
      expect(report.totals[entity] ?? 0).toBeGreaterThan(0)
    }

    // --- Student work redacted (rows survive, personal content does not) ---
    const submission = await db.submission.findFirstOrThrow({
      where: {
        assessmentId: DEMO_IDS.essayAssessmentId,
        studentId: DEMO_IDS.studentProfileIds[0],
      },
    })
    expect(submission.contentText).toBeNull()
    expect(submission.artifactUrl).toBeNull()
    expect(submission.purgedAt).not.toBeNull()
    // Teacher feedback is retained as part of the academic record.
    expect(submission.feedback).toBe("Teacher feedback retained as part of the academic record.")

    const version = await db.submissionVersion.findFirstOrThrow()
    expect(version.contentText).toBeNull()
    expect(version.artifactUrl).toBeNull()
    expect(version.purgedAt).not.toBeNull()
    expect(version.wordCount).toBe(120)

    const response = await db.quizResponse.findFirstOrThrow()
    expect(response.selectedOptionIds).toBeNull()
    expect(response.answerText).toBeNull()
    expect(response.purgedAt).not.toBeNull()

    const run = await db.testRun.findFirstOrThrow()
    expect(run.sourceCode).toBeNull()
    expect(run.stdout).toBeNull()
    expect(run.stderr).toBeNull()
    expect(run.resultsJson).toBeNull()
    expect(run.purgedAt).not.toBeNull()
    expect(run.passedCount).toBe(3)

    const suggestion = await db.aIGradeSuggestion.findFirstOrThrow({
      where: { assessmentId: DEMO_IDS.essayAssessmentId },
    })
    expect(suggestion.rationale).toBe(PURGED_RATIONALE_PLACEHOLDER)
    expect(suggestion.evidence).toBeNull()
    expect(suggestion.rawResponse).toBeNull()
    expect(suggestion.purgedAt).not.toBeNull()
    expect(Number(suggestion.suggestedPoints)).toBeGreaterThanOrEqual(0)

    const ratingsAfter = await db.courseRating.findMany({
      select: { id: true, rating: true, comment: true, purgedAt: true },
    })
    const ratingById = new Map(ratingsAfter.map((rating) => [rating.id, rating]))
    for (const before of ratingsBefore) {
      const after = ratingById.get(before.id)
      expect(after).toBeDefined()
      expect(after?.comment).toBeNull()
      expect(after?.rating).toBe(before.rating)
      expect(after?.purgedAt).not.toBeNull()
    }

    const peersAfter = await db.peerEvaluation.findMany({
      select: { id: true, comments: true, overallScore: true, purgedAt: true },
    })
    const peerById = new Map(peersAfter.map((peer) => [peer.id, peer]))
    for (const before of peersBefore) {
      const after = peerById.get(before.id)
      expect(after).toBeDefined()
      expect(after?.comments).toBeNull()
      expect(after?.overallScore).toBe(before.overallScore)
      expect(after?.purgedAt).not.toBeNull()
    }

    // --- The academic record survives, byte for byte ---
    const gradesAfter = await db.grade.findMany({
      select: { id: true, publishedAt: true, points: true, maxPoints: true },
    })
    expect(gradesAfter).toHaveLength(gradesBefore.length)
    const gradeById = new Map(gradesAfter.map((grade) => [grade.id, grade]))
    for (const before of gradesBefore) {
      const after = gradeById.get(before.id)
      expect(after).toBeDefined()
      expect(after?.publishedAt?.getTime()).toBe(before.publishedAt?.getTime())
      expect(Number(after?.points)).toBe(Number(before.points))
      expect(Number(after?.maxPoints)).toBe(Number(before.maxPoints))
    }

    // Every audit row that existed before the purge still exists; the purge only
    // appended its own `retention.purged` rows.
    const auditIdsAfter = new Set(
      (await db.auditLog.findMany({ select: { id: true } })).map((row) => row.id),
    )
    for (const id of auditIdsBefore) {
      expect(auditIdsAfter.has(id)).toBe(true)
    }
    expect(await retentionAuditCount()).toBeGreaterThan(0)
  })

  it("is idempotent: a second run changes nothing", async () => {
    const countsBefore = await snapshotCounts()
    const purgeAuditsBefore = await retentionAuditCount()
    const sample = await db.submission.findFirstOrThrow({
      select: { id: true, purgedAt: true },
    })

    const report = await runRetentionPurge({ now: NOW, dryRun: false })

    expect(report.eligibleOfferings).toBeGreaterThan(0)
    for (const entity of PURGE_ENTITIES) {
      expect(report.totals[entity] ?? 0).toBe(0)
    }
    expect(await snapshotCounts()).toEqual(countsBefore)
    expect(await retentionAuditCount()).toBe(purgeAuditsBefore)
    const sampleAfter = await db.submission.findUniqueOrThrow({
      where: { id: sample.id },
      select: { purgedAt: true },
    })
    expect(sampleAfter.purgedAt?.getTime()).toBe(sample.purgedAt?.getTime())
  })
})
