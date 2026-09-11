import { randomUUID } from "node:crypto"

import {
  createTestCaseRequestSchema,
  generateTestCasesRequestSchema,
  publishTestCasesRequestSchema,
  updateTestCaseRequestSchema,
  upsertCodeTaskRequestSchema,
  type CodeTaskResponse,
  type CodeTaskSummary,
  type PublishTestCasesResponse,
  type TestCaseResponse,
} from "@/lib/contracts/code-eval"
import { writeAuditLog } from "@/lib/grading/audit"
import { getLlmProvider, type LlmGenerateResult, type LlmProvider } from "@/lib/llm"
import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

import { loadOwnedAssessment, loadOwnedCodeTask, resolveTeacherStaffId } from "./authz"
import { CodeEvalError } from "./errors"
import {
  CODE_EVAL_GENERATOR,
  readCodeEvalMetadata,
  resolveDraftTestCaseIds,
  resolveMaxSubmissions,
  toCodeTaskMetadata,
  type CodeEvalMetadata,
} from "./metadata"
import { parseGeneratedTestCases } from "./parsing"
import { CODE_EVAL_PROMPT_VERSION, buildCodeEvalPrompt } from "./prompt"
import { serializeCodeTask, serializeTestCase } from "./serialize"

/**
 * Teacher-scoped lifecycle for code tasks and their test cases.
 *
 * Every entry point re-checks object-level ownership (`loadOwnedAssessment` /
 * `loadOwnedCodeTask`) before reading or writing. Draft-vs-active state for
 * generated test cases lives in `CodeTask.metadata` because the schema is
 * frozen (the quiz-generation pod's pattern). Nothing here executes student
 * code or publishes a grade.
 */

const testCaseOrder = { order: "asc" as const }

function buildMetadata(previous: unknown, maxSubmissions: number): CodeEvalMetadata {
  const existing = readCodeEvalMetadata(previous)
  return {
    generator: CODE_EVAL_GENERATOR,
    maxSubmissions: Math.max(1, Math.floor(maxSubmissions)),
    draftTestCaseIds: existing?.draftTestCaseIds ?? [],
    ...(existing?.generation ? { generation: existing.generation } : {}),
  }
}

async function nextTestCaseOrder(codeTaskId: string): Promise<number> {
  const aggregate = await prisma.testCase.aggregate({
    where: { codeTaskId },
    _max: { order: true },
  })
  return (aggregate._max.order ?? -1) + 1
}

async function loadOwnedTestCase(user: AuthUser, assessmentId: string, testCaseId: string) {
  const { owned, codeTask } = await loadOwnedCodeTask(user, assessmentId)
  const testCase = await prisma.testCase.findUnique({ where: { id: testCaseId } })
  if (!testCase || testCase.codeTaskId !== codeTask.id) {
    throw new CodeEvalError(404, "Test case not found.")
  }
  return { owned, codeTask, testCase }
}

/** The teacher's own CODE assessments, with code-task and run counts. */
export async function listTeacherCodeTasks(user: AuthUser): Promise<CodeTaskSummary[]> {
  const staffId = await resolveTeacherStaffId(user)
  const assessments = await prisma.assessment.findMany({
    where: {
      type: "CODE",
      OR: [{ createdById: staffId }, { offering: { teacherId: staffId } }],
    },
    select: {
      id: true,
      title: true,
      type: true,
      dueDate: true,
      maxMarks: true,
      offering: {
        select: {
          course: { select: { code: true, name: true } },
          classRoom: { select: { name: true, section: true } },
        },
      },
      codeTask: {
        select: {
          id: true,
          language: true,
          metadata: true,
          testCases: { select: { id: true } },
          _count: { select: { testRuns: true } },
        },
      },
    },
    orderBy: { dueDate: "desc" },
    take: 200,
  })

  return assessments.map((assessment) => {
    const draftIds = resolveDraftTestCaseIds(assessment.codeTask?.metadata)
    const section = assessment.offering.classRoom.section
    return {
      assessmentId: assessment.id,
      assessmentTitle: assessment.title,
      assessmentType: assessment.type,
      dueDate: assessment.dueDate.toISOString(),
      maxMarks: assessment.maxMarks,
      courseCode: assessment.offering.course.code,
      courseName: assessment.offering.course.name,
      className: `${assessment.offering.classRoom.name}${section ? ` ${section}` : ""}`,
      hasCodeTask: assessment.codeTask !== null,
      language: assessment.codeTask
        ? (assessment.codeTask.language as CodeTaskSummary["language"])
        : null,
      testCaseCount: assessment.codeTask?.testCases.length ?? 0,
      draftTestCaseCount: assessment.codeTask
        ? assessment.codeTask.testCases.filter((testCase) => draftIds.has(testCase.id)).length
        : 0,
      submissionCount: assessment.codeTask?._count.testRuns ?? 0,
      maxSubmissions: resolveMaxSubmissions(assessment.codeTask?.metadata),
    }
  })
}

