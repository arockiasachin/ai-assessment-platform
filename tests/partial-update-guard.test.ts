import path from "node:path"

import { ESLint } from "eslint"
import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { updateTestCaseForTeacher } from "@/lib/code-eval"
import { updateMilestoneForTeacher, updateGroupForTeacher } from "@/lib/groups"
import { editGeneratedQuestionForTeacher } from "@/lib/quiz-generation"
import type { AuthUser } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * The guard for the partial-update data-loss bug class (bugfix-run-2 and
 * bugfix-run-3). Two layers:
 *
 * 1. A behavioral contract over every service entry point migrated onto
 *    `partialUpdate()`: setting a single field must leave every other column
 *    exactly as it was, and an explicit `null` must clear only its own column.
 * 2. A self-test of the custom ESLint rule `local/no-unguarded-partial-write`
 *    that fails the build when the anti-pattern is reintroduced.
 *
 * `PUT /api/teacher/offerings/[offeringId]` and
 * `PUT /api/teacher/assessments/submissions` are covered by their dedicated
 * route tests (`offering-partial-update.test.ts`,
 * `teacher-submissions-partial-update.test.ts`).
 */

type CaseOutcome = {
  before: Record<string, unknown>
  after: Record<string, unknown>
  /** The one field the request intended to change. */
  changed: string
}

type ContractCase = { name: string; run: () => Promise<CaseOutcome> }

function teacherSession(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "teacher" }
}

async function readGroup(id: string) {
  const group = await prisma.group.findUniqueOrThrow({ where: { id } })
  return { name: group.name, projectTitle: group.projectTitle, status: group.status }
}

async function readMilestone(id: string) {
  const milestone = await prisma.milestone.findUniqueOrThrow({ where: { id } })
  return {
    title: milestone.title,
    description: milestone.description,
    weight: Number(milestone.weight),
    dueDate: milestone.dueDate?.toISOString() ?? null,
    status: milestone.status,
    completedAt: milestone.completedAt?.toISOString() ?? null,
  }
}

async function readTestCase(id: string) {
  const testCase = await prisma.testCase.findUniqueOrThrow({ where: { id } })
  return {
    name: testCase.name,
    description: testCase.description,
    category: testCase.category,
    input: testCase.input,
    expectedOutput: testCase.expectedOutput,
    points: Number(testCase.points),
    isHidden: testCase.isHidden,
  }
}

async function readQuestion(id: string) {
  const question = await prisma.question.findUniqueOrThrow({ where: { id } })
  return {
    prompt: question.prompt,
    explanation: question.explanation,
    subtopic: question.subtopic,
    difficulty: question.difficulty,
    points: Number(question.points),
    status: question.status,
  }
}

