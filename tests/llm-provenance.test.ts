import { afterAll, beforeEach, describe, expect, it } from "vitest"

import type { LlmProvider } from "@/lib/llm"
import { evaluateSubmissionForTeacher, upsertRubricForTeacher } from "@/lib/rubric-grading"
import type { AuthUser } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * Model provenance for a contestable grade.
 *
 * `deepseek-flash` is a moving target: DeepSeek publishes no immutable snapshot
 * id, so a grade produced today cannot be tied to a build by model name alone.
 * The provider response carries an `id` and a `system_fingerprint`; this test
 * proves the existing `AIGradeSuggestion.rawResponse` JSON column already
 * captures both, end to end, without a schema change.
 */

const SUBMISSION_TEXT =
  "The author argues that remote work raises productivity because it removes commutes. " +
  "Studies show a 13% gain, though the evidence is correlational."

const RAW_RESPONSE = {
  id: "chatcmpl-deepseek-abc123",
  object: "chat.completion",
  model: "deepseek-flash",
  system_fingerprint: "fp_deepseek_v41_20260910",
  choices: [{ message: { content: "…" }, finish_reason: "stop" }],
}

/** A DeepSeek-shaped provider whose only endpoint call is stubbed out. */
function provenanceProvider(): LlmProvider {
  return {
    name: "deepseek",
    defaultModel: "deepseek-flash",
    defaultEmbeddingModel: "",
    supportsEmbeddings: false,
    async generate() {
      return {
        text: JSON.stringify({
          score: 6,
          rationale: "A defensible argument with one piece of supporting evidence.",
          evidence: SUBMISSION_TEXT.split(" ").slice(0, 8).join(" "),
          confidence: 0.9,
        }),
        model: "deepseek-flash",
        provider: "deepseek",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        latencyMs: 12,
        finishReason: "stop",
        raw: RAW_RESPONSE,
      }
    },
    async embed() {
      throw new Error("deepseek supports no embeddings")
    },
  }
}

function teacherSession(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "teacher" }
}

describe("AI grade model provenance", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("persists the response id and system_fingerprint on the stored suggestion", async () => {
    const f = await createSpineFixture(prisma)
    const assessment = await prisma.assessment.create({
      data: {
        offeringId: f.offering.id,
        courseId: f.course.id,
        classId: f.classroom.id,
        title: "Provenance assignment",
        type: "DESCRIPTIVE",
        dueDate: new Date("2027-01-01T08:00:00.000Z"),
        maxMarks: 10,
        createdById: f.teacher.staffProfile!.id,
      },
    })
    const teacherUser = teacherSession(f.teacher)
    await upsertRubricForTeacher(teacherUser, {
      assessmentId: assessment.id,
      title: "One-criterion rubric",
      criteria: [{ label: "Argument", weight: 1, maxPoints: 10 }],
    })
    const submission = await prisma.submission.create({
      data: {
        assessmentId: assessment.id,
        studentId: f.student.studentProfile!.id,
        status: "SUBMITTED",
        submittedAt: new Date(),
        contentText: SUBMISSION_TEXT,
      },
    })

    await evaluateSubmissionForTeacher(teacherUser, submission.id, {
      provider: provenanceProvider(),
    })

    const stored = await prisma.aIGradeSuggestion.findFirstOrThrow({
      where: { assessmentId: assessment.id, studentId: f.student.studentProfile!.id },
    })

    expect(stored.model).toBe("deepseek-flash")
    expect(stored.rawResponse).toMatchObject({
      id: "chatcmpl-deepseek-abc123",
      system_fingerprint: "fp_deepseek_v41_20260910",
    })
  })
})