/** One owned code task with its test cases (drafts flagged). */
export async function getCodeTaskForTeacher(
  user: AuthUser,
  assessmentId: string,
): Promise<{ task: CodeTaskResponse; testCases: TestCaseResponse[] }> {
  const { owned, codeTask } = await loadOwnedCodeTask(user, assessmentId)
  const testCases = await prisma.testCase.findMany({
    where: { codeTaskId: codeTask.id },
    orderBy: testCaseOrder,
  })
  const draftIds = resolveDraftTestCaseIds(codeTask.metadata)
  return {
    task: serializeCodeTask({
      id: codeTask.id,
      assessmentId: owned.id,
      assessmentTitle: owned.title,
      language: codeTask.language,
      instructions: codeTask.instructions,
      starterCode: codeTask.starterCode,
      timeLimitMs: codeTask.timeLimitMs,
      memoryLimitMb: codeTask.memoryLimitMb,
      maxSubmissions: resolveMaxSubmissions(codeTask.metadata),
      testCaseCount: testCases.length,
      draftTestCaseCount: testCases.filter((testCase) => draftIds.has(testCase.id)).length,
      createdAt: codeTask.createdAt,
      updatedAt: codeTask.updatedAt,
    }),
    testCases: testCases.map((testCase) => serializeTestCase(testCase, draftIds)),
  }
}

/** Create or replace the code task attached to one owned CODE assessment. */
export async function upsertCodeTaskForTeacher(
  user: AuthUser,
  input: unknown,
): Promise<CodeTaskResponse> {
  const request = upsertCodeTaskRequestSchema.parse(input)
  const owned = await loadOwnedAssessment(user, request.assessmentId)
  if (owned.type !== "CODE") {
    throw new CodeEvalError(409, "Only CODE assessments can have a code task.")
  }

  const existing = await prisma.codeTask.findUnique({ where: { assessmentId: owned.id } })
  const metadata = buildMetadata(existing?.metadata, request.maxSubmissions)

  const saved = await prisma.$transaction(async (tx) => {
    const codeTask = await tx.codeTask.upsert({
      where: { assessmentId: owned.id },
      create: {
        assessmentId: owned.id,
        language: request.language,
        instructions: request.instructions ?? null,
        starterCode: request.starterCode ?? null,
        timeLimitMs: request.timeLimitMs,
        memoryLimitMb: request.memoryLimitMb,
        metadata: toCodeTaskMetadata(metadata),
      },
      update: {
        language: request.language,
        instructions: request.instructions ?? null,
        starterCode: request.starterCode ?? null,
        timeLimitMs: request.timeLimitMs,
        memoryLimitMb: request.memoryLimitMb,
        metadata: toCodeTaskMetadata(metadata),
      },
    })
    await writeAuditLog(tx, {
      entityType: "CodeTask",
      entityId: codeTask.id,
      action: existing ? "code_task.updated" : "code_task.created",
      actor: { id: user.id, role: user.role },
      after: {
        assessmentId: owned.id,
        language: request.language,
        timeLimitMs: request.timeLimitMs,
        memoryLimitMb: request.memoryLimitMb,
        maxSubmissions: metadata.maxSubmissions,
      },
    })
    return codeTask
  })

  const testCaseCount = await prisma.testCase.count({ where: { codeTaskId: saved.id } })
  const draftIds = resolveDraftTestCaseIds(saved.metadata)
  const testCases = await prisma.testCase.findMany({
    where: { codeTaskId: saved.id },
    select: { id: true },
  })
  return serializeCodeTask({
    id: saved.id,
    assessmentId: owned.id,
    assessmentTitle: owned.title,
    language: saved.language,
    instructions: saved.instructions,
    starterCode: saved.starterCode,
    timeLimitMs: saved.timeLimitMs,
    memoryLimitMb: saved.memoryLimitMb,
    maxSubmissions: metadata.maxSubmissions,
    testCaseCount,
    draftTestCaseCount: testCases.filter((testCase) => draftIds.has(testCase.id)).length,
    createdAt: saved.createdAt,
    updatedAt: saved.updatedAt,
  })
}

