import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { evaluateFatGateForStudent } from "@/lib/grading/offering-config-service"
import { prisma } from "@/lib/prisma"
import { startPracticeAttempt, startQuizAttempt } from "@/lib/quiz-attempts/service"

import { disconnectTestDatabase, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * The FAT gate, enforced at the attempt start.
 *
 * The rule — a student needs a minimum continuous-assessment score to sit the final assessment — was
 * implemented in `lib/grading/policy.ts` and **reported** on the teacher's offering page, but nothing
 * refused anything, so it applied to nobody. These tests pin the enforcement.
 *
 * They are written around the three narrowings, because each is a way the gate could be wrong in a
 * direction that hurts a student:
 *
 * 1. an unconfigured offering has no gate;
 * 2. only the resolved final assessment is gated;
 * 3. **`insufficient-cat-work` must not refuse** — that would fail a student on unfinished *marking*.
 *
 * ## Three product rules these fixtures have to work with, each found the hard way
 *
 * - **`createSpineFixture` leaves a quiz on the offering** ("Spine Test Quiz", due 2026-10-01), so the
 *   derived FAT is whichever assessment falls due last. Every gate test therefore names the final
 *   assessment **explicitly**, so the fixture's own assessment cannot silently become the FAT and make
 *   the assertion vacuous.
 * - **A continuous-assessment mark only counts once its assessment has fallen due**
 *   (`isMarkIncludedInMean`), so a future-dated assessment contributes nothing to the CAT pool.
 * - **A past-due quiz cannot be attempted** (`lib/quiz-attempts/eligibility.ts`), and **practice opens
 *   only once the deadline has passed** or a graded attempt has been submitted. That is why the FAT's
 *   due date differs per test: the graded-attempt case needs it still open, while the practice and
 *   explicit-choice cases need the *other* assessment past due to be counted.
 */

const CAT_MINIMUM = 30

function policy(finalAssessmentId: string, minimumCatPercent: number | null = CAT_MINIMUM) {
  return { catWeight: 40, fatWeight: 60, finalAssessmentId, minimumCatPercent }
}

const PAST = new Date("2026-09-01T08:00:00.000Z")
const PAST_PUBLISHED = new Date("2026-09-05T00:00:00.000Z")
const FUTURE = new Date("2026-12-01T08:00:00.000Z")

/**
 * A past-due CAT quiz with a published mark, plus a final assessment whose due date the caller chooses.
 *
 * `fatPercent` marks the final assessment too, which the explicit-choice test needs: it is only visible
 * that naming a different FAT *moves* the gate when the two assessments score differently.
 */
async function withCatWork(
  options: {
    catPercent?: number | null
    fatPercent?: number
    publish?: boolean
    fatDue?: Date
  } = {},
) {
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
  const fat = await prisma.assessment.create({
    data: {
      title: "Final quiz",
      type: "QUIZ",
      dueDate: options.fatDue ?? FUTURE,
      maxMarks: 50,
      offeringId: fixture.offering.id,
      courseId: fixture.course.id,
      classId: fixture.classroom.id,
      createdById: staffId,
    },
  })

  await prisma.enrollment.create({ data: { studentId, offeringId: fixture.offering.id } })

  const mark = async (
    assessmentId: string,
    percent: number,
    maxMarks: number,
    publish: boolean,
  ) => {
    await prisma.grade.create({
      data: {
        assessmentId,
        studentId,
        points: (percent / 100) * maxMarks,
        maxPoints: maxMarks,
        source: "TEACHER_OVERRIDE",
        approvedById: staffId,
        publishedAt: publish ? PAST_PUBLISHED : null,
      },
    })
  }

  if (options.catPercent !== null && options.catPercent !== undefined) {
    await mark(cat.id, options.catPercent, 20, options.publish !== false)
  }
  if (options.fatPercent !== undefined) {
    await mark(fat.id, options.fatPercent, 50, true)
  }

  const setPolicy = (config: object) =>
    prisma.courseOffering.update({
      where: { id: fixture.offering.id },
      data: { gradingConfig: config },
    })

  return { fixture, cat, fat, studentId, setPolicy }
}

/** A published, deliverable question so a graded sitting is startable at all. */
async function addQuestion(assessmentId: string, points: number) {
  await prisma.question.create({
    data: {
      assessmentId,
      type: "MULTIPLE_CHOICE",
      order: 0,
      prompt: "Which equation is linear?",
      points,
      status: "published",
      options: {
        create: [
          { order: 0, text: "y = 2x + 1", isCorrect: true },
          { order: 1, text: "y = x^2", isCorrect: false },
        ],
      },
    },
  })
}

describe("evaluateFatGateForStudent", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("allows everything when the offering has no stored policy", async () => {
    // No policy means no CAT/FAT split and therefore no gate — the same rule the export follows.
    const { fixture, fat, studentId } = await withCatWork({ catPercent: 0 })

    const decision = await evaluateFatGateForStudent({
      offeringId: fixture.offering.id,
      assessmentId: fat.id,
      studentId,
    })

    expect(decision.allowed).toBe(true)
  })

  it("refuses a student below the minimum on the final assessment", async () => {
    const { fixture, fat, studentId, setPolicy } = await withCatWork({ catPercent: 10 })
    await setPolicy(policy(fat.id))

    const decision = await evaluateFatGateForStudent({
      offeringId: fixture.offering.id,
      assessmentId: fat.id,
      studentId,
    })

    expect(decision.allowed).toBe(false)
    expect(decision.allowed === false && decision.reason).toBe("below-cat-minimum")
    // The message names the figures, so a student is never told "no" without a reason.
    expect(decision.allowed === false && decision.message).toContain("10%")
    expect(decision.allowed === false && decision.message).toContain("30%")
  })

  it("allows a student above the minimum", async () => {
    const { fixture, fat, studentId, setPolicy } = await withCatWork({ catPercent: 80 })
    await setPolicy(policy(fat.id))

    const decision = await evaluateFatGateForStudent({
      offeringId: fixture.offering.id,
      assessmentId: fat.id,
      studentId,
    })

    expect(decision.allowed).toBe(true)
  })

  it("does not refuse on insufficient marking — the student is not the problem", async () => {
    // The CAT mark is withheld, so nothing in the pool counts. Refusing here would fail a student for
    // the teacher's unfinished marking, which is the same class of error as zero-filling a mean.
    const { fixture, fat, studentId, setPolicy } = await withCatWork({
      catPercent: 5,
      publish: false,
    })
    await setPolicy(policy(fat.id))

    const decision = await evaluateFatGateForStudent({
      offeringId: fixture.offering.id,
      assessmentId: fat.id,
      studentId,
    })

    expect(decision.allowed).toBe(true)
  })

  it("gates only the resolved final assessment", async () => {
    // The CAT quiz must stay attemptable for a student who is gated out of the final one.
    const { fixture, cat, studentId, setPolicy } = await withCatWork({ catPercent: 5 })
    await setPolicy(policy(cat.id))

    const decision = await evaluateFatGateForStudent({
      offeringId: fixture.offering.id,
      assessmentId: cat.id,
      studentId,
    })

    expect(decision.allowed).toBe(true)
  })

  it("honours a teacher's explicit choice of final assessment", async () => {
    // A strong CAT and a weak pass at the other assessment, so *which* one is continuous decides the
    // verdict. Both are past due, so both can enter the pool — see `fatDue`.
    const { fixture, cat, fat, studentId, setPolicy } = await withCatWork({
      catPercent: 80,
      fatPercent: 5,
      fatDue: new Date("2026-09-10T08:00:00.000Z"),
    })

    // `cat` is named the FAT, so `fat` (5%) is the continuous pool and the gate refuses.
    await setPolicy(policy(cat.id))
    const onCat = await evaluateFatGateForStudent({
      offeringId: fixture.offering.id,
      assessmentId: cat.id,
      studentId,
    })

    // Named the other way, `cat` (80%) is continuous and the same student is allowed.
    await setPolicy(policy(fat.id))
    const onFat = await evaluateFatGateForStudent({
      offeringId: fixture.offering.id,
      assessmentId: fat.id,
      studentId,
    })

    expect(onCat.allowed).toBe(false)
    expect(onFat.allowed).toBe(true)
  })

  it("allows when the gate is disabled, and is not confused by a gate at zero", async () => {
    const { fixture, fat, studentId, setPolicy } = await withCatWork({ catPercent: 0 })

    await setPolicy(policy(fat.id, null))
    const disabled = await evaluateFatGateForStudent({
      offeringId: fixture.offering.id,
      assessmentId: fat.id,
      studentId,
    })
    expect(disabled.allowed).toBe(true)

    // A gate at zero refuses nobody, because nobody scores below zero.
    await setPolicy(policy(fat.id, 0))
    const atZero = await evaluateFatGateForStudent({
      offeringId: fixture.offering.id,
      assessmentId: fat.id,
      studentId,
    })
    expect(atZero.allowed).toBe(true)
  })

  it("allows when the policy is unusable, rather than guessing a gate", async () => {
    // A corrupt column must not be able to refuse a student an exam.
    const { fixture, fat, studentId, setPolicy } = await withCatWork({ catPercent: 1 })
    await setPolicy({ catWeight: "nope" })

    const decision = await evaluateFatGateForStudent({
      offeringId: fixture.offering.id,
      assessmentId: fat.id,
      studentId,
    })

    expect(decision.allowed).toBe(true)
  })
})

