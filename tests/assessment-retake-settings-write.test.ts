import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { updateAssessmentRequestSchema } from "@/lib/contracts"
import { AssessmentWriteError, updateAssessmentForSessionUser } from "@/lib/gradebook-db"
import { describeRetakeSettingsProblem } from "@/lib/quiz-attempts/retake-policy"
import {
  decideRetakeRequest,
  getMyRetakeRequest,
  listRetakeRequestsForTeacher,
  requestRetake,
} from "@/lib/quiz-attempts/retake-requests"
import { startQuizAttempt, submitQuizAttempt } from "@/lib/quiz-attempts/service"
import type { AuthUser } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { captureRefusal, expectIndistinguishable } from "./helpers/refusal"
import { createSpineFixture } from "./fixtures/spine"

/**
 * SN-35 — the retake settings write path.
 *
 * `Assessment.retakePolicy` and `retakesAllowed` were read in roughly twenty places and written in
 * none, so every assessment was stuck on `FIXED` and the student's `APPROVAL`-only request could
 * never succeed: the control was dead end-to-end. These tests pin the missing writer — the PATCH
 * contract, the pair rule the service enforces against the *stored* value, ownership
 * indistinguishability (TN-69), and the full round trip that proves the student path is reachable
 * once a teacher can actually set the policy.
 */

function teacherSession(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "teacher" }
}

function studentSession(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "student" }
}