/** Add a hand-authored (immediately active) test case. */
export async function createTestCaseForTeacher(
  user: AuthUser,
  assessmentId: string,
  input: unknown,
): Promise<TestCaseResponse> {
  const request = createTestCaseRequestSchema.parse(input)
  const { codeTask } = await loadOwnedCodeTask(user, assessmentId)
  const order = await nextTestCaseOrder(codeTask.id)

  const created = await prisma.$transaction(async (tx) => {
    const testCase = await tx.testCase.create({
      data: {
        codeTaskId: codeTask.id,
        order,
        name: request.name,
        description: request.description ?? null,
        category: request.category,
        input: request.input ?? null,
        expectedOutput: request.expectedOutput ?? null,
        points: request.points,
        isHidden: request.isHidden,
      },
    })
    await writeAuditLog(tx, {
      entityType: "TestCase",
      entityId: testCase.id,
      action: "code_test_case.created",
      actor: { id: user.id, role: user.role },
      after: { codeTaskId: codeTask.id, category: request.category, points: request.points },
    })
    return testCase
  })

  return serializeTestCase(created, new Set())
}

export async function updateTestCaseForTeacher(
  user: AuthUser,
  assessmentId: string,
  testCaseId: string,
  input: unknown,
): Promise<TestCaseResponse> {
  const request = updateTestCaseRequestSchema.parse(input)
  const { codeTask, testCase } = await loadOwnedTestCase(user, assessmentId, testCaseId)

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.testCase.update({
      where: { id: testCase.id },
      data: {
        ...(request.name !== undefined ? { name: request.name } : {}),
        ...(request.description !== undefined ? { description: request.description } : {}),
        ...(request.category !== undefined ? { category: request.category } : {}),
        ...(request.input !== undefined ? { input: request.input } : {}),
        ...(request.expectedOutput !== undefined ? { expectedOutput: request.expectedOutput } : {}),
        ...(request.points !== undefined ? { points: request.points } : {}),
        ...(request.isHidden !== undefined ? { isHidden: request.isHidden } : {}),
      },
    })
    await writeAuditLog(tx, {
      entityType: "TestCase",
      entityId: testCase.id,
      action: "code_test_case.updated",
      actor: { id: user.id, role: user.role },
      after: { codeTaskId: codeTask.id, fields: Object.keys(request) },
    })
    return saved
  })

  const draftIds = resolveDraftTestCaseIds(codeTask.metadata)
  return serializeTestCase(updated, draftIds)
}

export async function deleteTestCaseForTeacher(
  user: AuthUser,
  assessmentId: string,
  testCaseId: string,
): Promise<void> {
  const { codeTask, testCase } = await loadOwnedTestCase(user, assessmentId, testCaseId)
  const metadata = readCodeEvalMetadata(codeTask.metadata) ?? buildMetadata(codeTask.metadata, 1)

  await prisma.$transaction(async (tx) => {
    await tx.testCase.delete({ where: { id: testCase.id } })
    await tx.codeTask.update({
      where: { id: codeTask.id },
      data: {
        metadata: toCodeTaskMetadata({
          ...metadata,
          draftTestCaseIds: metadata.draftTestCaseIds.filter((id) => id !== testCase.id),
        }),
      },
    })
    await writeAuditLog(tx, {
      entityType: "TestCase",
      entityId: testCase.id,
      action: "code_test_case.deleted",
      actor: { id: user.id, role: user.role },
      before: { codeTaskId: codeTask.id, name: testCase.name, category: testCase.category },
    })
  })
}

export type GenerateTestCasesDeps = { provider?: LlmProvider }

/**
 * LLM-assisted generation of candidate test cases. They are persisted as
 * DRAFTS (recorded in `CodeTask.metadata.draftTestCaseIds`) and require explicit
 * teacher publication.
 */