const CASES: ContractCase[] = [
  {
    name: "updateGroupForTeacher (present value)",
    async run() {
      const fixture = await createSpineFixture(prisma)
      const user = teacherSession(fixture.teacher)
      const group = await prisma.group.create({
        data: {
          offeringId: fixture.offering.id,
          name: "Original team",
          projectTitle: "Original project",
          status: "FORMING",
        },
      })
      const before = await readGroup(group.id)
      await updateGroupForTeacher(user, group.id, { status: "ACTIVE" })
      return { before, after: await readGroup(group.id), changed: "status" }
    },
  },
  {
    name: "updateGroupForTeacher (explicit null)",
    async run() {
      const fixture = await createSpineFixture(prisma)
      const user = teacherSession(fixture.teacher)
      const group = await prisma.group.create({
        data: {
          offeringId: fixture.offering.id,
          name: "Original team",
          projectTitle: "Original project",
          status: "ACTIVE",
        },
      })
      const before = await readGroup(group.id)
      await updateGroupForTeacher(user, group.id, { projectTitle: null })
      return { before, after: await readGroup(group.id), changed: "projectTitle" }
    },
  },
  {
    name: "updateMilestoneForTeacher (present value)",
    async run() {
      const fixture = await createSpineFixture(prisma)
      const user = teacherSession(fixture.teacher)
      const group = await prisma.group.create({
        data: { offeringId: fixture.offering.id, name: "Milestone team" },
      })
      const milestone = await prisma.milestone.create({
        data: {
          groupId: group.id,
          title: "Original milestone",
          description: "Original description",
          weight: 3,
          dueDate: new Date("2026-11-01T00:00:00.000Z"),
          status: "PLANNED",
        },
      })
      const before = await readMilestone(milestone.id)
      await updateMilestoneForTeacher(user, milestone.id, { title: "Renamed milestone" })
      return { before, after: await readMilestone(milestone.id), changed: "title" }
    },
  },
  {
    name: "updateMilestoneForTeacher (explicit null)",
    async run() {
      const fixture = await createSpineFixture(prisma)
      const user = teacherSession(fixture.teacher)
      const group = await prisma.group.create({
        data: { offeringId: fixture.offering.id, name: "Milestone team" },
      })
      const milestone = await prisma.milestone.create({
        data: {
          groupId: group.id,
          title: "Original milestone",
          description: "Original description",
          weight: 3,
          status: "PLANNED",
        },
      })
      const before = await readMilestone(milestone.id)
      await updateMilestoneForTeacher(user, milestone.id, { description: null })
      return { before, after: await readMilestone(milestone.id), changed: "description" }
    },
  },
  {
    name: "updateTestCaseForTeacher (present value)",
    async run() {
      const fixture = await createSpineFixture(prisma)
      const user = teacherSession(fixture.teacher)
      const assessment = await prisma.assessment.create({
        data: {
          offeringId: fixture.offering.id,
          courseId: fixture.course.id,
          classId: fixture.classroom.id,
          title: "Code task assessment",
          type: "CODE",
          dueDate: new Date("2030-01-01T00:00:00.000Z"),
          maxMarks: 10,
          createdById: fixture.teacher.staffProfile!.id,
        },
      })
      const codeTask = await prisma.codeTask.create({
        data: {
          assessmentId: assessment.id,
          language: "python",
          instructions: "Read and print.",
          starterCode: "print(1)",
          timeLimitMs: 2_000,
          memoryLimitMb: 128,
          metadata: { generator: "code-eval", maxSubmissions: 5, draftTestCaseIds: [] },
        },
      })
      const testCase = await prisma.testCase.create({
        data: {
          codeTaskId: codeTask.id,
          order: 0,
          name: "Original test",
          description: "Original description",
          category: "unit",
          input: "1\n",
          expectedOutput: "1\n",
          points: 2,
          isHidden: false,
        },
      })
      const before = await readTestCase(testCase.id)
      await updateTestCaseForTeacher(user, assessment.id, testCase.id, { points: 7 })
      return { before, after: await readTestCase(testCase.id), changed: "points" }
    },
  },
  {
    name: "updateTestCaseForTeacher (explicit null)",
    async run() {
      const fixture = await createSpineFixture(prisma)
      const user = teacherSession(fixture.teacher)
      const assessment = await prisma.assessment.create({
        data: {
          offeringId: fixture.offering.id,
          courseId: fixture.course.id,
          classId: fixture.classroom.id,
          title: "Code task assessment",
          type: "CODE",
          dueDate: new Date("2030-01-01T00:00:00.000Z"),
          maxMarks: 10,
          createdById: fixture.teacher.staffProfile!.id,
        },
      })
      const codeTask = await prisma.codeTask.create({
        data: {
          assessmentId: assessment.id,
          language: "python",
          instructions: "Read and print.",
          starterCode: "print(1)",
          timeLimitMs: 2_000,
          memoryLimitMb: 128,
          metadata: { generator: "code-eval", maxSubmissions: 5, draftTestCaseIds: [] },
        },
      })
      const testCase = await prisma.testCase.create({
        data: {
          codeTaskId: codeTask.id,
          order: 0,
          name: "Original test",
          description: "Original description",
          category: "unit",
          input: "1\n",
          expectedOutput: "1\n",
          points: 2,
          isHidden: false,
        },
      })
      const before = await readTestCase(testCase.id)
      await updateTestCaseForTeacher(user, assessment.id, testCase.id, { description: null })
      return { before, after: await readTestCase(testCase.id), changed: "description" }
    },
  },
  {
    name: "editGeneratedQuestionForTeacher (present value)",
    async run() {
      const fixture = await createSpineFixture(prisma)
      const user = teacherSession(fixture.teacher)
      const question = await prisma.question.create({
        data: {
          assessmentId: fixture.assessment.id,
          type: "MULTIPLE_CHOICE",
          order: 0,
          prompt: "Original prompt?",
          explanation: "Original explanation.",
          subtopic: "Original subtopic",
          difficulty: 0.4,
          points: 3,
          status: "draft",
        },
      })
      const before = await readQuestion(question.id)
      await editGeneratedQuestionForTeacher(user, question.id, { points: 9 })
      return { before, after: await readQuestion(question.id), changed: "points" }
    },
  },
  {
    name: "editGeneratedQuestionForTeacher (explicit null)",
    async run() {
      const fixture = await createSpineFixture(prisma)
      const user = teacherSession(fixture.teacher)
      const question = await prisma.question.create({
        data: {
          assessmentId: fixture.assessment.id,
          type: "MULTIPLE_CHOICE",
          order: 0,
          prompt: "Original prompt?",
          explanation: "Original explanation.",
          subtopic: "Original subtopic",
          difficulty: 0.4,
          points: 3,
          status: "draft",
        },
      })
      const before = await readQuestion(question.id)
      await editGeneratedQuestionForTeacher(user, question.id, { explanation: null })
      return { before, after: await readQuestion(question.id), changed: "explanation" }
    },
  },
]

