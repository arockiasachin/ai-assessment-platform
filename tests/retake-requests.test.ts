import { beforeAll, describe, expect, it } from "vitest"

import {
  submitQuizAttempt,
  startPracticeAttempt,
  startQuizAttempt,
} from "@/lib/quiz-attempts/service"
import {
  decideRetakeRequest,
  getMyRetakeRequest,
  listRetakeRequestsForTeacher,
  requestRetake,
} from "@/lib/quiz-attempts/retake-requests"
import type { AuthUser } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * Retake requests and the practice sitting, against a real database.
 *
 * Two properties carry the weight here. **An approval is what lets a student sit** — the request
 * record and the attempt gate must not disagree — and **practice never enters the grade
 * pipeline**, because the auto-scorer writes into a bucket keyed per student which a practice
 * submit would supersede, silently replacing the mark a teacher is about to approve.
 */

let f: Awaited<ReturnType<typeof createSpineFixture>>
let student: AuthUser
let teacher: AuthUser

beforeAll(async () => {
  await truncateAll()
  f = await createSpineFixture(prisma)
  teacher = { id: f.teacher.id, email: f.teacher.email, role: "teacher" }
  student = { id: f.student.id, email: f.student.email, role: "student" }

  await prisma.enrollment.create({
    data: { studentId: f.student.studentProfile!.id, offeringId: f.offering.id, status: "active" },
  })
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
})

async function setPolicy(policy: "NONE" | "FIXED" | "APPROVAL"): Promise<void> {
  await prisma.assessment.update({ where: { id: f.assessment.id }, data: { retakePolicy: policy } })
}

