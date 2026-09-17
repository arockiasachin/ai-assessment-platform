import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { recordManualMark, submitReviewDecision } from "@/lib/grading"
import type { LlmGenerateResult, LlmProvider } from "@/lib/llm"
import type { AuthUser } from "@/lib/session"
import {
  RUBRIC_PROMPT_VERSION,
  evaluateSubmissionForTeacher,
  getReviewDetailForTeacher,
  listEvaluationCandidatesForTeacher,
  listReviewQueueForTeacher,
  listRubricsForTeacher,
  upsertRubricForTeacher,
  type RubricUpsertRequest,
} from "@/lib/rubric-grading"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * End-to-end coverage for the rubric-grading pod against the real database and
 * a fake, dependency-injected LLM provider.
 *
 * The two invariants under test:
 *  1. No grade publishes without an explicit human `accept`/`override`, and a
 *     later model output never overwrites a published grade.
 *  2. Re-evaluating a submission supersedes the previous suggestion per
 *     criterion instead of summing historical rows (bug-fix run 1).
 */

const SUBMISSION_TEXT =
  "The author argues that remote work raises productivity because it removes commutes. " +
  "Studies show a 13% gain, though the evidence is correlational."

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type FakeEvaluation = {
  score: number
  rationale: string
  evidence: string
  confidence: number
}

function fakeProvider(responses: FakeEvaluation[]): LlmProvider {
  let index = 0
  return {
    name: "mock",
    defaultModel: "fake-llm",
    defaultEmbeddingModel: "fake-embedding",
    supportsEmbeddings: false,
    async generate(): Promise<LlmGenerateResult> {
      const response = responses[Math.min(index, responses.length - 1)]
      index += 1
      return {
        text: JSON.stringify(response),
        model: "fake-llm",
        provider: "mock",
        usage: { promptTokens: 11, completionTokens: 7, totalTokens: 18 },
        latencyMs: 9,
        finishReason: "stop",
        raw: { index },
      }
    },
    async embed() {
      throw new Error("The fake provider does not embed.")
    },
  }
}

function argumentEval(overrides: Partial<FakeEvaluation> = {}): FakeEvaluation {
  return {
    score: 7,
    rationale: "The claim is stated and supported.",
    evidence: "remote work raises productivity because it removes commutes",
    confidence: 0.9,
    ...overrides,
  }
}

function evidenceEval(overrides: Partial<FakeEvaluation> = {}): FakeEvaluation {
  return {
    score: 6,
    rationale: "Evidence is cited.",
    evidence: "Studies show a 13% gain",
    confidence: 0.8,
    ...overrides,
  }
}

function teacherSession(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "teacher" }
}

const rubricPayload = (assessmentId: string): RubricUpsertRequest => ({
  assessmentId,
  title: "Essay rubric",
  criteria: [
    { label: "Argument", description: "Claims are supported", weight: 1, maxPoints: 10 },
    { label: "Evidence", description: "Uses evidence", weight: 1, maxPoints: 10 },
  ],
})

async function seedAssessment() {
  const f = await createSpineFixture(prisma)
  const studentId = f.student.studentProfile!.id
  const assessment = await prisma.assessment.create({
    data: {
      offeringId: f.offering.id,
      courseId: f.course.id,
      classId: f.classroom.id,
      title: "Descriptive assignment",
      type: "DESCRIPTIVE",
      dueDate: new Date("2027-01-01T08:00:00.000Z"),
      maxMarks: 20,
      createdById: f.teacher.staffProfile!.id,
    },
  })
  await prisma.enrollment.create({
    data: { studentId, offeringId: f.offering.id, status: "active" },
  })

  const teacherUser = teacherSession(f.teacher)
  const { rubric } = await upsertRubricForTeacher(teacherUser, rubricPayload(assessment.id))

  const submission = await prisma.submission.create({
    data: {
      assessmentId: assessment.id,
      studentId,
      status: "SUBMITTED",
      submittedAt: new Date(),
      contentText: SUBMISSION_TEXT,
    },
  })

  return { f, assessment, rubric, submission, teacherUser, studentId }
}

