import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

import bcrypt from "bcryptjs"

import type { Prisma } from "@/lib/generated/prisma/client"
import { submitReviewDecision, recordManualMark } from "@/lib/grading/review-service"
import { toRunEvidenceJson } from "@/lib/code-eval/serialize"
import type { TestResult } from "@/lib/contracts/code-eval"
import { createMockProvider } from "@/lib/llm"
import { prisma } from "@/lib/prisma"
import { generateQuizDraftsForTeacher } from "@/lib/quiz-generation/generation"
import { publishGeneratedQuestionsForTeacher } from "@/lib/quiz-generation/review-service"
import { startQuizAttempt, submitQuizAttempt } from "@/lib/quiz-attempts/service"
import { evaluateSubmissionForTeacher } from "@/lib/rubric-grading/evaluation"
import { upsertRubricForTeacher } from "@/lib/rubric-grading/rubric-service"
import type { AuthUser } from "@/lib/session"
import { indexMaterial } from "@/lib/vector"
import { PEER_EVALUATION_DIMENSION_KEYS } from "@/lib/groups/dimensions"
import { toStoredDimensions } from "@/lib/groups/storage"

/**
 * The Phase 4 demo course.
 *
 * One coherent course that exercises the whole product spine with a single run:
 *
 *   author (material) -> AI generates a quiz -> student takes/submits
 *   -> server scores -> AI/problem produces a suggestion -> teacher review queue
 *   -> a human publishes -> analytics + LMS export reflect it.
 *
 * Design rules this script obeys:
 *
 * - **Deterministic ids.** Every top-level entity uses a fixed id from
 *   `DEMO_IDS`, so the script is re-runnable and the test can address rows
 *   directly. Derived rows (generated questions, attempts, suggestions) get
 *   Prisma-generated ids, but they hang off a fixed parent.
 * - **Idempotent.** `deleteDemoData()` removes the previous demo graph first, so
 *   a second run replaces rather than duplicates it and never crashes.
 * - **Offline.** The mock provider is passed explicitly to every model call, so
 *   the seed is byte-for-byte reproducible with no network and no API key.
 * - **Human-only publishing.** The AI creates *suggestions* on `GradeReview`
 *   rows. The only published grades come from explicit teacher actions
 *   (`submitReviewDecision({ action: "accept" })` and `recordManualMark`), each
 *   with its `AuditLog` row.
 *
 * The script only imports modules that run outside the Next.js runtime (no
 * `server-only`, no `next/server`), so the same committed file is used by both
 * the `prisma:seed:demo` CLI and the `tests/demo-spine.test.ts` suite.
 */

export const DEMO_PASSWORD = "demo1234"

const TEACHER_USER_ID = "demo-user-teacher"
const TEACHER_STAFF_ID = "demo-staff-teacher"
const TEACHER2_USER_ID = "demo-user-teacher-2"
const TEACHER2_STAFF_ID = "demo-staff-teacher-2"

const STUDENT_COUNT = 5

const STUDENT_USER_IDS = Array.from(
  { length: STUDENT_COUNT },
  (_, index) => `demo-user-student-${index + 1}`,
)
const STUDENT_PROFILE_IDS = Array.from(
  { length: STUDENT_COUNT },
  (_, index) => `demo-student-${index + 1}`,
)

const COURSE_ID = "demo-course-algebra"
const ACTIVE_CLASS_ID = "demo-class-2026"
const PAST_CLASS_ID = "demo-class-2025"
const ACTIVE_OFFERING_ID = "demo-offering-active"
const PAST_OFFERING_ID = "demo-offering-past"
const MATERIAL_LINEAR_ID = "demo-material-linear-equations"
const MATERIAL_GRAPHING_ID = "demo-material-graphing"
const QUIZ_ASSESSMENT_ID = "demo-assessment-quiz"
const ESSAY_ASSESSMENT_ID = "demo-assessment-essay"
const CODE_ASSESSMENT_ID = "demo-assessment-code"
const GROUP_ASSESSMENT_ID = "demo-assessment-group-project"
const CODE_TASK_ID = "demo-code-task"
const GROUP_ID = "demo-group-alpha"
const LTI_REGISTRATION_ID = "demo-lti-registration"

const STUDENT_NAMES = [
  { fullName: "Demo Student One", registerNumber: "DEMO-0001" },
  { fullName: "Demo Student Two", registerNumber: "DEMO-0002" },
  { fullName: "Demo Student Three", registerNumber: "DEMO-0003" },
  { fullName: "Demo Student Four", registerNumber: "DEMO-0004" },
  { fullName: "Demo Student Five", registerNumber: "DEMO-0005" },
]