describe("requestRetake", () => {
  it("refuses on a FIXED assessment, where the cap already decides", async () => {
    await setPolicy("FIXED")
    await expect(requestRetake(student, f.assessment.id)).rejects.toMatchObject({ status: 409 })
  })

  it("refuses on a NONE assessment, where nothing may be granted", async () => {
    await setPolicy("NONE")
    await expect(requestRetake(student, f.assessment.id)).rejects.toMatchObject({ status: 409 })
  })

  it("creates a pending request on an APPROVAL assessment", async () => {
    await setPolicy("APPROVAL")
    const created = await requestRetake(student, f.assessment.id, { note: "I was ill." })
    expect(created.status).toBe("PENDING")
    expect(created.requestNote).toBe("I was ill.")
    expect(created.decidedBy).toBeNull()
  })

  it("is idempotent while pending, rather than erroring on a double click", async () => {
    const again = await requestRetake(student, f.assessment.id)
    expect(again.status).toBe("PENDING")
    expect(await prisma.retakeRequest.count({ where: { assessmentId: f.assessment.id } })).toBe(1)
  })

  it("refuses an assessment the student is not enrolled in", async () => {
    const other = await prisma.user.create({
      data: {
        email: "retake-outsider@spine.test",
        passwordHash: "test-only-not-a-real-hash",
        role: "STUDENT",
        studentProfile: { create: { fullName: "Out Sider", registerNumber: "REG-RT-9" } },
      },
    })
    await expect(
      requestRetake({ id: other.id, email: other.email, role: "student" }, f.assessment.id),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe("decideRetakeRequest", () => {
  it("refuses a teacher who does not own the assessment", async () => {
    const outsider = await prisma.user.create({
      data: {
        email: "retake-teacher-outsider@spine.test",
        passwordHash: "test-only-not-a-real-hash",
        role: "TEACHER",
        staffProfile: { create: { fullName: "Ola Outsider", empId: "EMP-RT-9" } },
      },
    })
    await expect(
      decideRetakeRequest(
        { id: outsider.id, email: outsider.email, role: "teacher" },
        f.assessment.id,
        f.student.studentProfile!.id,
        { approve: true, note: null },
      ),
    ).rejects.toMatchObject({ status: 403 })
  })

  it("records 404 when there is no request to decide", async () => {
    const other = await prisma.user.create({
      data: {
        email: "retake-norequest@spine.test",
        passwordHash: "test-only-not-a-real-hash",
        role: "STUDENT",
        studentProfile: { create: { fullName: "No Request", registerNumber: "REG-RT-10" } },
      },
      include: { studentProfile: true },
    })
    await expect(
      decideRetakeRequest(teacher, f.assessment.id, other.studentProfile!.id, {
        approve: true,
        note: null,
      }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it("approves, and records who decided and when", async () => {
    const decided = await decideRetakeRequest(
      teacher,
      f.assessment.id,
      f.student.studentProfile!.id,
      { approve: true, note: "Approved — you were absent." },
    )
    expect(decided.status).toBe("APPROVED")
    // The decider's *name*, so a student asking "who decided" gets an answer.
    expect(decided.decidedBy).toBe("Tara Teacher")
    expect(decided.decidedAt).not.toBeNull()

    const audits = await prisma.auditLog.findMany({
      where: { entityType: "RetakeRequest", action: "retake.approved" },
    })
    expect(audits).toHaveLength(1)
  })

  it("lists the queue for the owning teacher only", async () => {
    const requests = await listRetakeRequestsForTeacher(teacher, f.assessment.id)
    expect(requests).toHaveLength(1)
    expect(requests[0].status).toBe("APPROVED")
  })

  it("returns the student their own request, so a page can say 'awaiting approval'", async () => {
    const mine = await getMyRetakeRequest(student, f.assessment.id)
    expect(mine?.status).toBe("APPROVED")
  })
})

describe("an approval is what lets a student sit", () => {
  it("blocks a retake with no request, then allows it once approved", async () => {
    await setPolicy("APPROVAL")
    await prisma.quizAttempt.deleteMany({ where: { assessmentId: f.assessment.id } })
    await prisma.retakeRequest.deleteMany({ where: { assessmentId: f.assessment.id } })

    // First sitting is unconditional.
    const first = await startQuizAttempt(student, { assessmentId: f.assessment.id })
    const questions = await prisma.question.findMany({ where: { assessmentId: f.assessment.id } })
    await submitQuizAttempt(student, first.id, {
      answers: questions.map((question) => ({ questionId: question.id, selectedIndex: 0 })),
    })

    // Second sitting needs approval, and the request record is what supplies it.
    await expect(
      startQuizAttempt(student, { assessmentId: f.assessment.id }),
    ).rejects.toMatchObject({ status: 403 })

    await requestRetake(student, f.assessment.id)
    // Still blocked while pending — and for a different reason, which a 403 alone would hide.
    await expect(
      startQuizAttempt(student, { assessmentId: f.assessment.id }),
    ).rejects.toMatchObject({ status: 409 })

    await decideRetakeRequest(teacher, f.assessment.id, f.student.studentProfile!.id, {
      approve: true,
      note: null,
    })
    const second = await startQuizAttempt(student, { assessmentId: f.assessment.id })
    expect(second.id).not.toBe(first.id)
  })
})

describe("startPracticeAttempt", () => {
  it("refuses before the deadline, because the start view returns the questions", async () => {
    // The integrity rule: practising before the sitting would hand the student the paper.
    await prisma.quizAttempt.deleteMany({ where: { assessmentId: f.assessment.id } })
    await expect(
      startPracticeAttempt(student, { assessmentId: f.assessment.id }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it("allows practice once a graded attempt is submitted", async () => {
    await setPolicy("FIXED")
    const graded = await startQuizAttempt(student, { assessmentId: f.assessment.id })
    const questions = await prisma.question.findMany({ where: { assessmentId: f.assessment.id } })
    await submitQuizAttempt(student, graded.id, {
      answers: questions.map((question) => ({ questionId: question.id, selectedIndex: 0 })),
    })

    const practice = await startPracticeAttempt(student, { assessmentId: f.assessment.id })
    const row = await prisma.quizAttempt.findUniqueOrThrow({
      where: { id: practice.id },
      select: { kind: true, attemptNumber: true },
    })
    expect(row.kind).toBe("PRACTICE")
    // Practice numbering is its own sequence, so it does not shift the graded numbering.
    expect(row.attemptNumber).toBe(1)
  })

  it("does not consume a graded attempt", async () => {
    await prisma.quizAttempt.updateMany({
      where: { assessmentId: f.assessment.id, kind: "PRACTICE" },
      data: {},
    })
    const before = await prisma.quizAttempt.count({
      where: { assessmentId: f.assessment.id, kind: "GRADED" },
    })

    const practice = await startPracticeAttempt(student, { assessmentId: f.assessment.id })
    const questions = await prisma.question.findMany({ where: { assessmentId: f.assessment.id } })
    await submitQuizAttempt(student, practice.id, {
      answers: questions.map((question) => ({ questionId: question.id, selectedIndex: 0 })),
    })

    const after = await prisma.quizAttempt.count({
      where: { assessmentId: f.assessment.id, kind: "GRADED" },
    })
    expect(after).toBe(before)
  })

  it("never enters the grade pipeline", async () => {
    // The sharpest risk: the auto-scorer keys its bucket per (assessment, student), so a practice
    // submit would supersede the graded draft score rather than add to it.
    const gradedSuggestions = await prisma.aIGradeSuggestion.count({
      where: { assessmentId: f.assessment.id },
    })

    await prisma.quizAttempt.deleteMany({
      where: { assessmentId: f.assessment.id, kind: "PRACTICE", status: "IN_PROGRESS" },
    })
    const practice = await startPracticeAttempt(student, { assessmentId: f.assessment.id })
    const questions = await prisma.question.findMany({ where: { assessmentId: f.assessment.id } })
    await submitQuizAttempt(student, practice.id, {
      answers: questions.map((question) => ({ questionId: question.id, selectedIndex: 0 })),
    })

    // No new suggestion, and the graded one is untouched.
    expect(await prisma.aIGradeSuggestion.count({ where: { assessmentId: f.assessment.id } })).toBe(
      gradedSuggestions,
    )
  })
})

describe("cleanup", () => {
  it("disconnects", async () => {
    await disconnectTestDatabase()
  })
})
