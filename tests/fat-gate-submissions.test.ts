import { afterAll, beforeEach, describe, expect, it } from "vitest"

import type { SandboxExecutor } from "@/lib/code-eval/executor"
import { submitCodeForStudent } from "@/lib/code-eval/submissions"
import { evaluateFatGateForStudent } from "@/lib/grading/offering-config-service"
import { prisma } from "@/lib/prisma"

import { disconnectTestDatabase, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * The FAT gate on the **submission** paths, not just the quiz one.
 *
 * The gate was enforced at `startQuizAttempt` first, which left a gap the previous change recorded
 * rather than hid: a course whose final assessment is a written piece or a code task had no
 * enforcement at all. These tests cover the two submission paths that exist.
 *
 * The same three narrowings apply — they live in `evaluateFatGateForStudent`, so what is asserted here
 * is that the *callers* honour the verdict and place the check where it costs nothing.
 *
 * ## The group-project case, stated rather than faked
 *
 * There is no third test here for `GROUP_PROJECT`, and it is not an omission: a group project has **no
 * per-student submission path**. Its mark is published by the teacher for every member at once
 * (`createGroupProject` in the seed does exactly that), so there is no student action to refuse and a
 * gate would be vacuous. Adding one would be building a check around a flow that does not exist.
 */

/**
 * A sandbox executor stub that reports a clean run.
 *
 * Only the fields the pipeline actually reads matter here; the rest are the "nothing went wrong at the
 * infrastructure level" values, which `resolveRunStatus` needs to avoid reporting an infra failure.
 */
const cleanExecutor: SandboxExecutor = async () => ({
  kind: "completed",
  exitCode: 0,
  stdout: JSON.stringify({ results: [] }),
  stderr: "",
  wallClockMs: 5,
  timedOut: false,
  memoryExceeded: false,
  outputLimitExceeded: false,
  message: null,
})

const CAT_MINIMUM = 30

function policy(finalAssessmentId: string) {
  return { catWeight: 40, fatWeight: 60, finalAssessmentId, minimumCatPercent: CAT_MINIMUM }
}

const PAST = new Date("2026-09-01T08:00:00.000Z")
const PAST_PUBLISHED = new Date("2026-09-05T00:00:00.000Z")
const FUTURE = new Date("2026-12-01T08:00:00.000Z")

/**
 * A past-due CAT quiz with a published mark, plus a code-task final assessment.
 *
 * The spine fixture leaves its own quiz on the offering, so the final assessment is always named
 * explicitly — otherwise the fixture's assessment could silently become the FAT and make an assertion
 * vacuous.
 */
async function withCodeFat(options: { catPercent: number; fatDue?: Date }) {
  const fixture = await createSpineFixture(prisma)
  const studentId = fixture.student.studentProfile!.id
  const staffId = fixture.teacher.staffProfile!.id

  // Released: `fat` is submitted through `submitCodeForStudent`, which now scopes on release. The
  // fixture supplies the gate, not the guard, so the assessment must be a normal released one.
  const RELEASED_AT = new Date("2026-01-01T00:00:00.000Z")
  const cat = await prisma.assessment.create({
    data: {
      title: "CAT quiz",
      type: "QUIZ",
      dueDate: PAST,
      maxMarks: 20,
      offeringId: fixture.offering.id,
      courseId: fixture.course.id,
      classId: fixture.classroom.id,
      createdById: staffId,
      releasedAt: RELEASED_AT,
    },
  })
  await prisma.grade.create({
    data: {
      assessmentId: cat.id,
      studentId,
      points: (options.catPercent / 100) * 20,
      maxPoints: 20,
      source: "TEACHER_OVERRIDE",
      approvedById: staffId,
      publishedAt: PAST_PUBLISHED,
    },
  })

  const fat = await prisma.assessment.create({
    data: {
      title: "Final code task",
      type: "CODE",
      dueDate: options.fatDue ?? FUTURE,
      maxMarks: 30,
      offeringId: fixture.offering.id,
      courseId: fixture.course.id,
      classId: fixture.classroom.id,
      createdById: staffId,
      releasedAt: RELEASED_AT,
    },
  })
  const codeTask = await prisma.codeTask.create({
    data: { assessmentId: fat.id, language: "python" },
  })
  // `submitCodeForStudent` refuses a task with no active test cases before it reaches the sandbox.
  await prisma.testCase.create({
    data: {
      codeTaskId: codeTask.id,
      name: "Returns the sum",
      category: "unit",
      input: JSON.stringify({ args: [1, 2] }),
      expectedOutput: "3",
      isHidden: false,
      order: 0,
    },
  })

  await prisma.enrollment.create({ data: { studentId, offeringId: fixture.offering.id } })

  const setPolicy = (config: object) =>
    prisma.courseOffering.update({
      where: { id: fixture.offering.id },
      data: { gradingConfig: config },
    })

  return { fixture, cat, fat, codeTask, studentId, setPolicy }
}

describe("the FAT gate on a code-task final", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("refuses a submission for a student below the minimum CAT", async () => {
    const { fixture, fat, codeTask, studentId, setPolicy } = await withCodeFat({ catPercent: 5 })
    await setPolicy(policy(fat.id))

    await expect(
      submitCodeForStudent(
        { id: fixture.student.id, email: fixture.student.email, role: "student" },
        { assessmentId: fat.id, sourceCode: "print(3)" },
        { executor: cleanExecutor },
      ),
    ).rejects.toMatchObject({ status: 403 })

    // The refusal must cost nothing: no reservation, no run, no submission row. The check is placed
    // before the slot reservation for exactly this reason.
    expect(await prisma.testRun.count({ where: { codeTaskId: codeTask.id, studentId } })).toBe(0)
    expect(await prisma.submission.count({ where: { assessmentId: fat.id, studentId } })).toBe(0)
  })

  it("allows the same student through when the gate is not configured", async () => {
    // No stored policy means no gate — the same rule the export and the quiz path follow.
    const { fixture, fat, codeTask, studentId } = await withCodeFat({ catPercent: 5 })

    const result = await submitCodeForStudent(
      { id: fixture.student.id, email: fixture.student.email, role: "student" },
      { assessmentId: fat.id, sourceCode: "print(3)" },
      { executor: cleanExecutor },
    )

    expect(result.assessmentId).toBe(fat.id)
    expect(await prisma.testRun.count({ where: { codeTaskId: codeTask.id, studentId } })).toBe(1)
  })

  it("does not gate when the code task is not the offering's final assessment", async () => {
    // A course can hold several code tasks; only the one the policy resolves as the FAT is gated.
    const { fixture, fat, cat, codeTask, studentId, setPolicy } = await withCodeFat({
      catPercent: 5,
    })
    // `cat` is named the FAT, so the code task is an ordinary assessment and must stay submittable by
    // a student the gate would refuse for the *other* assessment.
    await setPolicy(policy(cat.id))

    const result = await submitCodeForStudent(
      { id: fixture.student.id, email: fixture.student.email, role: "student" },
      { assessmentId: fat.id, sourceCode: "print(3)" },
      { executor: cleanExecutor },
    )

    expect(result.assessmentId).toBe(fat.id)
    expect(await prisma.testRun.count({ where: { codeTaskId: codeTask.id, studentId } })).toBe(1)
  })
})