export const DEMO_IDS = {
  teacherUserId: TEACHER_USER_ID,
  teacherStaffId: TEACHER_STAFF_ID,
  teacher2UserId: TEACHER2_USER_ID,
  teacher2StaffId: TEACHER2_STAFF_ID,
  studentUserIds: STUDENT_USER_IDS,
  studentProfileIds: STUDENT_PROFILE_IDS,
  courseId: COURSE_ID,
  activeClassId: ACTIVE_CLASS_ID,
  pastClassId: PAST_CLASS_ID,
  activeOfferingId: ACTIVE_OFFERING_ID,
  pastOfferingId: PAST_OFFERING_ID,
  materialLinearId: MATERIAL_LINEAR_ID,
  materialGraphingId: MATERIAL_GRAPHING_ID,
  quizAssessmentId: QUIZ_ASSESSMENT_ID,
  essayAssessmentId: ESSAY_ASSESSMENT_ID,
  codeAssessmentId: CODE_ASSESSMENT_ID,
  groupAssessmentId: GROUP_ASSESSMENT_ID,
  codeTaskId: CODE_TASK_ID,
  groupId: GROUP_ID,
  ltiRegistrationId: LTI_REGISTRATION_ID,
} as const

export const DEMO_ACCOUNTS = {
  password: DEMO_PASSWORD,
  teacher: { id: TEACHER_USER_ID, email: "demo.teacher@school.edu" },
  teacher2: { id: TEACHER2_USER_ID, email: "demo.teacher2@school.edu" },
  students: STUDENT_USER_IDS.map((id, index) => ({
    id,
    email: `demo.student${index + 1}@school.edu`,
    fullName: STUDENT_NAMES[index].fullName,
    registerNumber: STUDENT_NAMES[index].registerNumber,
  })),
} as const

export type DemoSeedSummary = {
  materials: number
  materialChunks: number
  questions: number
  publishedQuestions: number
  quizAttempts: number
  quizResponses: number
  suggestions: number
  gradeReviews: number
  pendingReviews: number
  publishedGrades: number
  rubricCriteria: number
  groups: number
  groupMembers: number
  peerEvaluations: number
  contributionEvents: number
  milestones: number
  codeTasks: number
  testCases: number
  courseRatings: number
  ltiRegistrations: number
}

function teacherUser(id: string, email: string): AuthUser {
  return { id, email, role: "teacher" }
}

function studentUser(index: number): AuthUser {
  return {
    id: STUDENT_USER_IDS[index],
    email: `demo.student${index + 1}@school.edu`,
    role: "student",
  }
}

/**
 * Remove the previous demo graph. Deleting the fixed-id users cascades their
 * profiles and everything hanging off them (enrollments, attempts, grades,
 * reviews, suggestions, memberships, evaluations, ratings); the remaining
 * parents are then deleted explicitly in dependency order.
 */
async function deleteDemoData(): Promise<void> {
  const userIds = [TEACHER_USER_ID, TEACHER2_USER_ID, ...STUDENT_USER_IDS]

  // AuditLog has no foreign keys (it deliberately survives deletions), so its
  // demo rows are cleared explicitly: rows written by the demo actors plus the
  // system-actor rows the grading pipeline writes for AI output.
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorId: { in: userIds } },
        {
          actorId: null,
          entityType: { in: ["AIGradeSuggestion", "Grade", "GradeReview"] },
        },
      ],
    },
  })

  // Dependency order matters: every row that references a staff profile with
  // `onDelete: Restrict` (Assessment.createdById, CourseOffering.teacherId) has
  // to go before the profile it points at.
  await prisma.group.deleteMany({ where: { id: GROUP_ID } })
  await prisma.assessment.deleteMany({
    where: {
      id: {
        in: [QUIZ_ASSESSMENT_ID, ESSAY_ASSESSMENT_ID, CODE_ASSESSMENT_ID, GROUP_ASSESSMENT_ID],
      },
    },
  })
  await prisma.material.deleteMany({
    where: { id: { in: [MATERIAL_LINEAR_ID, MATERIAL_GRAPHING_ID] } },
  })
  await prisma.courseOffering.deleteMany({
    where: { id: { in: [ACTIVE_OFFERING_ID, PAST_OFFERING_ID] } },
  })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.classRoom.deleteMany({ where: { id: { in: [ACTIVE_CLASS_ID, PAST_CLASS_ID] } } })
  await prisma.course.deleteMany({ where: { id: COURSE_ID } })
  await prisma.ltiRegistration.deleteMany({ where: { id: LTI_REGISTRATION_ID } })
}