describe("startQuizAttempt enforces the gate", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("refuses a new graded sitting for a student below the minimum CAT", async () => {
    // The FAT is left open (future-dated) so the refusal can only come from the gate — a past-due
    // quiz is refused by the deadline rule instead, which would make this test pass for the wrong
    // reason.
    const { fixture, fat, studentId, setPolicy } = await withCatWork({ catPercent: 5 })
    await setPolicy(policy(fat.id))
    await addQuestion(fat.id, 50)

    await expect(
      startQuizAttempt(
        { id: fixture.student.id, email: fixture.student.email, role: "student" },
        { assessmentId: fat.id },
      ),
    ).rejects.toMatchObject({ status: 403 })

    // Nothing was created, so the refusal is a refusal rather than a failed-then-logged attempt.
    expect(await prisma.quizAttempt.count({ where: { assessmentId: fat.id, studentId } })).toBe(0)
  })

  it("allows the same student to start a practice sitting", async () => {
    // Practice is the escape valve the gate must not close: a student below the minimum can still
    // prepare. `startPracticeAttempt` is a separate function that never consults the policy, which is
    // what this pins — the gate says "not allowed" for the very same assessment.
    const { fixture, cat, studentId, setPolicy } = await withCatWork({
      catPercent: 5,
      // Naming `cat` the FAT makes `fat` the continuous pool, so `fat` is the mark the gate judges.
      fatPercent: 5,
      fatDue: PAST,
    })
    await setPolicy(policy(cat.id))
    await addQuestion(cat.id, 20)

    const gated = await evaluateFatGateForStudent({
      offeringId: fixture.offering.id,
      assessmentId: cat.id,
      studentId,
    })
    expect(gated.allowed).toBe(false)

    const attempt = await startPracticeAttempt(
      { id: fixture.student.id, email: fixture.student.email, role: "student" },
      { assessmentId: cat.id },
    )

    expect(attempt.assessmentId).toBe(cat.id)
    expect(attempt.status).toBe("IN_PROGRESS")
  })
})