describe("the FAT gate and the submission route's kind guard", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("gates a descriptive final assessment", async () => {
    // The route used to reject anything that was not an ASSIGNMENT, so a descriptive assessment could
    // not be submitted at all — which also meant a descriptive FAT could never be gated, because there
    // was no submission to refuse.
    const fixture = await createSpineFixture(prisma)
    const studentId = fixture.student.studentProfile!.id
    const staffId = fixture.teacher.staffProfile!.id

    const cat = await prisma.assessment.create({
      data: {
        title: "CAT quiz",
        type: "QUIZ",
        dueDate: PAST,
        maxMarks: 20,
        offeringId: fixture.offering.id,
        courseId: fixture.course.id,
        classId: fixture.classroom.id,
        createdById: staffId,
      },
    })
    await prisma.grade.create({
      data: {
        assessmentId: cat.id,
        studentId,
        points: 2, // 10% — below the 30% minimum
        maxPoints: 20,
        source: "TEACHER_OVERRIDE",
        approvedById: staffId,
        publishedAt: PAST_PUBLISHED,
      },
    })
    const essay = await prisma.assessment.create({
      data: {
        title: "Final essay",
        type: "DESCRIPTIVE",
        dueDate: FUTURE,
        maxMarks: 30,
        offeringId: fixture.offering.id,
        courseId: fixture.course.id,
        classId: fixture.classroom.id,
        createdById: staffId,
      },
    })
    await prisma.enrollment.create({ data: { studentId, offeringId: fixture.offering.id } })
    await prisma.courseOffering.update({
      where: { id: fixture.offering.id },
      data: { gradingConfig: policy(essay.id) },
    })

    const decision = await evaluateFatGateForStudent({
      offeringId: fixture.offering.id,
      assessmentId: essay.id,
      studentId,
    })

    expect(decision.allowed).toBe(false)
    expect(decision.allowed === false && decision.reason).toBe("below-cat-minimum")
  })
})