describe("partial-update contract", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  for (const testCase of CASES) {
    it(`${testCase.name} writes only the changed field`, async () => {
      const { before, after, changed } = await testCase.run()

      expect(after[changed], `expected "${changed}" to change`).not.toEqual(before[changed])

      const keys = new Set([...Object.keys(before), ...Object.keys(after)])
      for (const key of keys) {
        if (key === changed) continue
        expect({ [key]: after[key] }, `field "${key}" must be untouched`).toEqual({
          [key]: before[key],
        })
      }
    })
  }
})

describe("local/no-unguarded-partial-write guard rule", () => {
  const eslint = new ESLint({
    cwd: process.cwd(),
    overrideConfigFile: path.join(process.cwd(), "eslint.config.mjs"),
  })

  async function lint(source: string) {
    const [result] = await eslint.lintText(source, {
      filePath: path.join(process.cwd(), "lib/__guard_fixture__.ts"),
    })
    return result.messages.filter(
      (message) => message.ruleId === "local/no-unguarded-partial-write",
    )
  }

  it("flags an omitted field collapsed to null in an update payload", async () => {
    const messages = await lint(`
      async function bad(prisma, request) {
        return prisma.model.update({ where: { id: "1" }, data: { startsOn: request.startsOn ?? null } })
      }
    `)
    expect(messages).toHaveLength(1)
  })

  it("flags an omitted field collapsed by an explicit undefined check", async () => {
    const messages = await lint(`
      async function bad(prisma, body) {
        const raw = body.score
        return prisma.model.update({
          where: { id: "1" },
          data: { score: raw === undefined ? null : Number(raw) },
        })
      }
    `)
    expect(messages).toHaveLength(1)
  })

  it("flags a raw request object written straight through", async () => {
    const messages = await lint(`
      async function bad(prisma, body) {
        return prisma.model.update({ where: { id: "1" }, data: body })
      }
    `)
    expect(messages).toHaveLength(1)
  })

  it("does not flag the correct partialUpdate pattern", async () => {
    const messages = await lint(`
      function partialUpdate(request, spec) {
        return spec
      }
      async function good(prisma, request) {
        return prisma.model.update({
          where: { id: "1" },
          data: partialUpdate(request, { name: true }),
        })
      }
    `)
    expect(messages).toHaveLength(0)
  })

  it("does not flag a create payload (no prior value to destroy)", async () => {
    const messages = await lint(`
      async function fine(prisma, request) {
        return prisma.model.create({ data: { name: request.name ?? null } })
      }
    `)
    expect(messages).toHaveLength(0)
  })

  it("does not flag an upsert update payload (create-or-replace semantics)", async () => {
    const messages = await lint(`
      async function upsert(prisma, request) {
        return prisma.model.upsert({
          where: { id: "1" },
          create: { name: "new" },
          update: { name: request.name ?? null },
        })
      }
    `)
    expect(messages).toHaveLength(0)
  })
})