async function createPeople(passwordHash: string) {
  const teacher = await prisma.user.create({
    data: {
      id: TEACHER_USER_ID,
      email: DEMO_ACCOUNTS.teacher.email,
      passwordHash,
      role: "TEACHER",
      staffProfile: {
        create: {
          id: TEACHER_STAFF_ID,
          fullName: "Demo Teacher",
          empId: "DEMO-EMP-T-1",
        },
      },
    },
  })

  await prisma.user.create({
    data: {
      id: TEACHER2_USER_ID,
      email: DEMO_ACCOUNTS.teacher2.email,
      passwordHash,
      role: "TEACHER",
      staffProfile: {
        create: {
          id: TEACHER2_STAFF_ID,
          fullName: "Demo Teacher Two",
          empId: "DEMO-EMP-T-2",
        },
      },
    },
  })

  for (const [index, student] of STUDENT_NAMES.entries()) {
    await prisma.user.create({
      data: {
        id: STUDENT_USER_IDS[index],
        email: DEMO_ACCOUNTS.students[index].email,
        passwordHash,
        role: "STUDENT",
        studentProfile: {
          create: {
            id: STUDENT_PROFILE_IDS[index],
            fullName: student.fullName,
            registerNumber: student.registerNumber,
            formationProfile: {
              attributes: {
                gpa: ["A", "A-", "B+", "B", "A"][index],
                availability: ["Mon PM", "Tue AM", "Wed PM", "Thu AM", "Fri PM"][index],
              },
              availability: [["Mon", "Wed"], ["Tue", "Thu"], ["Mon", "Fri"], ["Wed"], ["Tue"]][
                index
              ],
            },
          },
        },
      },
    })
  }

  return teacher
}

async function createCourseAndOfferings() {
  await prisma.course.create({
    data: {
      id: COURSE_ID,
      code: "DEMO-MATH-101",
      name: "Algebra Foundations",
      description: "A demo course that exercises the whole assessment spine end to end.",
      credits: 4,
    },
  })

  await prisma.classRoom.create({
    data: {
      id: ACTIVE_CLASS_ID,
      code: "DEMO-CLASS-A",
      name: "Grade 10",
      section: "A",
      academicYear: 2026,
    },
  })
  await prisma.classRoom.create({
    data: {
      id: PAST_CLASS_ID,
      code: "DEMO-CLASS-PAST",
      name: "Grade 9",
      section: "B",
      academicYear: 2025,
    },
  })

  await prisma.courseOffering.create({
    data: {
      id: ACTIVE_OFFERING_ID,
      courseId: COURSE_ID,
      classId: ACTIVE_CLASS_ID,
      teacherId: TEACHER_STAFF_ID,
      term: "Term-1",
      academicYear: 2026,
      studentLimit: 30,
      startsOn: new Date("2026-01-05T08:00:00.000Z"),
      endsOn: new Date("2026-12-18T08:00:00.000Z"),
      analyticsSettings: {
        intervention: { pendingReviews: 1 },
      },
    },
  })

  // A completed prior-term offering so the course-rating path (which only
  // accepts a rating once the offering has ended) has real, aggregateable rows.
  await prisma.courseOffering.create({
    data: {
      id: PAST_OFFERING_ID,
      courseId: COURSE_ID,
      classId: PAST_CLASS_ID,
      teacherId: TEACHER_STAFF_ID,
      term: "Term-2",
      academicYear: 2025,
      studentLimit: 30,
      startsOn: new Date("2025-01-06T08:00:00.000Z"),
      endsOn: new Date("2025-06-06T08:00:00.000Z"),
    },
  })

  await prisma.enrollment.createMany({
    data: STUDENT_PROFILE_IDS.flatMap((studentId) => [
      { studentId, offeringId: ACTIVE_OFFERING_ID, status: "active" },
      { studentId, offeringId: PAST_OFFERING_ID, status: "active" },
    ]),
  })
}

async function createMaterials(provider: ReturnType<typeof createMockProvider>) {
  const linear = await prisma.material.create({
    data: {
      id: MATERIAL_LINEAR_ID,
      courseId: COURSE_ID,
      offeringId: ACTIVE_OFFERING_ID,
      createdById: TEACHER_STAFF_ID,
      title: "Linear equations — lecture notes",
      kind: "DOCUMENT",
      mimeType: "text/plain",
      contentText: [
        "A linear equation is an equation in which every term is either a constant or the product of a constant and a single variable raised to the first power.",
        "To solve a linear equation, isolate the variable using inverse operations: addition undoes subtraction, multiplication undoes division, and every operation must be applied to both sides.",
        "A system of two linear equations can have exactly one solution, infinitely many solutions, or no solution.",
        "The graph of a linear equation y = mx + b is a straight line, where m is the slope and b is the y-intercept.",
        "Slope measures the rate of change of y with respect to x: positive slope rises left to right, negative slope falls, zero slope is horizontal, and undefined slope is vertical.",
        "Parallel lines have equal slopes; perpendicular lines have slopes that are negative reciprocals of each other.",
      ].join("\n\n"),
    },
  })

  const graphing = await prisma.material.create({
    data: {
      id: MATERIAL_GRAPHING_ID,
      courseId: COURSE_ID,
      offeringId: ACTIVE_OFFERING_ID,
      createdById: TEACHER_STAFF_ID,
      title: "Graphing and interpreting lines",
      kind: "SLIDE_DECK",
      mimeType: "text/plain",
      contentText: [
        "To graph a line from an equation, plot the y-intercept and then use the slope to step to a second point.",
        "The x-intercept is the value of x where y equals zero; the y-intercept is the value of y where x equals zero.",
        "Substitution and elimination are the two standard algebraic methods for solving systems of linear equations.",
        "A solution to a system of equations is an ordered pair that satisfies every equation in the system simultaneously.",
        "Word problems translate into linear models by identifying a constant starting value and a constant rate of change.",
      ].join("\n\n"),
    },
  })

  await indexMaterial(linear.id, {
    provider,
    chunkOptions: { maxChars: 260, overlapChars: 40 },
  })
  await indexMaterial(graphing.id, {
    provider,
    chunkOptions: { maxChars: 260, overlapChars: 40 },
  })
}