/** A second enrolled student, so a test can hold two submissions on one assessment. */
async function createEnrolledStudent(offeringId: string, registerNumber: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `${registerNumber.toLowerCase()}@rubric.test`,
      passwordHash: "test-only-not-a-real-hash",
      role: "STUDENT",
      studentProfile: {
        create: { fullName: `Student ${registerNumber}`, registerNumber },
      },
    },
    include: { studentProfile: true },
  })
  await prisma.enrollment.create({
    data: { studentId: user.studentProfile!.id, offeringId, status: "active" },
  })
  return user.studentProfile!.id
}

async function createOtherTeacher(): Promise<AuthUser> {
  const user = await prisma.user.create({
    data: {
      email: "other-teacher@rubric.test",
      passwordHash: "test-only-not-a-real-hash",
      role: "TEACHER",
      staffProfile: { create: { fullName: "Olive Other", empId: "EMP-RUBRIC-OTHER" } },
    },
  })
  return teacherSession(user)
}

async function seedCohort(assessmentId: string, points: number, count: number) {
  for (let index = 0; index < count; index += 1) {
    const user = await prisma.user.create({
      data: {
        email: `cohort-${index}@rubric.test`,
        passwordHash: "test-only-not-a-real-hash",
        role: "STUDENT",
        studentProfile: {
          create: { fullName: `Cohort ${index}`, registerNumber: `REG-RUBRIC-${index}` },
        },
      },
      include: { studentProfile: true },
    })
    await prisma.grade.create({
      data: {
        assessmentId,
        studentId: user.studentProfile!.id,
        points,
        maxPoints: 20,
      },
    })
  }
}

