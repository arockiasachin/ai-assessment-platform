import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Phase 3 — the quiz-import normaliser and its layman errors.
 *
 * The historical rich shape is pinned by `tests/legacy-quiz-retirement.test.ts`;
 * this file pins what the widened contract adds:
 *
 *  - the minimal template shape (`courseCode`/`title`/`question`/`answer`) and
 *    both of its accepted answer forms;
 *  - `courseCode` resolution against the teacher's own offerings, refusing on
 *    ambiguity instead of guessing (the wrong-class hazard the offering id was
 *    added to prevent);
 *  - `offeringId` winning over `courseCode` whenever both are present;
 *  - the optional append (`assessmentId`) versus the default of a new quiz;
 *  - the path→label error mapper, including the empty-`questionText` case that
 *    used to leak zod's default text.
 */
const mocks = vi.hoisted(() => ({
  getCookies: vi.fn(),
}))

vi.mock("next/headers", () => ({
  cookies: () => mocks.getCookies(),
}))

vi.mock("@/lib/authz-actor", () => ({
  revalidateSessionActor: (user: unknown) => Promise.resolve(user),
}))

import { POST as importQuizPost } from "@/app/api/teacher/quiz/route"
import { firstIssueMessage, quizImportRequestSchema } from "@/lib/contracts"
import { createQuizFromImportForSessionUser } from "@/lib/gradebook-db"
import { mapQuizImportIssues, QuizImportError } from "@/lib/quiz-import-errors"
import { signSessionValue, type AuthUser } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

function teacherSession(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "teacher" }
}

function useSession(user: { id: string; email: string; role: "teacher" | "student" | "admin" }) {
  mocks.getCookies.mockReturnValue({
    get: (name: string) => ({ name, value: signSessionValue(user) }),
  })
}