async function enrolAndAuthor(f: Awaited<ReturnType<typeof createSpineFixture>>) {
  await prisma.enrollment.create({
    data: { studentId: f.student.studentProfile!.id, offeringId: f.offering.id, status: "active" },
  })
  // A deadline in the future keeps the attempt gate on the policy question rather than the clock,
  // matching the sibling retake tests.
  await prisma.assessment.update({
    where: { id: f.assessment.id },
    data: { dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
  })
  for (let index = 0; index < 2; index += 1) {
    await prisma.question.create({
      data: {
        assessmentId: f.assessment.id,
        order: index + 1,
        prompt: `Question ${index + 1}`,
        options: {
          create: [
            { order: 0, text: "A", isCorrect: true },
            { order: 1, text: "B", isCorrect: false },
          ],
        },
      },
    })
  }
}

async function storedPair(assessmentId: string) {
  return prisma.assessment.findUniqueOrThrow({
    where: { id: assessmentId },
    select: { retakePolicy: true, retakesAllowed: true },
  })
}

describe("updateAssessmentRequestSchema — the retake fields", () => {
  it("accepts the enum and an integer or explicit-null count", () => {
    for (const policy of ["NONE", "FIXED", "APPROVAL"] as const) {
      expect(updateAssessmentRequestSchema.safeParse({ retakePolicy: policy }).success).toBe(true)
    }
    expect(updateAssessmentRequestSchema.safeParse({ retakesAllowed: 0 }).success).toBe(true)
    expect(updateAssessmentRequestSchema.safeParse({ retakesAllowed: 3 }).success).toBe(true)
    expect(updateAssessmentRequestSchema.safeParse({ retakesAllowed: null }).success).toBe(true)
    // A form sends a string; `z.coerce` keeps that working rather than requiring the client to
    // pre-parse.
    expect(updateAssessmentRequestSchema.safeParse({ retakesAllowed: "2" }).success).toBe(true)
  })

  it("rejects an unknown policy and a negative or fractional count", () => {
    expect(updateAssessmentRequestSchema.safeParse({ retakePolicy: "SOMETIMES" }).success).toBe(
      false,
    )
    expect(updateAssessmentRequestSchema.safeParse({ retakesAllowed: -1 }).success).toBe(false)
    expect(updateAssessmentRequestSchema.safeParse({ retakesAllowed: 1.5 }).success).toBe(false)
  })

  it("still refuses a body that changes nothing", () => {
    expect(updateAssessmentRequestSchema.safeParse({}).success).toBe(false)
  })
})

describe("describeRetakeSettingsProblem", () => {
  it("allows FIXED with a fallback or zero retakes, because both are honest", () => {
    expect(describeRetakeSettingsProblem({ policy: "FIXED", retakesAllowed: null })).toBeNull()
    expect(describeRetakeSettingsProblem({ policy: "FIXED", retakesAllowed: 0 })).toBeNull()
    expect(describeRetakeSettingsProblem({ policy: "NONE", retakesAllowed: 4 })).toBeNull()
  })

  it("refuses an APPROVAL policy whose approval could never grant a sitting", () => {
    expect(
      describeRetakeSettingsProblem({ policy: "APPROVAL", retakesAllowed: null }),
    ).not.toBeNull()
    expect(describeRetakeSettingsProblem({ policy: "APPROVAL", retakesAllowed: 0 })).not.toBeNull()
    expect(describeRetakeSettingsProblem({ policy: "APPROVAL", retakesAllowed: 1 })).toBeNull()
  })
})

describe("teacher retake settings write path (SN-35)", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("persists a policy and a count, and an explicit null fallback", async () => {
    const f = await createSpineFixture(prisma)
    const actor = teacherSession(f.teacher)

    await updateAssessmentForSessionUser(actor, f.assessment.id, {
      retakePolicy: "FIXED",
      retakesAllowed: 2,
    })
    expect(await storedPair(f.assessment.id)).toEqual({
      retakePolicy: "FIXED",
      retakesAllowed: 2,
    })

    // An explicit null is "fall back to the attempt cap", which is distinct from an omitted key.
    await updateAssessmentForSessionUser(actor, f.assessment.id, { retakesAllowed: null })
    expect(await storedPair(f.assessment.id)).toEqual({
      retakePolicy: "FIXED",
      retakesAllowed: null,
    })
  })

  it("refuses to strand an APPROVAL policy without a usable count", async () => {
    const f = await createSpineFixture(prisma)
    const actor = teacherSession(f.teacher)

    const noCount = await captureRefusal(
      updateAssessmentForSessionUser(actor, f.assessment.id, { retakePolicy: "APPROVAL" }),
    )
    expect(noCount.status).toBe(400)
    const zero = await captureRefusal(
      updateAssessmentForSessionUser(actor, f.assessment.id, {
        retakePolicy: "APPROVAL",
        retakesAllowed: 0,
      }),
    )
    expect(zero.status).toBe(400)

    // The refusals changed nothing — the stored pair is still the coherent default.
    expect(await storedPair(f.assessment.id)).toEqual({
      retakePolicy: "FIXED",
      retakesAllowed: null,
    })
  })

  it("validates the pair against the stored half, not only the patch", async () => {
    const f = await createSpineFixture(prisma)
    const actor = teacherSession(f.teacher)
    await updateAssessmentForSessionUser(actor, f.assessment.id, {
      retakePolicy: "APPROVAL",
      retakesAllowed: 1,
    })

    // A patch that sends only the count must be judged against the stored `APPROVAL` policy.
    const refusal = await captureRefusal(
      updateAssessmentForSessionUser(actor, f.assessment.id, { retakesAllowed: null }),
    )
    expect(refusal.status).toBe(400)
    expect(await storedPair(f.assessment.id)).toEqual({
      retakePolicy: "APPROVAL",
      retakesAllowed: 1,
    })
  })

  it("normalises a NONE policy's count away, because it cannot apply", async () => {
    const f = await createSpineFixture(prisma)
    const actor = teacherSession(f.teacher)
    await updateAssessmentForSessionUser(actor, f.assessment.id, {
      retakePolicy: "FIXED",
      retakesAllowed: 3,
    })

    await updateAssessmentForSessionUser(actor, f.assessment.id, { retakePolicy: "NONE" })
    expect(await storedPair(f.assessment.id)).toEqual({
      retakePolicy: "NONE",
      retakesAllowed: null,
    })
  })

  it("records both halves of the pair in the audit row", async () => {
    const f = await createSpineFixture(prisma)
    const actor = teacherSession(f.teacher)
    await updateAssessmentForSessionUser(actor, f.assessment.id, {
      retakePolicy: "FIXED",
      retakesAllowed: 2,
    })

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "assessment.edited" },
      orderBy: { createdAt: "desc" },
    })
    expect(audit.before).toMatchObject({ retakePolicy: "FIXED", retakesAllowed: null })
    expect(audit.after).toMatchObject({ retakePolicy: "FIXED", retakesAllowed: 2 })
  })

  it("reports a foreign assessment identically to a missing one (TN-69)", async () => {
    const f = await createSpineFixture(prisma)
    const actor = teacherSession(f.teacher)
    const other = await prisma.user.create({
      data: {
        email: "retake-settings-outsider@spine.test",
        passwordHash: "test-only-not-a-real-hash",
        role: "TEACHER",
        staffProfile: { create: { fullName: "Ola Outsider", empId: "EMP-SN35-OTHER" } },
      },
      include: { staffProfile: true },
    })
    // Ownership is `createdById === staffId || offering.teacherId === staffId`, so the foreign
    // assessment needs its own offering too — reusing the fixture's would make it *owned*.
    const otherOffering = await prisma.courseOffering.create({
      data: {
        courseId: f.course.id,
        classId: f.classroom.id,
        teacherId: other.staffProfile!.id,
        term: "Other-Term",
        academicYear: 2026,
      },
    })
    const foreignAssessment = await prisma.assessment.create({
      data: {
        offeringId: otherOffering.id,
        courseId: f.course.id,
        classId: f.classroom.id,
        title: "Another teacher's quiz",
        type: "QUIZ",
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        maxMarks: 10,
        createdById: other.staffProfile!.id,
      },
    })

    const foreign = await captureRefusal(
      updateAssessmentForSessionUser(actor, foreignAssessment.id, {
        retakePolicy: "APPROVAL",
        retakesAllowed: 1,
      }),
    )
    const missing = await captureRefusal(
      updateAssessmentForSessionUser(actor, "no-such-assessment-zzz", {
        retakePolicy: "APPROVAL",
        retakesAllowed: 1,
      }),
    )
    expect(foreign).toEqual({ status: 404, message: "Assessment not found" })
    expectIndistinguishable(foreign, missing)
  })

  it("refuses a non-teacher with the same 403 it always has", async () => {
    const f = await createSpineFixture(prisma)
    const error = await updateAssessmentForSessionUser(studentSession(f.student), f.assessment.id, {
      retakePolicy: "APPROVAL",
      retakesAllowed: 1,
    }).catch((thrown) => thrown)
    expect(error).toBeInstanceOf(AssessmentWriteError)
    expect((error as AssessmentWriteError).status).toBe(403)
  })
})