describe("rubric grading pipeline", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("records one explainable suggestion per criterion and never publishes", async () => {
    const { assessment, submission, teacherUser, studentId } = await seedAssessment()

    const outcome = await evaluateSubmissionForTeacher(teacherUser, submission.id, {
      provider: fakeProvider([argumentEval(), evidenceEval()]),
    })

    expect(outcome.suggestions).toHaveLength(2)
    expect(outcome.grade.points).toBe(13)
    expect(outcome.grade.publishedAt).toBeNull()
    expect(outcome.flagged).toBe(false)
    expect(outcome.review.status).toBe("PENDING")

    for (const suggestion of outcome.suggestions) {
      expect(suggestion.rationale.length).toBeGreaterThan(0)
      expect(suggestion.evidence).toBeTruthy()
      expect(suggestion.confidence).toBeGreaterThan(0)
      expect(suggestion.model).toBe("fake-llm")
      expect(suggestion.promptVersion).toBe(RUBRIC_PROMPT_VERSION)
      expect(suggestion.latencyMs).toBe(9)
    }

    const grade = await prisma.grade.findFirstOrThrow({
      where: { assessmentId: assessment.id, studentId },
    })
    expect(grade.publishedAt).toBeNull()
    expect(grade.source).toBe("AI_SUGGESTED")

    const audits = await prisma.auditLog.count({
      where: { entityType: "AIGradeSuggestion", action: "ai_suggestion.recorded" },
    })
    expect(audits).toBe(2)
  })

  it("supersedes the previous suggestion per criterion on re-evaluation", async () => {
    const { assessment, submission, teacherUser, studentId } = await seedAssessment()

    await evaluateSubmissionForTeacher(teacherUser, submission.id, {
      provider: fakeProvider([argumentEval(), evidenceEval()]),
    })
    await sleep(5)
    const rerun = await evaluateSubmissionForTeacher(teacherUser, submission.id, {
      provider: fakeProvider([argumentEval({ score: 8 }), evidenceEval({ score: 4 })]),
    })

    // 8 + 4, not (7 + 6) + (8 + 4).
    expect(rerun.grade.points).toBe(12)
    const grade = await prisma.grade.findFirstOrThrow({
      where: { assessmentId: assessment.id, studentId },
    })
    expect(Number(grade.points)).toBe(12)

    // History is preserved: two rows per criterion.
    const count = await prisma.aIGradeSuggestion.count({
      where: { assessmentId: assessment.id, studentId },
    })
    expect(count).toBe(4)
  })

  it("publishes only on human approval and never overwrites the published grade", async () => {
    const { assessment, submission, teacherUser, studentId } = await seedAssessment()

    await evaluateSubmissionForTeacher(teacherUser, submission.id, {
      provider: fakeProvider([argumentEval(), evidenceEval()]),
    })

    const draft = await prisma.grade.findFirstOrThrow({
      where: { assessmentId: assessment.id, studentId },
    })
    expect(draft.publishedAt).toBeNull()

    await submitReviewDecision({
      assessmentId: assessment.id,
      studentId,
      reviewer: { id: teacherUser.id, role: "teacher" },
      decision: { action: "accept" },
    })

    const published = await prisma.grade.findFirstOrThrow({
      where: { assessmentId: assessment.id, studentId },
    })
    expect(published.publishedAt).not.toBeNull()
    expect(Number(published.points)).toBe(13)

    // A later model output must leave the published grade byte-for-byte intact.
    await sleep(5)
    await evaluateSubmissionForTeacher(teacherUser, submission.id, {
      provider: fakeProvider([argumentEval({ score: 1 }), evidenceEval({ score: 1 })]),
    })

    const after = await prisma.grade.findFirstOrThrow({
      where: { assessmentId: assessment.id, studentId },
    })
    expect(Number(after.points)).toBe(13)
    expect(after.publishedAt?.toISOString()).toBe(published.publishedAt?.toISOString())

    const publishAudits = await prisma.auditLog.count({
      where: { entityType: "Grade", action: "grade.published" },
    })
    expect(publishAudits).toBe(1)
  })

  it("publishes an override with its reason and rejects one above the ceiling", async () => {
    const { assessment, submission, teacherUser, studentId } = await seedAssessment()

    await evaluateSubmissionForTeacher(teacherUser, submission.id, {
      provider: fakeProvider([argumentEval(), evidenceEval()]),
    })

    await submitReviewDecision({
      assessmentId: assessment.id,
      studentId,
      reviewer: { id: teacherUser.id, role: "teacher" },
      decision: { action: "override", points: 15, reason: "Rubric descriptor misread." },
    })

    const grade = await prisma.grade.findFirstOrThrow({
      where: { assessmentId: assessment.id, studentId },
    })
    expect(Number(grade.points)).toBe(15)
    expect(grade.source).toBe("TEACHER_OVERRIDE")
    expect(grade.overrideReason).toBe("Rubric descriptor misread.")
    expect(grade.publishedAt).not.toBeNull()

    const review = await prisma.gradeReview.findFirstOrThrow({
      where: { assessmentId: assessment.id, studentId },
    })
    expect(review.status).toBe("OVERRIDDEN")

    await expect(
      submitReviewDecision({
        assessmentId: assessment.id,
        studentId,
        reviewer: { id: teacherUser.id, role: "teacher" },
        decision: { action: "override", points: 999, reason: "Too high." },
      }),
    ).rejects.toThrowError(/ceiling/)
  })

  it("flags low-confidence criteria for review without publishing", async () => {
    const { assessment, submission, teacherUser, studentId } = await seedAssessment()

    const outcome = await evaluateSubmissionForTeacher(teacherUser, submission.id, {
      provider: fakeProvider([
        argumentEval({ confidence: 0.3 }),
        evidenceEval({ confidence: 0.95 }),
      ]),
    })

    expect(outcome.flagged).toBe(true)
    expect(outcome.review.status).toBe("NEEDS_REVIEW")
    expect(outcome.flagReasons.some((reason) => reason.includes("Low confidence"))).toBe(true)
    expect(outcome.grade.publishedAt).toBeNull()

    const flagged = await prisma.auditLog.findFirst({
      where: { entityType: "GradeReview", action: "grade_review.ai_flagged" },
    })
    expect(flagged).not.toBeNull()

    const grade = await prisma.grade.findFirstOrThrow({
      where: { assessmentId: assessment.id, studentId },
    })
    expect(grade.publishedAt).toBeNull()
  })

  it("flags a statistical-outlier total for review", async () => {
    const { assessment, submission, teacherUser, studentId } = await seedAssessment()
    await seedCohort(assessment.id, 10, 5)

    const outcome = await evaluateSubmissionForTeacher(teacherUser, submission.id, {
      provider: fakeProvider([argumentEval({ score: 0 }), evidenceEval({ score: 0 })]),
    })

    expect(outcome.flagged).toBe(true)
    expect(outcome.review.status).toBe("NEEDS_REVIEW")
    expect(outcome.flagReasons.some((reason) => reason.includes("statistical outlier"))).toBe(true)

    const grade = await prisma.grade.findFirstOrThrow({
      where: { assessmentId: assessment.id, studentId },
    })
    expect(Number(grade.points)).toBe(0)
    expect(grade.publishedAt).toBeNull()
  })

  it("enforces object-level authorization for evaluation and review reads", async () => {
    const { assessment, submission, teacherUser, studentId } = await seedAssessment()
    await evaluateSubmissionForTeacher(teacherUser, submission.id, {
      provider: fakeProvider([argumentEval(), evidenceEval()]),
    })

    const otherTeacher = await createOtherTeacher()
    await expect(
      evaluateSubmissionForTeacher(otherTeacher, submission.id, {
        provider: fakeProvider([argumentEval()]),
      }),
    ).rejects.toMatchObject({ status: 403 })

    await expect(
      getReviewDetailForTeacher(otherTeacher, assessment.id, studentId),
    ).rejects.toMatchObject({ status: 404 })
    expect(await listReviewQueueForTeacher(otherTeacher)).toEqual([])

    const studentUser: AuthUser = {
      id: (await prisma.studentProfile.findUniqueOrThrow({ where: { id: studentId } })).userId,
      email: "student@rubric.test",
      role: "student",
    }
    await expect(
      evaluateSubmissionForTeacher(studentUser, submission.id, {
        provider: fakeProvider([argumentEval()]),
      }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it("keeps rubric authoring teacher-owned and freezes it once a grade is published", async () => {
    const { assessment, submission, teacherUser, studentId } = await seedAssessment()
    const otherTeacher = await createOtherTeacher()

    await expect(
      upsertRubricForTeacher(otherTeacher, rubricPayload(assessment.id)),
    ).rejects.toMatchObject({ status: 403 })

    await evaluateSubmissionForTeacher(teacherUser, submission.id, {
      provider: fakeProvider([argumentEval(), evidenceEval()]),
    })
    await submitReviewDecision({
      assessmentId: assessment.id,
      studentId,
      reviewer: { id: teacherUser.id, role: "teacher" },
      decision: { action: "accept" },
    })

    await expect(
      upsertRubricForTeacher(teacherUser, {
        ...rubricPayload(assessment.id),
        title: "Changed after publishing",
      }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it("returns the latest per-criterion suggestion in the review queue", async () => {
    const { assessment, submission, teacherUser, studentId } = await seedAssessment()
    await evaluateSubmissionForTeacher(teacherUser, submission.id, {
      provider: fakeProvider([argumentEval(), evidenceEval()]),
    })
    await sleep(5)
    await evaluateSubmissionForTeacher(teacherUser, submission.id, {
      provider: fakeProvider([argumentEval({ score: 9 }), evidenceEval({ score: 2 })]),
    })

    const items = await listReviewQueueForTeacher(teacherUser)
    expect(items).toHaveLength(1)
    const item = items[0]
    expect(item.assessment.id).toBe(assessment.id)
    expect(item.student.id).toBe(studentId)
    // One suggestion per criterion, showing the latest score (9 and 2), not both runs.
    expect(item.suggestions).toHaveLength(2)
    const byLabel = new Map(item.suggestions.map((s) => [s.criterionLabel, s.suggestedPoints]))
    expect(byLabel.get("Argument")).toBe(9)
    expect(byLabel.get("Evidence")).toBe(2)
    expect(item.grade?.points).toBe(11)
  })

  it("never offers or evaluates a never-submitted draft (TN-35)", async () => {
    const { f, assessment, submission, teacherUser } = await seedAssessment()
    const draftStudentId = await createEnrolledStudent(f.offering.id, "REG-RUBRIC-DRAFT")
    const draft = await prisma.submission.create({
      data: {
        assessmentId: assessment.id,
        studentId: draftStudentId,
        status: "DRAFT",
        contentText: SUBMISSION_TEXT,
      },
    })

    const candidates = await listEvaluationCandidatesForTeacher(teacherUser)
    expect(candidates.map((candidate) => candidate.submissionId)).toContain(submission.id)
    expect(candidates.map((candidate) => candidate.submissionId)).not.toContain(draft.id)

    // The reader hides it, but a caller with the id must still be refused.
    await expect(
      evaluateSubmissionForTeacher(teacherUser, draft.id, {
        provider: fakeProvider([argumentEval()]),
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/not been handed in/i),
    })
  })

  it("lists only rubric-eligible assessments and reports the frozen state (TN-43)", async () => {
    const { f, assessment, submission, teacherUser, studentId } = await seedAssessment()
    const quiz = await prisma.assessment.create({
      data: {
        offeringId: f.offering.id,
        courseId: f.course.id,
        classId: f.classroom.id,
        title: "Auto-scored quiz",
        type: "QUIZ",
        dueDate: new Date("2027-02-01T08:00:00.000Z"),
        maxMarks: 20,
        createdById: f.teacher.staffProfile!.id,
      },
    })

    const before = await listRubricsForTeacher(teacherUser)
    expect(before.map((summary) => summary.id)).toContain(assessment.id)
    expect(before.map((summary) => summary.id)).not.toContain(quiz.id)
    expect(before.find((summary) => summary.id === assessment.id)!.locked).toBe(false)

    // A quiz can never carry a rubric, on either path.
    await expect(upsertRubricForTeacher(teacherUser, rubricPayload(quiz.id))).rejects.toMatchObject(
      {
        status: 409,
      },
    )

    await evaluateSubmissionForTeacher(teacherUser, submission.id, {
      provider: fakeProvider([argumentEval(), evidenceEval()]),
    })
    await submitReviewDecision({
      assessmentId: assessment.id,
      studentId,
      reviewer: { id: teacherUser.id, role: "teacher" },
      decision: { action: "accept" },
    })

    const after = await listRubricsForTeacher(teacherUser)
    expect(after.find((summary) => summary.id === assessment.id)!.locked).toBe(true)
  })

  it("allows the first rubric after a manual mark, then freezes it (TN-44)", async () => {
    const f = await createSpineFixture(prisma)
    const studentId = f.student.studentProfile!.id
    await prisma.enrollment.create({
      data: { studentId, offeringId: f.offering.id, status: "active" },
    })
    const assessment = await prisma.assessment.create({
      data: {
        offeringId: f.offering.id,
        courseId: f.course.id,
        classId: f.classroom.id,
        title: "Rubric-less descriptive",
        type: "DESCRIPTIVE",
        dueDate: new Date("2027-01-01T08:00:00.000Z"),
        maxMarks: 50,
        createdById: f.teacher.staffProfile!.id,
      },
    })
    const teacherUser = teacherSession(f.teacher)
    const submission = await prisma.submission.create({
      data: {
        assessmentId: assessment.id,
        studentId,
        status: "SUBMITTED",
        submittedAt: new Date(),
        contentText: SUBMISSION_TEXT,
      },
    })

    // A manual mark is published before any rubric exists. Before TN-44 this
    // permanently blocked authoring the rubric.
    await recordManualMark({
      assessmentId: assessment.id,
      studentId,
      points: 40,
      maxPoints: 50,
      actor: { id: teacherUser.id, role: "teacher" },
    })
    const first = await upsertRubricForTeacher(teacherUser, {
      assessmentId: assessment.id,
      title: "First rubric",
      criteria: [
        { label: "Argument", weight: 1, maxPoints: 25 },
        { label: "Evidence", weight: 1, maxPoints: 25 },
      ],
    })
    expect(first.rubric.criteria).toHaveLength(2)

    // The manual mark pre-dates the rubric, so the rubric is not frozen and can
    // still be edited.
    expect(
      (await listRubricsForTeacher(teacherUser)).find((summary) => summary.id === assessment.id)!
        .locked,
    ).toBe(false)
    await expect(
      upsertRubricForTeacher(teacherUser, {
        assessmentId: assessment.id,
        title: "Edited rubric",
        criteria: [{ label: "Argument", weight: 1, maxPoints: 50 }],
      }),
    ).resolves.toBeTruthy()

    // A grade published against the rubric freezes it.
    await evaluateSubmissionForTeacher(teacherUser, submission.id, {
      provider: fakeProvider([argumentEval({ score: 30 })]),
    })
    await submitReviewDecision({
      assessmentId: assessment.id,
      studentId,
      reviewer: { id: teacherUser.id, role: "teacher" },
      decision: { action: "override", points: 30, reason: "Aligned to the rubric." },
    })
    expect(
      (await listRubricsForTeacher(teacherUser)).find((summary) => summary.id === assessment.id)!
        .locked,
    ).toBe(true)
    await expect(
      upsertRubricForTeacher(teacherUser, {
        assessmentId: assessment.id,
        title: "After publish",
        criteria: [{ label: "Argument", weight: 1, maxPoints: 50 }],
      }),
    ).rejects.toMatchObject({ status: 409 })
  })
})
