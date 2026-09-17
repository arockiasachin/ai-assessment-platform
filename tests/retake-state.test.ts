import { beforeAll, describe, expect, it } from "vitest"

import { getRetakeStateForStudent, retakeStateFrom } from "@/lib/quiz-attempts/retake-state"
import { decideRetake, resolveSittingCap } from "@/lib/quiz-attempts/retake-policy"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * The read-only retake state.
 *
 * This is the page's view of the rules `startQuizAttempt` enforces, so the assertion that matters
 * most is the last one: **the state and the gate agree**. If they ever diverge, a page offers a
 * button that fails, or hides one that would have worked.
 */

let f: Awaited<ReturnType<typeof createSpineFixture>>
let studentId: string

const DAY = 24 * 60 * 60 * 1000

beforeAll(async () => {
  await truncateAll()
  f = await createSpineFixture(prisma)
  studentId = f.student.studentProfile!.id
})

async function reset(options: {
  policy?: "NONE" | "FIXED" | "APPROVAL"
  maxAttempts?: number
  retakesAllowed?: number | null
  dueInDays?: number
}): Promise<void> {
  await prisma.retakeRequest.deleteMany({ where: { assessmentId: f.assessment.id } })
  await prisma.quizAttempt.deleteMany({ where: { assessmentId: f.assessment.id } })
  await prisma.assessment.update({
    where: { id: f.assessment.id },
    data: {
      retakePolicy: options.policy ?? "FIXED",
      maxAttempts: options.maxAttempts ?? 3,
      retakesAllowed: options.retakesAllowed ?? null,
      dueDate: new Date(Date.now() + (options.dueInDays ?? 7) * DAY),
    },
  })
}

async function addGraded(status: "IN_PROGRESS" | "SUBMITTED"): Promise<void> {
  const count = await prisma.quizAttempt.count({
    where: { assessmentId: f.assessment.id, studentId, kind: "GRADED" },
  })
  await prisma.quizAttempt.create({
    data: {
      assessmentId: f.assessment.id,
      studentId,
      attemptNumber: count + 1,
      status,
      kind: "GRADED",
    },
  })
}

