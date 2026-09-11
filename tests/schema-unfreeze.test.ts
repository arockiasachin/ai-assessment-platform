import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { readAnalyticsSettings, resolveInterventionThresholds } from "@/lib/analytics"
import { readFormationProfile, toFormationProfileJson } from "@/lib/groups"
import { recordAiSuggestion } from "@/lib/grading"
import { resolveLtiUserIds } from "@/lib/lms-export/registrations"
import {
  isGeneratedQuestion,
  resolveGenerationStatus,
  resolvePublishedAt,
} from "@/lib/quiz-generation/metadata"
import { quizDeliveryStatus } from "@/lib/quiz-attempts/metadata"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * Coverage for the schema-unfreeze migration.
 *
 * The point of these tests is that the new columns are the source of truth and
 * that the pre-migration representations (JSON envelopes, request-supplied
 * values) still read correctly, so no existing row breaks.
 */

const LEGACY_DRAFT_METADATA = {
  generator: "quiz-generation",
  generationStatus: "draft",
  promptVersion: "quiz-generation-v1",
  model: "mock",
  provider: "mock",
  generationId: "gen-legacy",
  topic: "topic",
  sourceChunkIds: [],
  createdByStaffId: "staff-legacy",
}

const LEGACY_PUBLISHED_METADATA = {
  ...LEGACY_DRAFT_METADATA,
  generationStatus: "published",
  publishedAt: "2026-01-01T00:00:00.000Z",
  publishedByStaffId: "staff-publisher",
}

describe("schema unfreeze — pure readers", () => {
  it("resolves question state from the column first, then the legacy JSON envelope", () => {
    const columns = { status: "published", publishedAt: new Date("2026-02-02T00:00:00.000Z") }

    expect(resolveGenerationStatus({ ...columns, metadata: LEGACY_DRAFT_METADATA })).toBe(
      "published",
    )
    expect(resolvePublishedAt({ ...columns, metadata: LEGACY_DRAFT_METADATA })).toBe(
      "2026-02-02T00:00:00.000Z",
    )

    // No column (pre-migration row): the legacy envelope still decides.
    expect(resolveGenerationStatus({ status: null, metadata: LEGACY_DRAFT_METADATA })).toBe("draft")
    expect(resolvePublishedAt({ status: null, metadata: LEGACY_PUBLISHED_METADATA })).toBe(
      "2026-01-01T00:00:00.000Z",
    )

    // Neither: a hand-authored question, not a generated one.
    expect(isGeneratedQuestion({ status: null, metadata: null })).toBe(false)
    expect(
      resolveGenerationStatus({ status: null, metadata: { note: "hand-authored" } }),
    ).toBeNull()
  })

  it("treats a malformed analytics setting as unset and keeps the code defaults", () => {
    expect(readAnalyticsSettings("not-an-object")).toEqual({})
    expect(readAnalyticsSettings({ intervention: { contributionShareAtLeast: 5 } })).toEqual({})

    const stored = readAnalyticsSettings({ intervention: { classAverageBelow: 42 } })
    const resolved = resolveInterventionThresholds(stored)
    expect(resolved.classAverageBelow).toBe(42)
    // Untouched keys keep their code default.
    expect(resolved.pendingReviewsAtLeast).toBe(1)
  })

  it("reads a malformed formation profile as unset", () => {
    expect(readFormationProfile(null)).toEqual({ attributes: {} })
    expect(readFormationProfile(["not", "a", "record"])).toEqual({ attributes: {} })
    expect(readFormationProfile({ attributes: { gpa: 3.5 }, availability: ["Mon"] })).toEqual({
      attributes: { gpa: 3.5 },
      availability: ["Mon"],
    })
    expect(toFormationProfileJson({ attributes: { major: "CS" } })).toEqual({
      attributes: { major: "CS" },
    })
  })
})