describe("the student request path, reachable through the write path (SN-35)", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("set policy -> request -> queue -> decide -> the student may sit again", async () => {
    const f = await createSpineFixture(prisma)
    const teacher = teacherSession(f.teacher)
    const student = studentSession(f.student)
    await enrolAndAuthor(f)

    // A first graded sitting, under the default FIXED policy.
    const first = await startQuizAttempt(student, { assessmentId: f.assessment.id })
    const questions = await prisma.question.findMany({
      where: { assessmentId: f.assessment.id },
      orderBy: { order: "asc" },
    })
    await submitQuizAttempt(student, first.id, {
      answers: questions.map((question) => ({ questionId: question.id, selectedIndex: 0 })),
    })

    // Before the write path existed the policy could never become APPROVAL, so this was the only
    // answer every student ever got — and the "Request a retake" button never rendered.
    await expect(requestRetake(student, f.assessment.id)).rejects.toMatchObject({ status: 409 })

    // The teacher's settings write is the step that makes the approval policy reachable at all.
    await updateAssessmentForSessionUser(teacher, f.assessment.id, {
      retakePolicy: "APPROVAL",
      retakesAllowed: 1,
    })

    const created = await requestRetake(student, f.assessment.id, { note: "I was ill." })
    expect(created.status).toBe("PENDING")

    const queue = await listRetakeRequestsForTeacher(teacher, f.assessment.id)
    expect(queue.map((row) => row.status)).toEqual(["PENDING"])
    expect(queue[0].studentId).toBe(f.student.studentProfile!.id)

    const decided = await decideRetakeRequest(
      teacher,
      f.assessment.id,
      f.student.studentProfile!.id,
      { approve: true, note: "Approved — welcome back." },
    )
    expect(decided.status).toBe("APPROVED")
    expect((await getMyRetakeRequest(student, f.assessment.id))?.status).toBe("APPROVED")

    // The approval is what lets the second graded sitting start, which is the whole point of the
    // policy being writable.
    const second = await startQuizAttempt(student, { assessmentId: f.assessment.id })
    expect(second.id).not.toBe(first.id)
  })
})