async function createAssessments() {
  const assessmentRows = [
    {
      id: QUIZ_ASSESSMENT_ID,
      title: "Linear Equations Check-in (AI-generated)",
      type: "QUIZ" as const,
      maxMarks: 20,
      dueDate: new Date("2026-11-30T08:00:00.000Z"),
      maxAttempts: 5,
    },
    {
      id: ESSAY_ASSESSMENT_ID,
      title: "Describing a linear model (rubric-graded)",
      type: "DESCRIPTIVE" as const,
      maxMarks: 30,
      dueDate: new Date("2026-12-04T08:00:00.000Z"),
      maxAttempts: null,
    },
    {
      id: CODE_ASSESSMENT_ID,
      title: "Fix the slope calculator",
      type: "CODE" as const,
      maxMarks: 10,
      dueDate: new Date("2026-12-08T08:00:00.000Z"),
      maxAttempts: 3,
    },
    {
      id: GROUP_ASSESSMENT_ID,
      title: "Linear models group project",
      type: "GROUP_PROJECT" as const,
      maxMarks: 20,
      dueDate: new Date("2026-12-11T08:00:00.000Z"),
      maxAttempts: 1,
    },
  ]

  for (const assessment of assessmentRows) {
    await prisma.assessment.create({
      data: {
        id: assessment.id,
        offeringId: ACTIVE_OFFERING_ID,
        courseId: COURSE_ID,
        classId: ACTIVE_CLASS_ID,
        title: assessment.title,
        type: assessment.type,
        dueDate: assessment.dueDate,
        maxMarks: assessment.maxMarks,
        maxAttempts: assessment.maxAttempts,
        createdById: TEACHER_STAFF_ID,
      },
    })

    await prisma.calendarEvent.create({
      data: {
        classId: ACTIVE_CLASS_ID,
        offeringId: ACTIVE_OFFERING_ID,
        assessmentId: assessment.id,
        title: `Due: ${assessment.title}`,
        eventType: "ASSESSMENT",
        startAt: assessment.dueDate,
        isUpcoming: true,
      },
    })
  }
}

/**
 * Generate and publish the quiz through the real pipeline, then submit three
 * attempts. Student 1's review is accepted by the teacher (a published grade
 * with an audit row); students 2 and 3 are left `PENDING` so the review queue
 * has real work and the export has an unpublished grade to exclude.
 */
async function createQuizPipeline(provider: ReturnType<typeof createMockProvider>) {
  const teacher = teacherUser(TEACHER_USER_ID, DEMO_ACCOUNTS.teacher.email)

  await generateQuizDraftsForTeacher(
    teacher,
    {
      assessmentId: QUIZ_ASSESSMENT_ID,
      topic: "Solving and graphing linear equations",
      questionCount: 4,
      difficulty: "mixed",
      subtopics: ["solving equations", "slope", "systems of equations"],
      retrievalLimit: 6,
    },
    { provider },
  )

  await publishGeneratedQuestionsForTeacher(teacher, { assessmentId: QUIZ_ASSESSMENT_ID })

  const questions = await prisma.question.findMany({
    where: { assessmentId: QUIZ_ASSESSMENT_ID },
    orderBy: { order: "asc" },
    include: { options: { orderBy: { order: "asc" } } },
  })
  const correctIndexes = questions.map((question) =>
    question.options.findIndex((option) => option.isCorrect),
  )
  const wrongIndex = (correct: number) => (correct + 1) % questions[0].options.length

  const correctCounts = [questions.length, 2, 1]
  for (let index = 0; index < correctCounts.length; index += 1) {
    const user = studentUser(index)
    const attempt = await startQuizAttempt(user, { assessmentId: QUIZ_ASSESSMENT_ID })
    const answers = questions.map((question, questionIndex) => ({
      questionId: question.id,
      selectedIndex:
        questionIndex < correctCounts[index]
          ? correctIndexes[questionIndex]
          : wrongIndex(correctIndexes[questionIndex]),
    }))
    await submitQuizAttempt(user, attempt.id, { answers })
  }

  const studentOneProfileId = STUDENT_PROFILE_IDS[0]
  await submitReviewDecision({
    assessmentId: QUIZ_ASSESSMENT_ID,
    studentId: studentOneProfileId,
    reviewer: { id: TEACHER_USER_ID, role: "teacher" },
    decision: { action: "accept" },
  })
}