describe("schema unfreeze — database behaviour", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("keeps pre-migration draft questions undeliverable until published", () => {
    const legacyDraft = {
      status: null,
      metadata: LEGACY_DRAFT_METADATA,
      options: [{ isCorrect: true }, { isCorrect: false }],
    }
    const legacyPublished = {
      status: null,
      metadata: LEGACY_PUBLISHED_METADATA,
      options: [{ isCorrect: true }, { isCorrect: false }],
    }
    const handAuthored = {
      status: null,
      metadata: null,
      options: [{ isCorrect: true }, { isCorrect: false }],
    }

    expect(quizDeliveryStatus([legacyDraft]).deliverable).toBe(false)
    expect(quizDeliveryStatus([legacyPublished]).deliverable).toBe(true)
    expect(quizDeliveryStatus([handAuthored]).deliverable).toBe(true)
  })

  it("breaks a same-millisecond suggestion tie with the sequence, latest insert wins", async () => {
    const f = await createSpineFixture(prisma)
    const studentId = f.student.studentProfile!.id
    const sameInstant = new Date("2026-03-03T10:00:00.000Z")

    const suggestion = (points: number) => ({
      assessmentId: f.assessment.id,
      studentId,
      suggestedPoints: points,
      rationale: "Same bucket, same millisecond.",
      confidence: 0.9,
      model: "mock",
      promptVersion: "v1",
      latencyMs: 1,
      criterionLabel: "Tie bucket",
    })

    await recordAiSuggestion(suggestion(4))
    await prisma.aIGradeSuggestion.updateMany({ data: { createdAt: sameInstant } })
    await recordAiSuggestion(suggestion(9))
    // Force an exact millisecond tie for the bucket: only `seq` can decide.
    await prisma.aIGradeSuggestion.updateMany({ data: { createdAt: sameInstant } })

    const grade = await prisma.grade.findFirstOrThrow({
      where: { assessmentId: f.assessment.id, studentId },
    })
    expect(Number(grade.points)).toBe(9)

    const rows = await prisma.aIGradeSuggestion.findMany({
      where: { assessmentId: f.assessment.id, studentId },
      orderBy: { seq: "asc" },
      select: { suggestedPoints: true },
    })
    expect(rows.map((row) => Number(row.suggestedPoints))).toEqual([4, 9])
  })

  it("resolves persisted LTI user mappings for active registrations only", async () => {
    const f = await createSpineFixture(prisma)
    const studentId = f.student.studentProfile!.id

    const registration = await prisma.ltiRegistration.create({
      data: {
        platformIssuer: "https://lms.example.edu",
        clientId: "client-1",
        deploymentId: "deployment-1",
        keyId: "key-1",
        privateKeyRef: "LTI_PRIVATE_KEY",
        isActive: true,
      },
    })
    await prisma.ltiUserMapping.create({
      data: { registrationId: registration.id, studentId, ltiUserId: "lms-user-42" },
    })

    const mapped = await resolveLtiUserIds([studentId])
    expect(mapped.get(studentId)).toBe("lms-user-42")

    await prisma.ltiRegistration.update({
      where: { id: registration.id },
      data: { isActive: false },
    })
    expect((await resolveLtiUserIds([studentId])).size).toBe(0)
  })

  it("persists and reads a student formation profile through the JSON column", async () => {
    const f = await createSpineFixture(prisma)
    const studentId = f.student.studentProfile!.id

    await prisma.studentProfile.update({
      where: { id: studentId },
      data: {
        formationProfile: toFormationProfileJson({
          attributes: { gpa: 3.8, major: "CS" },
          availability: ["Mon", "Wed"],
        }),
      },
    })

    const row = await prisma.studentProfile.findUniqueOrThrow({ where: { id: studentId } })
    expect(readFormationProfile(row.formationProfile)).toEqual({
      attributes: { gpa: 3.8, major: "CS" },
      availability: ["Mon", "Wed"],
    })
  })
})