describe("getRetakeStateForStudent", () => {
  it("returns null for an assessment that does not exist", async () => {
    expect(await getRetakeStateForStudent(studentId, "nope")).toBeNull()
  })

  it("reports the first sitting as available with nothing used", async () => {
    await reset({})
    const state = await getRetakeStateForStudent(studentId, f.assessment.id)
    expect(state).toMatchObject({
      gradedAttemptsUsed: 0,
      canRetake: true,
      blockedReason: null,
      requestStatus: null,
    })
  })

  it("withholds practice before the deadline with no graded attempt", async () => {
    // The integrity rule: the start view returns the questions, so practising early is a leak.
    await reset({ dueInDays: 7 })
    const state = await getRetakeStateForStudent(studentId, f.assessment.id)
    expect(state?.canPractise).toBe(false)
  })

  it("opens practice once a graded attempt is submitted", async () => {
    await reset({ dueInDays: 7 })
    await addGraded("SUBMITTED")
    const state = await getRetakeStateForStudent(studentId, f.assessment.id)
    expect(state?.canPractise).toBe(true)
  })

  it("opens practice once the deadline has passed, without a graded attempt", async () => {
    await reset({ dueInDays: -1 })
    const state = await getRetakeStateForStudent(studentId, f.assessment.id)
    expect(state?.canPractise).toBe(true)
  })

  it("counts an IN_PROGRESS graded sitting against the cap, matching the gate", async () => {
    // `isCounted` includes IN_PROGRESS, so the state must too — otherwise the page would offer a
    // sitting the gate refuses.
    await reset({ maxAttempts: 1 })
    await addGraded("IN_PROGRESS")
    const state = await getRetakeStateForStudent(studentId, f.assessment.id)
    expect(state?.gradedAttemptsUsed).toBe(1)
    expect(state?.canRetake).toBe(false)
    expect(state?.blockedReason).toContain("Attempt limit")
  })

  it("converts retakesAllowed into a sitting count", async () => {
    await reset({ retakesAllowed: 1 })
    await addGraded("SUBMITTED")
    // One retake means two sittings, so one used still leaves one available.
    const state = await getRetakeStateForStudent(studentId, f.assessment.id)
    expect(state?.sittingCap).toBe(2)
    expect(state?.canRetake).toBe(true)

    await addGraded("SUBMITTED")
    const capped = await getRetakeStateForStudent(studentId, f.assessment.id)
    expect(capped?.canRetake).toBe(false)
  })

  it("blocks NONE after the first sitting whatever maxAttempts says", async () => {
    await reset({ policy: "NONE", maxAttempts: 9 })
    await addGraded("SUBMITTED")
    const state = await getRetakeStateForStudent(studentId, f.assessment.id)
    expect(state?.sittingCap).toBe(1)
    expect(state?.canRetake).toBe(false)
    expect(state?.blockedReason).toBe("This assessment allows one graded sitting.")
  })

  it("reports APPROVAL as needing a request, then awaiting, then granted", async () => {
    await reset({ policy: "APPROVAL" })
    await addGraded("SUBMITTED")

    const noRequest = await getRetakeStateForStudent(studentId, f.assessment.id)
    expect(noRequest).toMatchObject({ canRetake: false, requestStatus: null })

    await prisma.retakeRequest.create({
      data: { assessmentId: f.assessment.id, studentId, status: "PENDING" },
    })
    const pending = await getRetakeStateForStudent(studentId, f.assessment.id)
    expect(pending).toMatchObject({ canRetake: false, requestStatus: "PENDING" })

    await prisma.retakeRequest.update({
      where: { assessmentId_studentId: { assessmentId: f.assessment.id, studentId } },
      data: { status: "APPROVED" },
    })
    const approved = await getRetakeStateForStudent(studentId, f.assessment.id)
    expect(approved).toMatchObject({ canRetake: true, requestStatus: "APPROVED" })
  })

  it("agrees with the pure policy on every combination it reports", async () => {
    // The property that makes the page trustworthy: what it offers is what the gate allows.
    const cases: { policy: "NONE" | "FIXED" | "APPROVAL"; used: number; approved: boolean }[] = [
      { policy: "NONE", used: 0, approved: false },
      { policy: "NONE", used: 1, approved: false },
      { policy: "FIXED", used: 0, approved: false },
      { policy: "FIXED", used: 1, approved: false },
      { policy: "APPROVAL", used: 1, approved: true },
      { policy: "APPROVAL", used: 1, approved: false },
    ]

    for (const scenario of cases) {
      const decision = decideRetake({
        policy: scenario.policy,
        gradedAttemptsUsed: scenario.used,
        hasApprovedRequest: scenario.approved,
        hasPendingRequest: false,
      })
      const cap = resolveSittingCap({
        policy: scenario.policy,
        maxAttempts: 3,
        retakesAllowed: null,
      })
      const canRetake = decision.allowed && scenario.used < cap

      await reset({ policy: scenario.policy, maxAttempts: 3 })
      for (let index = 0; index < scenario.used; index += 1) await addGraded("SUBMITTED")
      if (scenario.approved) {
        await prisma.retakeRequest.create({
          data: { assessmentId: f.assessment.id, studentId, status: "APPROVED" },
        })
      }

      const state = await getRetakeStateForStudent(studentId, f.assessment.id)
      expect(state?.canRetake, JSON.stringify(scenario)).toBe(canRetake)
    }
  })
})

describe("retakeStateFrom", () => {
  const now = new Date("2026-06-01T00:00:00.000Z")
  const dueDate = new Date("2026-12-01T00:00:00.000Z")
  const graded = (statuses: ("IN_PROGRESS" | "SUBMITTED")[]) =>
    statuses.map((status) => ({ status, kind: "GRADED" as const }))

  it("makes an APPROVAL retake unstartable without a request (SN-36)", () => {
    // The quizzes list used `evaluateAttemptEligibility` alone, so it offered "Start attempt" for
    // a sitting the start route refuses until a teacher approves.
    const state = retakeStateFrom({
      policy: "APPROVAL",
      maxAttempts: 3,
      retakesAllowed: null,
      dueDate,
      now,
      attempts: graded(["SUBMITTED"]),
      requestStatus: null,
    })

    expect(state.canRetake).toBe(false)
    expect(state.blockedReason).toMatch(/approved request/)
  })

  it("grants it once the request is approved", () => {
    const state = retakeStateFrom({
      policy: "APPROVAL",
      maxAttempts: 3,
      retakesAllowed: null,
      dueDate,
      now,
      attempts: graded(["SUBMITTED"]),
      requestStatus: "APPROVED",
    })

    expect(state.canRetake).toBe(true)
    expect(state.blockedReason).toBeNull()
  })

  it("never counts a practice sitting against the cap", () => {
    const state = retakeStateFrom({
      policy: "FIXED",
      maxAttempts: 1,
      retakesAllowed: null,
      dueDate,
      now,
      attempts: [{ status: "SUBMITTED", kind: "PRACTICE" }],
      requestStatus: null,
    })

    expect(state.gradedAttemptsUsed).toBe(0)
    expect(state.canRetake).toBe(true)
  })
})

describe("cleanup", () => {
  it("disconnects", async () => {
    await disconnectTestDatabase()
  })
})