/**
 * Author the weighted rubric, submit one descriptive piece, and let the model
 * score it criterion by criterion. The result is per-criterion suggestions on a
 * `PENDING` review with an unpublished draft grade.
 */
async function createRubricPipeline(provider: ReturnType<typeof createMockProvider>) {
  const teacher = teacherUser(TEACHER_USER_ID, DEMO_ACCOUNTS.teacher.email)

  await upsertRubricForTeacher(teacher, {
    assessmentId: ESSAY_ASSESSMENT_ID,
    title: "Linear model explanation rubric",
    description: "Explains a real linear model with correct slope, intercept, and reasoning.",
    maxPoints: 30,
    criteria: [
      {
        label: "Mathematical accuracy",
        description: "Slope, intercept, and units are stated and used correctly.",
        weight: 1,
        maxPoints: 10,
        levels: [
          { label: "Exemplary", descriptor: "All quantities correct with units.", points: 10 },
          { label: "Developing", descriptor: "Core quantities mostly correct.", points: 6 },
          { label: "Beginning", descriptor: "Misidentifies slope or intercept.", points: 2 },
        ],
      },
      {
        label: "Modelling reasoning",
        description: "Connects the starting value and rate of change to the context.",
        weight: 1,
        maxPoints: 12,
        levels: [
          { label: "Exemplary", descriptor: "Reasoning is explicit and contextual.", points: 12 },
          { label: "Developing", descriptor: "Reasoning is present but thin.", points: 7 },
          { label: "Beginning", descriptor: "States numbers without reasoning.", points: 3 },
        ],
      },
      {
        label: "Communication",
        description: "Clear, organised explanation with correct terminology.",
        weight: 1,
        maxPoints: 8,
        levels: [
          { label: "Exemplary", descriptor: "Fluent and well organised.", points: 8 },
          { label: "Developing", descriptor: "Understandable but uneven.", points: 5 },
          { label: "Beginning", descriptor: "Hard to follow.", points: 2 },
        ],
      },
    ],
  })

  const submission = await prisma.submission.create({
    data: {
      assessmentId: ESSAY_ASSESSMENT_ID,
      studentId: STUDENT_PROFILE_IDS[0],
      status: "SUBMITTED",
      submittedAt: new Date("2026-11-20T14:30:00.000Z"),
      contentText: [
        "For the tutoring centre, the total cost is a linear model because it starts with a fixed",
        "enrolment fee and then grows at a constant rate for every session booked. The y-intercept is",
        "the enrolment fee of 40 dollars, and the slope of 25 dollars per session is the rate of change.",
        "If a family books eight sessions, the total is 40 plus 25 times eight, which equals 240 dollars.",
        "The slope means each extra session adds exactly 25 dollars, and the intercept is the cost before",
        "any sessions are booked.",
      ].join(" "),
    },
  })

  await evaluateSubmissionForTeacher(teacher, submission.id, { provider })

  // A second, unevaluated submission so the review page has a real candidate to
  // run the model on in the browser.
  await prisma.submission.create({
    data: {
      assessmentId: ESSAY_ASSESSMENT_ID,
      studentId: STUDENT_PROFILE_IDS[1],
      status: "SUBMITTED",
      submittedAt: new Date("2026-11-21T09:15:00.000Z"),
      contentText: [
        "A linear model fits because the fee changes by the same amount each month. I identified the",
        "starting value and the monthly rate, then wrote an equation and used it to predict the cost",
        "for a year of membership.",
      ].join(" "),
    },
  })
}