export async function generateTestCaseDraftsForTeacher(
  user: AuthUser,
  assessmentId: string,
  input: unknown,
  deps: GenerateTestCasesDeps = {},
): Promise<TestCaseResponse[]> {
  const request = generateTestCasesRequestSchema.parse(input)
  const { owned, codeTask } = await loadOwnedCodeTask(user, assessmentId)
  const provider = deps.provider ?? getLlmProvider()

  const existing = await prisma.testCase.findMany({
    where: { codeTaskId: codeTask.id },
    select: { name: true, order: true },
    orderBy: testCaseOrder,
  })

  const messages = buildCodeEvalPrompt({
    language: codeTask.language === "javascript" ? "javascript" : "python",
    instructions: codeTask.instructions,
    starterCode: codeTask.starterCode,
    count: request.count,
    focus: request.focus,
    existingTestNames: existing.map((testCase) => testCase.name),
  })

  let result: LlmGenerateResult
  try {
    result = await provider.generate({
      messages,
      task: "code-eval",
      promptVersion: CODE_EVAL_PROMPT_VERSION,
      json: true,
      temperature: 0,
    })
  } catch (error) {
    throw new CodeEvalError(
      502,
      `Model call failed: ${error instanceof Error ? error.message : "unknown error"}.`,
    )
  }

  const drafts = parseGeneratedTestCases(result.text, { expectedCount: request.count })

  const generationId = randomUUID()
  const metadata = readCodeEvalMetadata(codeTask.metadata) ?? buildMetadata(codeTask.metadata, 1)
  let nextOrder = existing.length > 0 ? Math.max(...existing.map((entry) => entry.order)) + 1 : 0

  const created = await prisma.$transaction(async (tx) => {
    const ids: string[] = []
    for (const draft of drafts) {
      const testCase = await tx.testCase.create({
        data: {
          codeTaskId: codeTask.id,
          order: nextOrder,
          name: draft.name,
          description: draft.description,
          category: draft.category,
          input: draft.input,
          expectedOutput: draft.expectedOutput,
          points: draft.points,
          isHidden: true,
        },
      })
      nextOrder += 1
      ids.push(testCase.id)
      await writeAuditLog(tx, {
        entityType: "TestCase",
        entityId: testCase.id,
        action: "code_test_case.generated",
        actor: { id: user.id, role: user.role },
        after: {
          codeTaskId: codeTask.id,
          category: draft.category,
          promptVersion: CODE_EVAL_PROMPT_VERSION,
          model: result.model,
          provider: result.provider,
          generationId,
          status: "draft",
        },
      })
    }

    await tx.codeTask.update({
      where: { id: codeTask.id },
      data: {
        metadata: toCodeTaskMetadata({
          ...metadata,
          draftTestCaseIds: [...metadata.draftTestCaseIds, ...ids],
          generation: {
            promptVersion: CODE_EVAL_PROMPT_VERSION,
            model: result.model,
            provider: result.provider,
            generationId,
            createdAt: new Date().toISOString(),
            createdByStaffId: owned.staffId,
            count: ids.length,
          },
        }),
      },
    })

    return tx.testCase.findMany({ where: { id: { in: ids } }, orderBy: testCaseOrder })
  })

  const draftIds = new Set(created.map((testCase) => testCase.id))
  return created.map((testCase) => serializeTestCase(testCase, draftIds))
}

/**
 * Publish drafts with an explicit teacher action. Publishing only flips the
 * draft marker; it does not deliver anything to students and never grades.
 */
export async function publishGeneratedTestCasesForTeacher(
  user: AuthUser,
  assessmentId: string,
  input: unknown,
): Promise<PublishTestCasesResponse> {
  const request = publishTestCasesRequestSchema.parse(input)
  const { codeTask } = await loadOwnedCodeTask(user, assessmentId)
  const metadata = readCodeEvalMetadata(codeTask.metadata) ?? buildMetadata(codeTask.metadata, 1)
  const draftIds = new Set(metadata.draftTestCaseIds)

  const candidates = await prisma.testCase.findMany({
    where: {
      codeTaskId: codeTask.id,
      ...(request.testCaseIds ? { id: { in: request.testCaseIds } } : {}),
    },
    orderBy: testCaseOrder,
  })

  if (request.testCaseIds) {
    const found = new Set(candidates.map((testCase) => testCase.id))
    const missing = request.testCaseIds.find((id) => !found.has(id))
    if (missing) throw new CodeEvalError(404, `Test case ${missing} not found.`)
  }

  const drafts = candidates.filter((testCase) => draftIds.has(testCase.id))
  const alreadyActive = candidates
    .filter((testCase) => !draftIds.has(testCase.id))
    .map((testCase) => testCase.id)

  if (drafts.length === 0) {
    throw new CodeEvalError(409, "No generated draft test cases to publish.")
  }

  const publishSet = new Set(drafts.map((testCase) => testCase.id))

  await prisma.$transaction(async (tx) => {
    for (const draft of drafts) {
      await writeAuditLog(tx, {
        entityType: "TestCase",
        entityId: draft.id,
        action: "code_test_case.published",
        actor: { id: user.id, role: user.role },
        after: { codeTaskId: codeTask.id, status: "active" },
      })
    }
    await tx.codeTask.update({
      where: { id: codeTask.id },
      data: {
        metadata: toCodeTaskMetadata({
          ...metadata,
          draftTestCaseIds: metadata.draftTestCaseIds.filter((id) => !publishSet.has(id)),
        }),
      },
    })
  })

  return {
    success: true,
    message: "Draft test cases published.",
    published: drafts.map((testCase) => serializeTestCase(testCase, new Set())),
    alreadyActive,
  }
}