function importRequest(body: unknown) {
  return new Request("https://app.test/api/teacher/quiz", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function readTemplate() {
  return JSON.parse(readFileSync(resolve(process.cwd(), "public/quiz-template.json"), "utf8")) as {
    courseCode: string
    title: string
    questions: { question: string; options: string[]; answer: string | number }[]
  }
}

/** A second offering of the same course for the same teacher, to force ambiguity. */
async function addSecondOffering(courseId: string, teacherId: string) {
  const classroom = await prisma.classRoom.create({
    data: { code: "CLASS-SPINE-SECOND", name: "Spine Test Class B", academicYear: 2026 },
  })
  return prisma.courseOffering.create({
    data: {
      courseId,
      classId: classroom.id,
      teacherId,
      term: "Term-Test",
      academicYear: 2026,
    },
  })
}

describe("quiz import — Phase 3", () => {
  beforeEach(async () => {
    await truncateAll()
    mocks.getCookies.mockReset()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  describe("minimal shape and normaliser", () => {
    it("imports the minimal shape by courseCode when it names exactly one owned offering", async () => {
      const fixture = await createSpineFixture(prisma)

      const created = await createQuizFromImportForSessionUser(
        {
          courseCode: fixture.course.code,
          title: "Minimal import",
          questions: [
            {
              question: "What is the BFS visit order from vertex 0?",
              options: ["[0,1,2,3]", "[0,2,1,3]"],
              answer: "A",
            },
            {
              question: "Which data structure does BFS use?",
              options: ["Stack", "Queue", "Priority queue"],
              // Resolved by exact option text, not by position.
              answer: "Queue",
            },
          ],
        },
        teacherSession(fixture.teacher),
      )

      expect(created.offeringId).toBe(fixture.offering.id)
      expect(created.title).toBe("Minimal import")
      expect(created.appended).toBe(false)
      expect(created.questionCount).toBe(2)
      // No totalMarks supplied: the ceiling is the sum of the questions' marks.
      expect(created.maxMarks).toBe(2)

      const questions = await prisma.question.findMany({
        where: { assessmentId: created.id },
        include: { options: { orderBy: { order: "asc" } } },
        orderBy: { order: "asc" },
      })
      expect(questions).toHaveLength(2)
      expect(questions.every((question) => question.status === "published")).toBe(true)
      expect(questions[0].prompt).toBe("What is the BFS visit order from vertex 0?")
      expect(questions[0].options.map((option) => option.text)).toEqual(["[0,1,2,3]", "[0,2,1,3]"])
      expect(questions[0].options.find((option) => option.isCorrect)?.text).toBe("[0,1,2,3]")
      expect(questions[1].options.find((option) => option.isCorrect)?.text).toBe("Queue")
    })

    it("accepts a 1-based numeric answer and still lets correctIndex win over answer", async () => {
      const fixture = await createSpineFixture(prisma)

      const created = await createQuizFromImportForSessionUser(
        {
          courseCode: fixture.course.code,
          title: "Answer forms",
          questions: [
            { question: "Pick the second", options: ["one", "two", "three"], answer: 2 },
            // Both keys present: the rich `correctIndex` must win over `answer`.
            { question: "Precedence", options: ["yes", "no"], correctIndex: 0, answer: "B" },
          ],
        },
        teacherSession(fixture.teacher),
      )

      const questions = await prisma.question.findMany({
        where: { assessmentId: created.id },
        include: { options: { orderBy: { order: "asc" } } },
        orderBy: { order: "asc" },
      })
      expect(questions[0].options.find((option) => option.isCorrect)?.text).toBe("two")
      expect(questions[1].options.find((option) => option.isCorrect)?.text).toBe("yes")
    })

    it("refuses an ambiguous courseCode and names the candidate offerings", async () => {
      const fixture = await createSpineFixture(prisma)
      const secondOffering = await addSecondOffering(
        fixture.course.id,
        fixture.teacher.staffProfile!.id,
      )

      const attempt = createQuizFromImportForSessionUser(
        {
          courseCode: fixture.course.code,
          title: "Ambiguous import",
          questions: [{ question: "Q", options: ["a", "b"], answer: "A" }],
        },
        teacherSession(fixture.teacher),
      )

      await expect(attempt).rejects.toThrow(QuizImportError)
      await expect(attempt).rejects.toThrow(/matches 2 of your offerings/)
      await expect(attempt).rejects.toThrow(/Spine Test Class/)
      await expect(attempt).rejects.toThrow(new RegExp(secondOffering.id))
      await expect(attempt).rejects.toThrow(/Add "offeringId" to the JSON to choose one\./)

      // Only the fixture's own Assessment spine row exists; nothing was imported.
      expect(
        await prisma.assessment.count({
          where: { offeringId: { in: [fixture.offering.id, secondOffering.id] } },
        }),
      ).toBe(1)
    })

    it("refuses a courseCode that matches none of the teacher's offerings", async () => {
      const fixture = await createSpineFixture(prisma)

      await expect(
        createQuizFromImportForSessionUser(
          {
            courseCode: "NO-SUCH-COURSE",
            title: "Nowhere",
            questions: [{ question: "Q", options: ["a", "b"], answer: "A" }],
          },
          teacherSession(fixture.teacher),
        ),
      ).rejects.toThrow('No offering you teach matches the course code "NO-SUCH-COURSE".')
    })

    it("lets an explicit offeringId override an ambiguous courseCode", async () => {
      const fixture = await createSpineFixture(prisma)
      await addSecondOffering(fixture.course.id, fixture.teacher.staffProfile!.id)

      const created = await createQuizFromImportForSessionUser(
        {
          offeringId: fixture.offering.id,
          courseCode: fixture.course.code,
          title: "Disambiguated",
          questions: [{ question: "Q", options: ["a", "b"], answer: "A" }],
        },
        teacherSession(fixture.teacher),
      )

      expect(created.offeringId).toBe(fixture.offering.id)
    })

    it("appends to an owned quiz when assessmentId is given, and creates a new one otherwise", async () => {
      const fixture = await createSpineFixture(prisma)

      const base = await createQuizFromImportForSessionUser(
        {
          offeringId: fixture.offering.id,
          quizMetadata: { title: "Base quiz", totalMarks: 2 },
          questions: [
            { questionText: "Base 1", options: [{ text: "a" }, { text: "b" }], correctIndex: 0 },
            { questionText: "Base 2", options: [{ text: "a" }, { text: "b" }], correctIndex: 1 },
          ],
        },
        teacherSession(fixture.teacher),
      )
      expect(base.appended).toBe(false)

      const appended = await createQuizFromImportForSessionUser(
        {
          assessmentId: base.id,
          title: "Ignored title",
          questions: [{ question: "Extra", options: ["a", "b"], answer: "B" }],
        },
        teacherSession(fixture.teacher),
      )

      expect(appended.appended).toBe(true)
      expect(appended.id).toBe(base.id)
      expect(appended.title).toBe("Base quiz")
      expect(appended.questionCount).toBe(1)
      expect(appended.maxMarks).toBe(3)

      // The fixture's own assessment plus the imported base — the append adds none.
      expect(await prisma.assessment.count({ where: { offeringId: fixture.offering.id } })).toBe(2)
      expect(await prisma.calendarEvent.count({ where: { assessmentId: base.id } })).toBe(1)
      const questions = await prisma.question.findMany({
        where: { assessmentId: base.id },
        include: { options: { orderBy: { order: "asc" } } },
        orderBy: { order: "asc" },
      })
      expect(questions.map((question) => question.order)).toEqual([0, 1, 2])
      expect(questions[2].prompt).toBe("Extra")
      expect(questions[2].options.find((option) => option.isCorrect)?.text).toBe("b")
    })

    it("refuses to append to an assessment the teacher does not own", async () => {
      const fixture = await createSpineFixture(prisma)

      await expect(
        createQuizFromImportForSessionUser(
          {
            assessmentId: "does-not-exist",
            questions: [{ question: "Q", options: ["a", "b"], answer: "A" }],
          },
          teacherSession(fixture.teacher),
        ),
      ).rejects.toThrow("Assessment not found or not owned by you.")

      const assignment = await prisma.assessment.create({
        data: {
          offeringId: fixture.offering.id,
          courseId: fixture.course.id,
          classId: fixture.classroom.id,
          title: "Not a quiz",
          type: "ASSIGNMENT",
          dueDate: new Date("2026-11-01T00:00:00.000Z"),
          maxMarks: 10,
          createdById: fixture.teacher.staffProfile!.id,
        },
      })

      await expect(
        createQuizFromImportForSessionUser(
          {
            assessmentId: assignment.id,
            questions: [{ question: "Q", options: ["a", "b"], answer: "A" }],
          },
          teacherSession(fixture.teacher),
        ),
      ).rejects.toThrow('"Not a quiz" is not a quiz, so questions cannot be added to it.')
    })

    it("phrases a missing answer for a human", async () => {
      const fixture = await createSpineFixture(prisma)

      await expect(
        createQuizFromImportForSessionUser(
          {
            offeringId: fixture.offering.id,
            quizMetadata: { title: "No answer" },
            questions: [{ questionText: "Q", options: [{ text: "a" }, { text: "b" }] }],
          },
          teacherSession(fixture.teacher),
        ),
      ).rejects.toThrow(
        'Question 1: give the correct answer with "answer", "correctIndex", or "correctAnswerId".',
      )
    })
  })

  describe("layman errors", () => {
    it("turns an empty questionText into a sentence instead of zod's default", () => {
      const parsed = quizImportRequestSchema.safeParse({
        offeringId: "offering-1",
        quizMetadata: { title: "T" },
        questions: [{ questionText: "", options: [{ text: "a" }, { text: "b" }], correctIndex: 0 }],
      })
      expect(parsed.success).toBe(false)
      if (parsed.success) return

      // Before: the shared helper returns zod's raw default for `nonEmptyString`.
      expect(firstIssueMessage(parsed.error)).toContain("Too small")
      // After: the import mapper phrases it for a teacher.
      expect(mapQuizImportIssues(parsed.error)).toEqual([
        "Question 1: the question text is required.",
      ])
    })

    it("returns every problem, not just the first", () => {
      const parsed = quizImportRequestSchema.safeParse({
        offeringId: "offering-1",
        quizMetadata: { title: "T" },
        questions: [
          { questionText: "", options: [{ text: "a" }, { text: "b" }], correctIndex: 0 },
          { questionText: "Second", options: [{ text: "a" }], correctIndex: 0 },
        ],
      })
      expect(parsed.success).toBe(false)
      if (parsed.success) return

      expect(mapQuizImportIssues(parsed.error)).toEqual([
        "Question 1: the question text is required.",
        "Question 2: at least two options are required.",
      ])
    })
  })

  describe("route and template", () => {
    it("returns the layman list as `errors` for an unmatched letter answer", async () => {
      const fixture = await createSpineFixture(prisma)
      useSession({ id: fixture.teacher.id, email: fixture.teacher.email, role: "teacher" })

      const response = await importQuizPost(
        importRequest({
          offeringId: fixture.offering.id,
          quizMetadata: { title: "Bad answer" },
          questions: [
            {
              questionText: "Pick one",
              options: [{ text: "a" }, { text: "b" }, { text: "c" }, { text: "d" }],
              answer: "E",
            },
          ],
        }),
      )

      expect(response.status).toBe(400)
      const body = (await response.json()) as {
        success: boolean
        message: string
        errors: string[]
      }
      expect(body.success).toBe(false)
      expect(body.errors).toEqual([
        "Question 1: the answer letter E does not match any of its 4 options (A–D).",
      ])
      expect(body.message).toBe(body.errors[0])
      expect(await prisma.assessment.count({ where: { offeringId: fixture.offering.id } })).toBe(1)
    })

    it("returns the layman error list for an empty questionText", async () => {
      const fixture = await createSpineFixture(prisma)
      useSession({ id: fixture.teacher.id, email: fixture.teacher.email, role: "teacher" })

      const response = await importQuizPost(
        importRequest({
          offeringId: fixture.offering.id,
          quizMetadata: { title: "Empty prompt" },
          questions: [
            { questionText: "", options: [{ text: "a" }, { text: "b" }], correctIndex: 0 },
          ],
        }),
      )

      expect(response.status).toBe(400)
      const body = (await response.json()) as { errors: string[] }
      expect(body.errors).toEqual(["Question 1: the question text is required."])
    })

    it("creates a quiz from the downloadable template", async () => {
      const fixture = await createSpineFixture(prisma)
      const template = readTemplate()

      // The shipped template must satisfy the contract it documents.
      expect(quizImportRequestSchema.safeParse(template).success).toBe(true)

      useSession({ id: fixture.teacher.id, email: fixture.teacher.email, role: "teacher" })
      const response = await importQuizPost(
        importRequest({ ...template, offeringId: fixture.offering.id }),
      )
      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        success: boolean
        assessment: { questionCount: number; appended: boolean }
      }
      expect(body.success).toBe(true)
      expect(body.assessment.questionCount).toBe(template.questions.length)
      expect(body.assessment.appended).toBe(false)
    })
  })
})