async function createCodeTask() {
  await prisma.codeTask.create({
    data: {
      id: CODE_TASK_ID,
      assessmentId: CODE_ASSESSMENT_ID,
      language: "python",
      instructions:
        "Fix the `slope` function so it returns the slope between two points, then keep the line count under 20.",
      starterCode: "def slope(x1, y1, x2, y2):\n    return 0\n",
      timeLimitMs: 5000,
      memoryLimitMb: 256,
      // The `generator` marker is what makes this an envelope at all:
      // `readCodeEvalMetadata` returns null without it, so `maxSubmissions: 3`
      // was silently ignored and the task fell back to the default cap of 10 —
      // the student page read "1 / 10 runs used" for a task meant to allow 3.
      // Every test fixture writes the marker; the seed was the only writer that
      // did not.
      metadata: { generator: "code-eval", maxSubmissions: 3, draftTestCaseIds: [] },
    },
  })

  const testCases = [
    {
      order: 0,
      name: "Positive slope",
      description: "Slope through (0,0) and (2,4) is 2.",
      category: "unit",
      input: JSON.stringify({ function: "slope", args: [0, 0, 2, 4] }),
      expectedOutput: "2",
      isHidden: false,
      points: 3,
    },
    {
      order: 1,
      name: "Negative slope",
      description: "Slope through (0,4) and (2,0) is -2.",
      category: "unit",
      input: JSON.stringify({ function: "slope", args: [0, 4, 2, 0] }),
      expectedOutput: "-2",
      isHidden: true,
      points: 3,
    },
    {
      order: 2,
      name: "Structure check",
      description: "The submission defines a function and stays within the line budget.",
      category: "structure",
      input: JSON.stringify({ mustContain: ["def "], maxLines: 20 }),
      expectedOutput: null,
      isHidden: true,
      points: 4,
    },
  ]

  // Captured so the seeded run's evidence can reference real test-case ids.
  // `points` is a `Decimal` and `category` is a union, so they are normalised here
  // rather than at each use.
  const createdTestCases: {
    id: string
    name: string
    category: TestResult["category"]
    points: number
  }[] = []
  for (const testCase of testCases) {
    const created = await prisma.testCase.create({
      data: { codeTaskId: CODE_TASK_ID, ...testCase },
      select: { id: true, name: true, category: true, points: true },
    })
    createdTestCases.push({
      id: created.id,
      name: created.name,
      category: created.category as TestResult["category"],
      points: Number(created.points),
    })
  }

  const codeSubmission = await prisma.submission.create({
    data: {
      assessmentId: CODE_ASSESSMENT_ID,
      studentId: STUDENT_PROFILE_IDS[0],
      status: "SUBMITTED",
      submittedAt: new Date("2026-11-25T10:00:00.000Z"),
      contentText: "def slope(x1, y1, x2, y2):\n    return (y2 - y1) / (x2 - x1)\n",
    },
  })

  /*
   * A finished, readable run.
   *
   * Two gaps this closes, both flagged by review:
   *
   * 1. `finishedAt` was never set, and the UI keys "finished" off it — so the row
   *    rendered "Passed" while the statistics above it read "No finished run yet"
   *    and counted zero finished runs. A status that contradicts its own
   *    timestamp is worse than no data.
   * 2. `resultsJson` was written as `{ cases: [...] }`, but `readRunEvidence`
   *    (`lib/code-eval/serialize.ts:31`) requires `record.results` to be a
   *    `TestResult[]`. It failed to parse, so every per-test row, the recomputed
   *    points and the diagnostics panel rendered empty. Writing the shape
   *    `toRunEvidenceJson` produces is what makes the seeded run legible.
   */
  const runFinishedAt = new Date("2026-11-25T10:02:22.000Z")
  await prisma.testRun.create({
    data: {
      codeTaskId: CODE_TASK_ID,
      studentId: STUDENT_PROFILE_IDS[0],
      submissionId: codeSubmission.id,
      status: "PASSED",
      language: "python",
      passedCount: 3,
      failedCount: 0,
      totalCount: 3,
      runtimeMs: 142,
      startedAt: new Date("2026-11-25T10:02:20.000Z"),
      finishedAt: runFinishedAt,
      coverage: 100,
      resultsJson: toRunEvidenceJson({
        results: createdTestCases.map((testCase) => ({
          testCaseId: testCase.id,
          name: testCase.name,
          description: null,
          category: testCase.category,
          points: testCase.points,
          earnedPoints: testCase.points,
          passed: true,
          stdout: "",
          stderr: "",
          message: "Passed.",
          durationMs: 40,
        })),
        timedOut: false,
        memoryExceeded: false,
        killMessage: null,
        // `toRunEvidenceJson` returns a plain record; Prisma wants its own JSON
        // input type, which cannot be expressed structurally.
      }) as unknown as Prisma.InputJsonValue,
    },
  })
}

async function createGroupProject() {
  await prisma.group.create({
    data: {
      id: GROUP_ID,
      offeringId: ACTIVE_OFFERING_ID,
      name: "Team Alpha",
      projectTitle: "Model the cost of a school trip",
      status: "ACTIVE",
      metadata: { source: "manual", createdByUserId: TEACHER_USER_ID },
    },
  })

  const members = STUDENT_PROFILE_IDS.slice(0, 3)
  await prisma.groupMember.createMany({
    data: members.map((studentId, index) => ({
      groupId: GROUP_ID,
      studentId,
      role: index === 0 ? "coordinator" : null,
    })),
  })

  const ratingSets = [
    {
      contributing: 5,
      interacting: 4,
      keepingOnTrack: 4,
      expectingQuality: 5,
      knowledgeSkillsAbilities: 5,
    },
    {
      contributing: 4,
      interacting: 4,
      keepingOnTrack: 5,
      expectingQuality: 4,
      knowledgeSkillsAbilities: 4,
    },
    {
      contributing: 3,
      interacting: 4,
      keepingOnTrack: 3,
      expectingQuality: 4,
      knowledgeSkillsAbilities: 4,
    },
  ]

  for (let evaluator = 0; evaluator < members.length; evaluator += 1) {
    for (let evaluatee = 0; evaluatee < members.length; evaluatee += 1) {
      if (evaluator === evaluatee) continue
      const ratings = ratingSets[evaluator]
      const overall =
        PEER_EVALUATION_DIMENSION_KEYS.reduce((sum, key) => sum + ratings[key], 0) /
        PEER_EVALUATION_DIMENSION_KEYS.length
      await prisma.peerEvaluation.create({
        data: {
          groupId: GROUP_ID,
          evaluatorId: members[evaluator],
          evaluateeId: members[evaluatee],
          status: "SUBMITTED",
          dimensions: toStoredDimensions(ratings),
          overallScore: overall,
          submittedAt: new Date("2026-11-28T16:00:00.000Z"),
          comments:
            evaluator === 2
              ? "Contributed steadily; could share updates earlier."
              : "Reliable and collaborative throughout the project.",
        },
      })
    }
  }

  const contributions = [
    {
      studentId: members[0],
      type: "COMMIT" as const,
      summary: "Draft model spreadsheet",
      weight: 2,
    },
    {
      studentId: members[0],
      type: "PULL_REQUEST" as const,
      summary: "Merge cost model",
      weight: 3,
    },
    {
      studentId: members[1],
      type: "REVIEW" as const,
      summary: "Reviewed the cost model",
      weight: 1,
    },
    { studentId: members[1], type: "COMMIT" as const, summary: "Add unit conversions", weight: 2 },
    { studentId: members[2], type: "ISSUE" as const, summary: "Flag missing bus quote", weight: 1 },
  ]
  for (const [index, contribution] of contributions.entries()) {
    await prisma.contributionEvent.create({
      data: {
        groupId: GROUP_ID,
        studentId: contribution.studentId,
        type: contribution.type,
        source: "demo",
        summary: contribution.summary,
        weight: contribution.weight,
        occurredAt: new Date(2026, 10, 5 + index, 12, 0, 0),
      },
    })
  }

  await prisma.milestone.create({
    data: {
      groupId: GROUP_ID,
      title: "Collect quotes",
      description: "Gather transport and venue quotes.",
      status: "COMPLETED",
      weight: 1,
      dueDate: new Date("2026-11-14T08:00:00.000Z"),
      completedAt: new Date("2026-11-13T15:20:00.000Z"),
    },
  })
  await prisma.milestone.create({
    data: {
      groupId: GROUP_ID,
      title: "Build the linear model",
      description: "Fit a line to the collected quotes and justify it.",
      status: "IN_PROGRESS",
      weight: 2,
      dueDate: new Date("2026-12-02T08:00:00.000Z"),
    },
  })

  // The teacher publishes the same group mark for every member. This is a human
  // manual-mark action, and it lets the groups analysis produce per-student
  // suggestions without ever publishing one on its own.
  for (const studentId of members) {
    await recordManualMark({
      assessmentId: GROUP_ASSESSMENT_ID,
      studentId,
      points: 16,
      maxPoints: 20,
      actor: { id: TEACHER_USER_ID, role: "teacher" },
    })
  }
}

async function createCourseRatings() {
  // The ratings read path (`getTeacherRatingsReport`) is exercised by the spine
  // test; the write path lives in `lib/course-ratings.ts`, which is `server-only`
  // and therefore cannot be imported by this CLI. The rows are written directly,
  // preserving the same one-rating-per-student rule the service enforces.
  const ratings = [
    {
      studentId: STUDENT_PROFILE_IDS[0],
      rating: 5,
      comment: "Clear explanations and useful practice.",
    },
    {
      studentId: STUDENT_PROFILE_IDS[1],
      rating: 4,
      comment: "Good pacing; the graphing unit helped.",
    },
    { studentId: STUDENT_PROFILE_IDS[2], rating: 4, comment: null as string | null },
  ]
  for (const rating of ratings) {
    await prisma.courseRating.create({
      data: {
        offeringId: PAST_OFFERING_ID,
        studentId: rating.studentId,
        rating: rating.rating,
        comment: rating.comment,
      },
    })
  }
}

async function createLtiRegistration() {
  // No private key is stored: `privateKeyRef` only names where the key lives.
  await prisma.ltiRegistration.create({
    data: {
      id: LTI_REGISTRATION_ID,
      platformIssuer: "https://demo-lms.example.com",
      clientId: "demo-client-id",
      deploymentId: "demo-deployment-id",
      keyId: "demo-key-id",
      privateKeyRef: "LTI_PRIVATE_KEY",
      lineItemsUrl: "https://demo-lms.example.com/ags/lineitems",
      scopes: ["https://purl.imsglobal.org/spec/lti-ags/scope/score"],
      name: "Demo LMS",
      isActive: true,
    },
  })
  await prisma.ltiUserMapping.create({
    data: {
      registrationId: LTI_REGISTRATION_ID,
      studentId: STUDENT_PROFILE_IDS[0],
      ltiUserId: "lms-user-1",
    },
  })
}

async function countSummary(): Promise<DemoSeedSummary> {
  const [
    materials,
    materialChunks,
    questions,
    publishedQuestions,
    quizAttempts,
    quizResponses,
    suggestions,
    gradeReviews,
    pendingReviews,
    publishedGrades,
    rubricCriteria,
    groups,
    groupMembers,
    peerEvaluations,
    contributionEvents,
    milestones,
    codeTasks,
    testCases,
    courseRatings,
    ltiRegistrations,
  ] = await Promise.all([
    prisma.material.count({ where: { id: { in: [MATERIAL_LINEAR_ID, MATERIAL_GRAPHING_ID] } } }),
    prisma.materialChunk.count({
      where: { materialId: { in: [MATERIAL_LINEAR_ID, MATERIAL_GRAPHING_ID] } },
    }),
    prisma.question.count({ where: { assessmentId: QUIZ_ASSESSMENT_ID } }),
    prisma.question.count({
      where: { assessmentId: QUIZ_ASSESSMENT_ID, status: "published" },
    }),
    prisma.quizAttempt.count({ where: { assessmentId: QUIZ_ASSESSMENT_ID } }),
    prisma.quizResponse.count({ where: { attempt: { assessmentId: QUIZ_ASSESSMENT_ID } } }),
    prisma.aIGradeSuggestion.count({
      where: {
        assessmentId: { in: [QUIZ_ASSESSMENT_ID, ESSAY_ASSESSMENT_ID] },
      },
    }),
    prisma.gradeReview.count({
      where: { assessmentId: { in: [QUIZ_ASSESSMENT_ID, ESSAY_ASSESSMENT_ID] } },
    }),
    prisma.gradeReview.count({
      where: {
        assessmentId: { in: [QUIZ_ASSESSMENT_ID, ESSAY_ASSESSMENT_ID] },
        status: { in: ["PENDING", "NEEDS_REVIEW"] },
      },
    }),
    prisma.grade.count({
      where: {
        assessmentId: {
          in: [QUIZ_ASSESSMENT_ID, ESSAY_ASSESSMENT_ID, GROUP_ASSESSMENT_ID],
        },
        publishedAt: { not: null },
      },
    }),
    prisma.rubricCriterion.count({ where: { rubric: { assessmentId: ESSAY_ASSESSMENT_ID } } }),
    prisma.group.count({ where: { id: GROUP_ID } }),
    prisma.groupMember.count({ where: { groupId: GROUP_ID } }),
    prisma.peerEvaluation.count({ where: { groupId: GROUP_ID } }),
    prisma.contributionEvent.count({ where: { groupId: GROUP_ID } }),
    prisma.milestone.count({ where: { groupId: GROUP_ID } }),
    prisma.codeTask.count({ where: { id: CODE_TASK_ID } }),
    prisma.testCase.count({ where: { codeTaskId: CODE_TASK_ID } }),
    prisma.courseRating.count({ where: { offeringId: PAST_OFFERING_ID } }),
    prisma.ltiRegistration.count({ where: { id: LTI_REGISTRATION_ID } }),
  ])

  return {
    materials,
    materialChunks,
    questions,
    publishedQuestions,
    quizAttempts,
    quizResponses,
    suggestions,
    gradeReviews,
    pendingReviews,
    publishedGrades,
    rubricCriteria,
    groups,
    groupMembers,
    peerEvaluations,
    contributionEvents,
    milestones,
    codeTasks,
    testCases,
    courseRatings,
    ltiRegistrations,
  }
}

/** Create (or recreate) the whole demo course. Safe to run repeatedly. */
export async function seedDemo(): Promise<DemoSeedSummary> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set")
  }
  // Force the offline, deterministic provider regardless of the ambient env.
  process.env.LLM_PROVIDER = "mock"
  const provider = createMockProvider()

  await deleteDemoData()

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10)
  await createPeople(passwordHash)
  await createCourseAndOfferings()
  await createMaterials(provider)
  await createAssessments()
  await createQuizPipeline(provider)
  await createRubricPipeline(provider)
  await createCodeTask()
  await createGroupProject()
  await createCourseRatings()
  await createLtiRegistration()

  return countSummary()
}

const isDirectRun =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  seedDemo()
    .then((summary) => {
      console.log("Demo seed complete")
      console.log(JSON.stringify(summary, null, 2))
      console.log(`Teacher login: ${DEMO_ACCOUNTS.teacher.email} / ${DEMO_PASSWORD}`)
      console.log(`Student login: ${DEMO_ACCOUNTS.students[0].email} / ${DEMO_PASSWORD}`)
    })
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
    .finally(async () => {
      await prisma.$disconnect()
    })
}
