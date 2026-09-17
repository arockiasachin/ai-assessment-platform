import "dotenv/config"

import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

import bcrypt from "bcryptjs"

import type { Prisma } from "@/lib/generated/prisma/client"
import { toRunEvidenceJson } from "@/lib/code-eval/serialize"
import type { TestResult } from "@/lib/contracts/code-eval"
import { setOfferingGradingForTeacher } from "@/lib/grading/offering-config-service"
import { recordManualMark, submitReviewDecision } from "@/lib/grading/review-service"
import { createMockProvider } from "@/lib/llm"
import { prisma } from "@/lib/prisma"
import { evaluateSubmissionForTeacher } from "@/lib/rubric-grading/evaluation"
import { upsertRubricForTeacher } from "@/lib/rubric-grading/rubric-service"
import { indexMaterial } from "@/lib/vector"

import {
  COURSE_SUBTOPIC_VOCABULARY,
  DAA_LAB_EXPERIMENTS,
  DAA_THEORY_MODULES,
  DSA_LAB_EXPERIMENTS,
  DSA_THEORY_MODULES,
} from "./seed-courses-content"

/**
 * Two real postgraduate courses, their labs, and a shared student cohort.
 *
 * This is a **new, independent** seed. It shares no rows with `prisma/seed-demo.ts` and does not
 * touch its data: the demo backs the Phase 4 spine test and its shape assertions, and adding
 * courses to it would move counts those tests pin.
 *
 * ## The courses
 *
 * Both are from the VIT curriculum handbook (M.Tech CSE — Specialisation in Big Data Analytics,
 * 2023-24), and every fact below is taken from it rather than invented:
 *
 * | | DSA | DAA |
 * |---|---|---|
 * | Theory code / credits / hours | `MCSE501L` · 3 · 45 | `MCSE502L` · 3 · 45 |
 * | Lab code / credits / hours | `MCSE501P` · 1 · 30 | `MCSE502P` · 1 · 30 |
 * | Prerequisite | NIL | NIL |
 * | Prescribed text | CLRS, MIT Press 2022 (sole) | same |
 * | Theory assessment (as written) | `CAT / Written Assignment / Quiz / FAT` | same |
 * | Lab assessment (as written) | `CAT / Mid-Term Lab / FAT` | same |
 *
 * Four `Course` rows, not two, because the handbook gives the theory and the lab **separate codes
 * and separate credits**. `Course.category` is `THEORY` for the `L` rows and `LABORATORY` for the
 * `P` rows, and that is load-bearing rather than cosmetic: it is the first thing
 * `resolveRegimeForCourse` checks, and it is what puts every lab on absolute bands at any size.
 *
 * ### What is a choice, not a handbook fact
 *
 * - **The semester and academic year.** The handbook states no semester. This seed chooses
 *   `academicYear: 2026` and `term: "Semester-1"` so the dataset has a concrete term; that choice
 *   is recorded here and nowhere presented as a handbook fact.
 * - **The section letters and the classroom names.** The handbook names no sections. The
 *   convention is `MCSE-BDA-2026-<course>-<section>`, e.g. `MCSE-BDA-2026-DSA-A`.
 * - **The CAT/FAT weights.** The handbook states **no numbers at all** for assessment. `CAT 40 /
 *   FAT 60` with `minimumCatPercent: 30` is this platform's policy (`lib/grading/policy.ts`
 *   records where that default comes from), not a handbook figure.
 * - **The lab component collapse.** The handbook's lab scheme has three components
 *   (`CAT / Mid-Term Lab / FAT`); the platform models exactly one CAT pool and one FAT, so the
 *   Mid-Term Lab is seeded as an assessment **inside the CAT pool**. Nothing is dropped: the third
 *   component is folded into the CAT pool rather than discarded.
 * - **The code-eval test cases.** The handbook calls the lab experiment list "Indicative", so the
 *   `TestCase` rows attached to the seeded experiments are seed fiction, written to give the
 *   code-eval spine something to run.
 *
 * ## Grading-regime coverage
 *
 * This is the point of the dataset. `resolveRegimeForCourse` checks, in order:
 * `category === null` -> `isCategoricallyAbsolute(category)` -> `enrolledCount < 11` ->
 * `publishedTotals.length < 11` -> `sigma === 0` -> else relative. The data is arranged so the
 * offerings land on four different branches:
 *
 * | Offering | Enrolled | Published totals | Intended branch |
 * |---|---|---|---|
 * | `MCSE501L` / DSA section A | 9 | 9 | `small-class` (absolute, info) |
 * | `MCSE501L` / DSA section B | 15 | 13 | `relative` |
 * | `MCSE502L` / DAA section A | 12 | 6 | `awaiting-base-metrics` (absolute, warning) |
 * | the three lab offerings | 9 / 15 / 12 | some | `non-theory-course` (absolute, info) |
 *
 * A "published total" is `gatherRegimeInputs`' definition, not a count of grades: the mean of a
 * student's **published** percentages across the offering's assessments, one value per student
 * who has at least one. Enrolment is counted as `status: "active"` rows only, which is why the
 * inactive enrolments below do not move `enrolledCount`.
 *
 * ## Determinism, idempotency and the environment
 *
 * - Every top-level row has a fixed id (see `COURSES_IDS`), and `deleteCoursesData()` removes the
 *   previous graph in dependency order, so a second run replaces rather than duplicates.
 * - `LLM_PROVIDER=mock` is forced and `createMockProvider()` is passed explicitly to every model
 *   call, so the seed is offline and reproducible.
 * - Published marks go through `recordManualMark` and `submitReviewDecision`, never a direct
 *   `Grade` insert, so every published grade has its `AuditLog` row.
 * - **`tsx` does not load `.env`.** This file imports `dotenv/config` (the same thing
 *   `prisma/seed.ts` does) so `npm run prisma:seed:courses` works with the repository's `.env`;
 *   it also works with `DATABASE_URL` exported in the environment, which is how
 *   `docs/demo.md` documents `prisma:seed:demo`.
 */

export const COURSES_PASSWORD = "courses1234"

const TEACHER_DSA_USER_ID = "courses-user-teacher-dsa"
const TEACHER_DSA_STAFF_ID = "courses-staff-teacher-dsa"
const TEACHER_DAA_USER_ID = "courses-user-teacher-daa"
const TEACHER_DAA_STAFF_ID = "courses-staff-teacher-daa"

const STUDENT_COUNT = 32

function pad2(value: number): string {
  return String(value).padStart(2, "0")
}

const STUDENT_USER_IDS = Array.from(
  { length: STUDENT_COUNT },
  (_, index) => `courses-user-student-${pad2(index + 1)}`,
)
const STUDENT_PROFILE_IDS = Array.from(
  { length: STUDENT_COUNT },
  (_, index) => `courses-student-${pad2(index + 1)}`,
)

const DSA_CLASS_A_ID = "courses-class-dsa-a"
const DSA_CLASS_B_ID = "courses-class-dsa-b"
const DAA_CLASS_A_ID = "courses-class-daa-a"

const DSA_THEORY_COURSE_ID = "courses-course-mcse501l"
const DSA_LAB_COURSE_ID = "courses-course-mcse501p"
const DAA_THEORY_COURSE_ID = "courses-course-mcse502l"
const DAA_LAB_COURSE_ID = "courses-course-mcse502p"

const OFFERING_DSA_L_A = "courses-offering-mcse501l-a"
const OFFERING_DSA_L_B = "courses-offering-mcse501l-b"
const OFFERING_DSA_P_A = "courses-offering-mcse501p-a"
const OFFERING_DSA_P_B = "courses-offering-mcse501p-b"
const OFFERING_DAA_L_A = "courses-offering-mcse502l-a"
const OFFERING_DAA_P_A = "courses-offering-mcse502p-a"

const THEORY_OFFERING_IDS = [OFFERING_DSA_L_A, OFFERING_DSA_L_B, OFFERING_DAA_L_A] as const
const LAB_OFFERING_IDS = [OFFERING_DSA_P_A, OFFERING_DSA_P_B, OFFERING_DAA_P_A] as const
const ALL_OFFERING_IDS: string[] = [...THEORY_OFFERING_IDS, ...LAB_OFFERING_IDS]

/** Assessment suffixes per offering shape. See the scheme below. */
const THEORY_ASSESSMENT_SUFFIXES = ["cat-quiz", "cat-assignment", "cat-descriptive", "fat"] as const
const LAB_ASSESSMENT_SUFFIXES = ["cat-lab", "cat-midterm-code", "fat"] as const

function assessmentId(offeringId: string, suffix: string): string {
  return `${offeringId}-${suffix}`
}

const ASSESSMENT_IDS = [
  ...THEORY_OFFERING_IDS.flatMap((offeringId) =>
    THEORY_ASSESSMENT_SUFFIXES.map((suffix) => assessmentId(offeringId, suffix)),
  ),
  ...LAB_OFFERING_IDS.flatMap((offeringId) =>
    LAB_ASSESSMENT_SUFFIXES.map((suffix) => assessmentId(offeringId, suffix)),
  ),
]

const MATERIAL_IDS = [
  ...DSA_THEORY_MODULES.map((module) => `courses-material-mcse501l-m${module.module}`),
  ...DSA_LAB_EXPERIMENTS.map((experiment) => `courses-material-mcse501p-e${experiment.experiment}`),
  ...DAA_THEORY_MODULES.map((module) => `courses-material-mcse502l-m${module.module}`),
  ...DAA_LAB_EXPERIMENTS.map((experiment) => `courses-material-mcse502p-e${experiment.experiment}`),
]

const CODE_TASK_IDS = LAB_OFFERING_IDS.map((offeringId) => `${offeringId}-code-task`)

const COURSE_IDS = [
  DSA_THEORY_COURSE_ID,
  DSA_LAB_COURSE_ID,
  DAA_THEORY_COURSE_ID,
  DAA_LAB_COURSE_ID,
]

/** The term this seed chooses; the handbook states no semester. */
const ACADEMIC_YEAR = 2026
const TERM = "Semester-1"

const NOW = new Date()
const DAY_MS = 24 * 60 * 60 * 1000

/** A date `days` from now, at a fixed UTC hour; negative is in the past. */
function fromNow(days: number, hourUtc = 8): Date {
  const at = new Date(NOW.getTime() + days * DAY_MS)
  at.setUTCHours(hourUtc, 0, 0, 0)
  return at
}

/** A 15-week term containing today: 9 weeks behind, 6 ahead. */
const TERM_START = fromNow(-63)
const TERM_END = fromNow(42)

const DUE_CAT1 = fromNow(-42)
const DUE_CAT2 = fromNow(-28)
const DUE_CAT3 = fromNow(-14)
const DUE_FAT = fromNow(28)

const RELEASED_CAT1 = fromNow(-56)
const RELEASED_CAT2 = fromNow(-42)
const RELEASED_CAT3 = fromNow(-28)

const THEORY_MAX_MARKS = { cat1: 20, cat2: 30, cat3: 50, fat: 100 } as const
const LAB_MAX_MARKS = { cat: 20, midterm: 30, fat: 50 } as const

/**
 * The cohort, and why it is shaped this way.
 *
 * A shared pool of **32** students yields 24 DSA seats (9 + 15) and 12 DAA seats, with **six
 * students taking both courses** (indices 0-5), so 30 distinct students are enrolled and two
 * (`index 30`, `index 31`) are in the pool with only *inactive* enrolments. That asymmetry is
 * deliberate: the regime reader counts `status: "active"` rows, so the inactive rows and the
 * unenrolled pool students are the fixtures that would catch a reader counting every enrolment.
 */
const DSA_SECTION_A_INDEXES = [0, 1, 2, 3, 4, 5, 6, 7, 8]
const DSA_SECTION_B_INDEXES = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]
const DAA_SECTION_A_INDEXES = [0, 1, 2, 3, 4, 5, 24, 25, 26, 27, 28, 29]
const DROPPED_STUDENT_INDEX = 30
const WITHDRAWN_STUDENT_INDEX = 31

const STUDENTS = [
  { fullName: "Aarav Menon", registerNumber: "23BDA0001" },
  { fullName: "Diya Krishnan", registerNumber: "23BDA0002" },
  { fullName: "Ishaan Rao", registerNumber: "23BDA0003" },
  { fullName: "Meera Nair", registerNumber: "23BDA0004" },
  { fullName: "Kabir Sethi", registerNumber: "23BDA0005" },
  { fullName: "Ananya Bose", registerNumber: "23BDA0006" },
  { fullName: "Rahul Verma", registerNumber: "23BDA0007" },
  { fullName: "Sneha Pillai", registerNumber: "23BDA0008" },
  { fullName: "Vikram Joshi", registerNumber: "23BDA0009" },
  { fullName: "Nisha Agarwal", registerNumber: "23BDA0010" },
  { fullName: "Arjun Chatterjee", registerNumber: "23BDA0011" },
  { fullName: "Pooja Reddy", registerNumber: "23BDA0012" },
  { fullName: "Siddharth Kulkarni", registerNumber: "23BDA0013" },
  { fullName: "Tanvi Desai", registerNumber: "23BDA0014" },
  { fullName: "Harsh Gupta", registerNumber: "23BDA0015" },
  { fullName: "Riya Malhotra", registerNumber: "23BDA0016" },
  { fullName: "Aditya Sharma", registerNumber: "23BDA0017" },
  { fullName: "Kavya Iyengar", registerNumber: "23BDA0018" },
  { fullName: "Nikhil Bhat", registerNumber: "23BDA0019" },
  { fullName: "Shreya Ghosh", registerNumber: "23BDA0020" },
  { fullName: "Manav Singh", registerNumber: "23BDA0021" },
  { fullName: "Divya Krishnan", registerNumber: "23BDA0022" },
  { fullName: "Rohit Das", registerNumber: "23BDA0023" },
  { fullName: "Aisha Khan", registerNumber: "23BDA0024" },
  { fullName: "Varun Mehta", registerNumber: "23BDA0025" },
  { fullName: "Neha Choudhary", registerNumber: "23BDA0026" },
  { fullName: "Karan Kapoor", registerNumber: "23BDA0027" },
  { fullName: "Trisha Venkatesh", registerNumber: "23BDA0028" },
  { fullName: "Devansh Patel", registerNumber: "23BDA0029" },
  { fullName: "Isha Mukherjee", registerNumber: "23BDA0030" },
  { fullName: "Yash Tiwari", registerNumber: "23BDA0031" },
  { fullName: "Lakshmi Subramanian", registerNumber: "23BDA0032" },
] as const

export const COURSES_IDS = {
  teacherDsaUserId: TEACHER_DSA_USER_ID,
  teacherDsaStaffId: TEACHER_DSA_STAFF_ID,
  teacherDaaUserId: TEACHER_DAA_USER_ID,
  teacherDaaStaffId: TEACHER_DAA_STAFF_ID,
  studentUserIds: STUDENT_USER_IDS,
  studentProfileIds: STUDENT_PROFILE_IDS,
  courseIds: {
    dsaTheory: DSA_THEORY_COURSE_ID,
    dsaLab: DSA_LAB_COURSE_ID,
    daaTheory: DAA_THEORY_COURSE_ID,
    daaLab: DAA_LAB_COURSE_ID,
  },
  classIds: { dsaA: DSA_CLASS_A_ID, dsaB: DSA_CLASS_B_ID, daaA: DAA_CLASS_A_ID },
  offeringIds: {
    dsaTheoryA: OFFERING_DSA_L_A,
    dsaTheoryB: OFFERING_DSA_L_B,
    dsaLabA: OFFERING_DSA_P_A,
    dsaLabB: OFFERING_DSA_P_B,
    daaTheoryA: OFFERING_DAA_L_A,
    daaLabA: OFFERING_DAA_P_A,
  },
  assessmentIds: ASSESSMENT_IDS,
  materialIds: MATERIAL_IDS,
  codeTaskIds: CODE_TASK_IDS,
} as const

export const COURSES_ACCOUNTS = {
  password: COURSES_PASSWORD,
  teacherDsa: { id: TEACHER_DSA_USER_ID, email: "dsa.teacher@vit.example.edu" },
  teacherDaa: { id: TEACHER_DAA_USER_ID, email: "daa.teacher@vit.example.edu" },
  students: STUDENT_USER_IDS.map((id, index) => ({
    id,
    email: `bda.student${pad2(index + 1)}@vit.example.edu`,
    fullName: STUDENTS[index].fullName,
    registerNumber: STUDENTS[index].registerNumber,
  })),
} as const

export type CoursesSeedSummary = {
  courses: number
  offerings: number
  students: number
  activeEnrollments: number
  inactiveEnrollments: number
  assessments: number
  releasedAssessments: number
  unpublishedAssessments: number
  publishedGrades: number
  materials: number
  materialChunks: number
  rubricCriteria: number
  aiSuggestions: number
  codeTasks: number
  testCases: number
  testRuns: number
}

/** The seeded teachers, narrowed to the role every grading service accepts. */
type SeedTeacher = { id: string; email: string; role: "teacher" }

function teacherUser(id: string, email: string): SeedTeacher {
  return { id, email, role: "teacher" }
}

/** Course descriptions carry the handbook's objectives and outcomes; there is no outcomes model. */
function dsaTheoryDescription(): string {
  return [
    "M.Tech (CSE) — Specialisation in Big Data Analytics, 2023-24. Discipline core course MCSE501L: Data Structures and Algorithms (3 credits, 45 lecture hours). Prerequisite: NIL. Prescribed text: Cormen, Leiserson, Rivest & Stein, Introduction to Algorithms, 4th edition, MIT Press, 2022.",
    "Course objectives: (1) to familiarise the concepts of data structures and algorithms focusing on space and time complexity; (2) to provide a deeper insight into the basic and advanced data structures; (3) to develop the knowledge for the application of advanced trees and graphs in real-world scenarios.",
    "Course outcomes — upon completion of the course the student will be able to: (1) understand and analyse the space and time complexity of algorithms; (2) identify a suitable data structure for a given problem; (3) implement graph algorithms in various real-life applications; (4) implement heaps and trees for querying and searching; (5) use basic data structures in advanced data structure operations; (6) use searching and sorting in various real-life applications.",
    "Eight modules over 45 hours: Growth of Functions (3h), Elementary Data Structures (6h), Sorting and Searching (7h), Trees (6h), Advanced Trees (8h), Graphs (7h), Heap and Hashing (6h), Contemporary Issues (2h).",
  ].join("\n\n")
}

function dsaLabDescription(): string {
  return [
    "M.Tech (CSE) — Specialisation in Big Data Analytics, 2023-24. Discipline core laboratory course MCSE501P: Data Structures and Algorithms LAB (1 credit, 30 laboratory hours). Prerequisite: NIL. Prescribed text: Cormen, Leiserson, Rivest & Stein, Introduction to Algorithms, 4th edition, MIT Press, 2022.",
    "Course objectives: (1) to familiarise the concepts of data structures and algorithms focusing on space and time complexity; (2) to provide a deeper insight into the basic and advanced data structures; (3) to develop the knowledge for the application of advanced trees and graphs in real-world scenarios.",
    "Course outcomes — upon completion of the course the student will be able to: (1) understand and analyse the space and time complexity of algorithms; (2) identify a suitable data structure for a given problem; (3) implement graph algorithms in various real-life applications; (4) implement heaps and trees for querying and searching; (5) use basic data structures in advanced data structure operations; (6) use searching and sorting in various real-life applications.",
    "Mode of evaluation as written in the handbook: CAT / Mid-Term Lab / FAT. The twelve experiments listed in the course are indicative.",
  ].join("\n\n")
}

function daaTheoryDescription(): string {
  return [
    "M.Tech (CSE) — Specialisation in Big Data Analytics, 2023-24. Discipline core course MCSE502L: Design and Analysis of Algorithms (3 credits, 45 lecture hours). Prerequisite: NIL. Prescribed text: Cormen, Leiserson, Rivest & Stein, Introduction to Algorithms, 4th edition, MIT Press, 2022.",
    "Course objectives: (1) to provide a mathematical framework for the design and analysis of algorithms; (2) to disseminate knowledge on how to create strategies for dealing with real-world problems; (3) to develop efficient algorithms for use in a variety of engineering design settings.",
    "Course outcomes — on completion of this course the student should be able to: (1) apply knowledge of computing and mathematics to algorithm design; (2) apply various algorithm paradigms to solve scientific and real-life problems; (3) demonstrate the string matching and network flow algorithms relating to real-life problems; (4) understand and apply geometric algorithms; (5) apply linear optimisation techniques to various real-world linear optimisation problems; (6) explain the hardness of real-world problems with respect to algorithmic design.",
    "Eight modules over 45 hours: Greedy, Divide and Conquer Techniques (6h), Dynamic Programming, Backtracking and Branch & Bound Techniques (9h), Amortized Analysis and String Matching Algorithms (6h), Network Flow Algorithms (6h), Computational Geometry (5h), Linear Optimization and Randomized Algorithms (5h), NP Completeness and Approximation Algorithms (6h), Contemporary Issues (2h).",
  ].join("\n\n")
}

function daaLabDescription(): string {
  return [
    "M.Tech (CSE) — Specialisation in Big Data Analytics, 2023-24. Discipline core laboratory course MCSE502P: Design and Analysis of Algorithms Lab (1 credit, 30 laboratory hours). Prerequisite: NIL. Prescribed text: Cormen, Leiserson, Rivest & Stein, Introduction to Algorithms, 4th edition, MIT Press, 2022.",
    "Course objectives: (1) to provide a mathematical framework for the design and analysis of algorithms; (2) to disseminate knowledge on how to create strategies for dealing with real-world problems; (3) to develop efficient algorithms for use in a variety of engineering design settings.",
    "Course outcomes — on completion of this course the student should be able to: (1) apply knowledge of computing and mathematics to algorithm design; (2) apply various algorithm paradigms to solve scientific and real-life problems; (3) demonstrate the string matching and network flow algorithms relating to real-life problems; (4) understand and apply geometric algorithms; (5) apply linear optimisation techniques to various real-world linear optimisation problems; (6) explain the hardness of real-world problems with respect to algorithmic design.",
    "Mode of evaluation as written in the handbook: CAT / Mid-Term Lab / FAT. The twelve experiments listed in the course are indicative.",
  ].join("\n\n")
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

/**
 * Remove the previous course graph, in dependency order.
 *
 * The ids are enumerated for the models whose foreign keys are `onDelete: SetNull`, because a
 * `SetNull` link does not delete the child — it strips the link and leaves a row that is
 * indistinguishable from an intentionally unscoped one. That is why `Material` and the code-eval
 * rows are deleted by id rather than by relying on a parent cascade.
 *
 * `AuditLog` has no foreign keys by design, so its rows are cleared explicitly. The system-actor
 * rows the grading pipeline writes are cleared by **our** entity ids rather than by entity type,
 * so this seed never touches another seed's audit trail when both live in one database.
 */
async function deleteCoursesData(): Promise<void> {
  const userIds = [TEACHER_DSA_USER_ID, TEACHER_DAA_USER_ID, ...STUDENT_USER_IDS]

  const [grades, suggestions, reviews] = await Promise.all([
    prisma.grade.findMany({
      where: { assessmentId: { in: ASSESSMENT_IDS } },
      select: { id: true },
    }),
    prisma.aIGradeSuggestion.findMany({
      where: { assessmentId: { in: ASSESSMENT_IDS } },
      select: { id: true },
    }),
    prisma.gradeReview.findMany({
      where: { assessmentId: { in: ASSESSMENT_IDS } },
      select: { id: true },
    }),
  ])

  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorId: { in: userIds } },
        { entityType: "Grade", entityId: { in: grades.map((row) => row.id) } },
        { entityType: "GradeReview", entityId: { in: reviews.map((row) => row.id) } },
        {
          entityType: "AIGradeSuggestion",
          entityId: { in: suggestions.map((row) => row.id) },
        },
      ],
    },
  })

  // Assessments cascade their questions, submissions, grades, reviews, suggestions, code tasks,
  // test cases, test runs and similarity checks.
  await prisma.assessment.deleteMany({ where: { id: { in: ASSESSMENT_IDS } } })
  // Materials cascade their chunks. Deleted by id because `Material.offeringId` is SetNull.
  await prisma.material.deleteMany({ where: { id: { in: MATERIAL_IDS } } })
  // Offerings cascade enrollments; every Restrict reference to a teacher or a course goes with it.
  await prisma.courseOffering.deleteMany({ where: { id: { in: ALL_OFFERING_IDS } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.classRoom.deleteMany({
    where: { id: { in: [DSA_CLASS_A_ID, DSA_CLASS_B_ID, DAA_CLASS_A_ID] } },
  })
  await prisma.course.deleteMany({ where: { id: { in: COURSE_IDS } } })
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

async function createPeople(passwordHash: string): Promise<void> {
  await prisma.user.create({
    data: {
      id: TEACHER_DSA_USER_ID,
      email: COURSES_ACCOUNTS.teacherDsa.email,
      passwordHash,
      role: "TEACHER",
      staffProfile: {
        create: {
          id: TEACHER_DSA_STAFF_ID,
          fullName: "Dr. Ananya Deshpande",
          empId: "VIT-MCSE501",
        },
      },
    },
  })

  await prisma.user.create({
    data: {
      id: TEACHER_DAA_USER_ID,
      email: COURSES_ACCOUNTS.teacherDaa.email,
      passwordHash,
      role: "TEACHER",
      staffProfile: {
        create: {
          id: TEACHER_DAA_STAFF_ID,
          fullName: "Dr. Rohan Iyer",
          empId: "VIT-MCSE502",
        },
      },
    },
  })

  for (const [index, student] of STUDENTS.entries()) {
    await prisma.user.create({
      data: {
        id: STUDENT_USER_IDS[index],
        email: COURSES_ACCOUNTS.students[index].email,
        passwordHash,
        role: "STUDENT",
        studentProfile: {
          create: {
            id: STUDENT_PROFILE_IDS[index],
            fullName: student.fullName,
            registerNumber: student.registerNumber,
            formationProfile: {
              attributes: { programme: "M.Tech CSE (BDA)", registerNumber: student.registerNumber },
            },
          },
        },
      },
    })
  }
}

async function createCoursesAndOfferings(): Promise<void> {
  await prisma.course.create({
    data: {
      id: DSA_THEORY_COURSE_ID,
      code: "MCSE501L",
      name: "Data Structures and Algorithms",
      description: dsaTheoryDescription(),
      credits: 3,
      // Decides the grading regime: theory is relatively graded above 10 students.
      category: "THEORY",
      subtopicVocabulary: [...COURSE_SUBTOPIC_VOCABULARY.dsaTheory],
    },
  })
  await prisma.course.create({
    data: {
      id: DSA_LAB_COURSE_ID,
      code: "MCSE501P",
      name: "Data Structures and Algorithms LAB",
      description: dsaLabDescription(),
      credits: 1,
      // Absolute at any size, whatever the headcount.
      category: "LABORATORY",
      subtopicVocabulary: [...COURSE_SUBTOPIC_VOCABULARY.dsaLab],
    },
  })
  await prisma.course.create({
    data: {
      id: DAA_THEORY_COURSE_ID,
      code: "MCSE502L",
      name: "Design and Analysis of Algorithms",
      description: daaTheoryDescription(),
      credits: 3,
      category: "THEORY",
      subtopicVocabulary: [...COURSE_SUBTOPIC_VOCABULARY.daaTheory],
    },
  })
  await prisma.course.create({
    data: {
      id: DAA_LAB_COURSE_ID,
      code: "MCSE502P",
      name: "Design and Analysis of Algorithms Lab",
      description: daaLabDescription(),
      credits: 1,
      category: "LABORATORY",
      subtopicVocabulary: [...COURSE_SUBTOPIC_VOCABULARY.daaLab],
    },
  })

  /**
   * The section convention: `MCSE-BDA-<year>-<course>-<section>`.
   *
   * DSA has two sections (A and B) because the cohort is split across them; DAA has one. The lab
   * offerings share the classroom of their theory offering, which is what makes the lab's
   * enrolment set identical to the theory's.
   */
  await prisma.classRoom.createMany({
    data: [
      {
        id: DSA_CLASS_A_ID,
        code: "MCSE-BDA-2026-DSA-A",
        name: "M.Tech (CSE) BDA — DSA — Section A",
        section: "A",
        academicYear: ACADEMIC_YEAR,
      },
      {
        id: DSA_CLASS_B_ID,
        code: "MCSE-BDA-2026-DSA-B",
        name: "M.Tech (CSE) BDA — DSA — Section B",
        section: "B",
        academicYear: ACADEMIC_YEAR,
      },
      {
        id: DAA_CLASS_A_ID,
        code: "MCSE-BDA-2026-DAA-A",
        name: "M.Tech (CSE) BDA — DAA — Section A",
        section: "A",
        academicYear: ACADEMIC_YEAR,
      },
    ],
  })

  const offeringRows = [
    {
      id: OFFERING_DSA_L_A,
      courseId: DSA_THEORY_COURSE_ID,
      classId: DSA_CLASS_A_ID,
      teacherId: TEACHER_DSA_STAFF_ID,
    },
    {
      id: OFFERING_DSA_L_B,
      courseId: DSA_THEORY_COURSE_ID,
      classId: DSA_CLASS_B_ID,
      teacherId: TEACHER_DSA_STAFF_ID,
    },
    {
      id: OFFERING_DSA_P_A,
      courseId: DSA_LAB_COURSE_ID,
      classId: DSA_CLASS_A_ID,
      teacherId: TEACHER_DSA_STAFF_ID,
    },
    {
      id: OFFERING_DSA_P_B,
      courseId: DSA_LAB_COURSE_ID,
      classId: DSA_CLASS_B_ID,
      teacherId: TEACHER_DSA_STAFF_ID,
    },
    {
      id: OFFERING_DAA_L_A,
      courseId: DAA_THEORY_COURSE_ID,
      classId: DAA_CLASS_A_ID,
      teacherId: TEACHER_DAA_STAFF_ID,
    },
    {
      id: OFFERING_DAA_P_A,
      courseId: DAA_LAB_COURSE_ID,
      classId: DAA_CLASS_A_ID,
      teacherId: TEACHER_DAA_STAFF_ID,
    },
  ] as const

  for (const offering of offeringRows) {
    await prisma.courseOffering.create({
      data: {
        id: offering.id,
        courseId: offering.courseId,
        classId: offering.classId,
        teacherId: offering.teacherId,
        term: TERM,
        academicYear: ACADEMIC_YEAR,
        studentLimit: 40,
        startsOn: TERM_START,
        endsOn: TERM_END,
      },
    })
  }

  /**
   * The enrolments, and the two inactive rows that must not be counted.
   *
   * `DROPPED_STUDENT_INDEX` (30) has an inactive enrolment in DSA section B and its lab;
   * `WITHDRAWN_STUDENT_INDEX` (31) has one in DAA section A and its lab. Both are therefore in
   * the pool but not in any `enrolledCount`, which is the fixture that distinguishes a reader
   * filtering on `status` from one that is not.
   */
  const enrollments: { studentId: string; offeringId: string; status: string }[] = []
  const addActive = (studentIndex: number, offeringId: string) =>
    enrollments.push({
      studentId: STUDENT_PROFILE_IDS[studentIndex],
      offeringId,
      status: "active",
    })

  for (const index of DSA_SECTION_A_INDEXES) {
    addActive(index, OFFERING_DSA_L_A)
    addActive(index, OFFERING_DSA_P_A)
  }
  for (const index of DSA_SECTION_B_INDEXES) {
    addActive(index, OFFERING_DSA_L_B)
    addActive(index, OFFERING_DSA_P_B)
  }
  for (const index of DAA_SECTION_A_INDEXES) {
    addActive(index, OFFERING_DAA_L_A)
    addActive(index, OFFERING_DAA_P_A)
  }

  enrollments.push(
    {
      studentId: STUDENT_PROFILE_IDS[DROPPED_STUDENT_INDEX],
      offeringId: OFFERING_DSA_L_B,
      status: "dropped",
    },
    {
      studentId: STUDENT_PROFILE_IDS[DROPPED_STUDENT_INDEX],
      offeringId: OFFERING_DSA_P_B,
      status: "dropped",
    },
    {
      studentId: STUDENT_PROFILE_IDS[WITHDRAWN_STUDENT_INDEX],
      offeringId: OFFERING_DAA_L_A,
      status: "withdrawn",
    },
    {
      studentId: STUDENT_PROFILE_IDS[WITHDRAWN_STUDENT_INDEX],
      offeringId: OFFERING_DAA_P_A,
      status: "withdrawn",
    },
  )

  await prisma.enrollment.createMany({ data: enrollments })
}

async function createMaterials(): Promise<number> {
  const materials = [
    ...DSA_THEORY_MODULES.map((module) => ({
      id: `courses-material-mcse501l-m${module.module}`,
      courseId: DSA_THEORY_COURSE_ID,
      createdById: TEACHER_DSA_STAFF_ID,
      title: `MCSE501L Module ${module.module} — ${module.title} (${module.hours}h)`,
      contentText: module.contentText,
    })),
    ...DSA_LAB_EXPERIMENTS.map((experiment) => ({
      id: `courses-material-mcse501p-e${experiment.experiment}`,
      courseId: DSA_LAB_COURSE_ID,
      createdById: TEACHER_DSA_STAFF_ID,
      title: `MCSE501P Experiment ${experiment.experiment} — ${experiment.title}`,
      contentText: experiment.contentText,
    })),
    ...DAA_THEORY_MODULES.map((module) => ({
      id: `courses-material-mcse502l-m${module.module}`,
      courseId: DAA_THEORY_COURSE_ID,
      createdById: TEACHER_DAA_STAFF_ID,
      title: `MCSE502L Module ${module.module} — ${module.title} (${module.hours}h)`,
      contentText: module.contentText,
    })),
    ...DAA_LAB_EXPERIMENTS.map((experiment) => ({
      id: `courses-material-mcse502p-e${experiment.experiment}`,
      courseId: DAA_LAB_COURSE_ID,
      createdById: TEACHER_DAA_STAFF_ID,
      title: `MCSE502P Experiment ${experiment.experiment} — ${experiment.title}`,
      contentText: experiment.contentText,
    })),
  ]

  for (const material of materials) {
    await prisma.material.create({
      data: {
        id: material.id,
        courseId: material.courseId,
        // Course-wide: `offeringId: null` so both offerings of a course reach it.
        offeringId: null,
        createdById: material.createdById,
        title: material.title,
        kind: "DOCUMENT",
        mimeType: "text/plain",
        contentText: material.contentText,
      },
    })
  }

  return materials.length
}

type AssessmentSeed = {
  id: string
  offeringId: string
  courseId: string
  classId: string
  createdById: string
  title: string
  type: "QUIZ" | "ASSIGNMENT" | "DESCRIPTIVE" | "CODE"
  dueDate: Date
  maxMarks: number
  releasedAt: Date | null
}

async function createAssessments(): Promise<void> {
  const rows: AssessmentSeed[] = []

  const theoryRows = (input: {
    offeringId: string
    courseId: string
    classId: string
    createdById: string
    label: string
  }): AssessmentSeed[] => [
    {
      id: assessmentId(input.offeringId, "cat-quiz"),
      offeringId: input.offeringId,
      courseId: input.courseId,
      classId: input.classId,
      createdById: input.createdById,
      title: `${input.label} — CAT 1 (quiz)`,
      type: "QUIZ",
      dueDate: DUE_CAT1,
      maxMarks: THEORY_MAX_MARKS.cat1,
      releasedAt: RELEASED_CAT1,
    },
    {
      id: assessmentId(input.offeringId, "cat-assignment"),
      offeringId: input.offeringId,
      courseId: input.courseId,
      classId: input.classId,
      createdById: input.createdById,
      title: `${input.label} — CAT 2 (written assignment)`,
      type: "ASSIGNMENT",
      dueDate: DUE_CAT2,
      maxMarks: THEORY_MAX_MARKS.cat2,
      releasedAt: RELEASED_CAT2,
    },
    {
      id: assessmentId(input.offeringId, "cat-descriptive"),
      offeringId: input.offeringId,
      courseId: input.courseId,
      classId: input.classId,
      createdById: input.createdById,
      title: `${input.label} — CAT 3 (descriptive)`,
      type: "DESCRIPTIVE",
      dueDate: DUE_CAT3,
      maxMarks: THEORY_MAX_MARKS.cat3,
      releasedAt: RELEASED_CAT3,
    },
    {
      id: assessmentId(input.offeringId, "fat"),
      offeringId: input.offeringId,
      courseId: input.courseId,
      classId: input.classId,
      createdById: input.createdById,
      title: `${input.label} — FAT (final assessment)`,
      type: "DESCRIPTIVE",
      dueDate: DUE_FAT,
      maxMarks: THEORY_MAX_MARKS.fat,
      // Deliberately unreleased: the FAT has not opened yet, so a student must not see it while
      // its teacher still does. It is the "at least one unreleased" fixture.
      releasedAt: null,
    },
  ]

  rows.push(
    ...theoryRows({
      offeringId: OFFERING_DSA_L_A,
      courseId: DSA_THEORY_COURSE_ID,
      classId: DSA_CLASS_A_ID,
      createdById: TEACHER_DSA_STAFF_ID,
      label: "DSA Section A",
    }),
    ...theoryRows({
      offeringId: OFFERING_DSA_L_B,
      courseId: DSA_THEORY_COURSE_ID,
      classId: DSA_CLASS_B_ID,
      createdById: TEACHER_DSA_STAFF_ID,
      label: "DSA Section B",
    }),
    ...theoryRows({
      offeringId: OFFERING_DAA_L_A,
      courseId: DAA_THEORY_COURSE_ID,
      classId: DAA_CLASS_A_ID,
      createdById: TEACHER_DAA_STAFF_ID,
      label: "DAA Section A",
    }),
  )

  const labRows = (input: {
    offeringId: string
    courseId: string
    classId: string
    createdById: string
    label: string
  }): AssessmentSeed[] => [
    {
      id: assessmentId(input.offeringId, "cat-lab"),
      offeringId: input.offeringId,
      courseId: input.courseId,
      classId: input.classId,
      createdById: input.createdById,
      title: `${input.label} — CAT (lab record and exercises)`,
      type: "ASSIGNMENT",
      dueDate: DUE_CAT1,
      maxMarks: LAB_MAX_MARKS.cat,
      releasedAt: RELEASED_CAT1,
    },
    {
      // The handbook's second lab component, the Mid-Term Lab, is not dropped: the platform has
      // one CAT pool, so it is seeded as a CAT assessment. See the file docblock.
      id: assessmentId(input.offeringId, "cat-midterm-code"),
      offeringId: input.offeringId,
      courseId: input.courseId,
      classId: input.classId,
      createdById: input.createdById,
      title: `${input.label} — Mid-Term Lab (code task)`,
      type: "CODE",
      dueDate: DUE_CAT3,
      maxMarks: LAB_MAX_MARKS.midterm,
      releasedAt: RELEASED_CAT3,
    },
    {
      id: assessmentId(input.offeringId, "fat"),
      offeringId: input.offeringId,
      courseId: input.courseId,
      classId: input.classId,
      createdById: input.createdById,
      title: `${input.label} — FAT (final lab assessment)`,
      type: "DESCRIPTIVE",
      dueDate: DUE_FAT,
      maxMarks: LAB_MAX_MARKS.fat,
      releasedAt: null,
    },
  ]

  rows.push(
    ...labRows({
      offeringId: OFFERING_DSA_P_A,
      courseId: DSA_LAB_COURSE_ID,
      classId: DSA_CLASS_A_ID,
      createdById: TEACHER_DSA_STAFF_ID,
      label: "DSA Lab Section A",
    }),
    ...labRows({
      offeringId: OFFERING_DSA_P_B,
      courseId: DSA_LAB_COURSE_ID,
      classId: DSA_CLASS_B_ID,
      createdById: TEACHER_DSA_STAFF_ID,
      label: "DSA Lab Section B",
    }),
    ...labRows({
      offeringId: OFFERING_DAA_P_A,
      courseId: DAA_LAB_COURSE_ID,
      classId: DAA_CLASS_A_ID,
      createdById: TEACHER_DAA_STAFF_ID,
      label: "DAA Lab Section A",
    }),
  )

  for (const row of rows) {
    await prisma.assessment.create({ data: row })
  }
}

/**
 * Store the CAT/FAT policy through the real service, so each offering gets the audit row the
 * write path produces.
 *
 * **The weights are platform policy, not handbook facts** — the handbook states no numbers for
 * assessment at all. `CAT 40 / FAT 60` with a 30% CAT minimum is `lib/grading/policy.ts`'s
 * default, and the FAT is named explicitly via `finalAssessmentId` rather than left to the
 * due-date heuristic, which would pick the same assessment here but by accident.
 */
async function configureGrading(): Promise<void> {
  const teacherDsa = teacherUser(TEACHER_DSA_USER_ID, COURSES_ACCOUNTS.teacherDsa.email)
  const teacherDaa = teacherUser(TEACHER_DAA_USER_ID, COURSES_ACCOUNTS.teacherDaa.email)

  const configs = [
    { teacher: teacherDsa, offeringId: OFFERING_DSA_L_A },
    { teacher: teacherDsa, offeringId: OFFERING_DSA_L_B },
    { teacher: teacherDsa, offeringId: OFFERING_DSA_P_A },
    { teacher: teacherDsa, offeringId: OFFERING_DSA_P_B },
    { teacher: teacherDaa, offeringId: OFFERING_DAA_L_A },
    { teacher: teacherDaa, offeringId: OFFERING_DAA_P_A },
  ] as const

  for (const { teacher, offeringId } of configs) {
    const result = await setOfferingGradingForTeacher(teacher, offeringId, {
      catWeight: 40,
      fatWeight: 60,
      finalAssessmentId: assessmentId(offeringId, "fat"),
      minimumCatPercent: 30,
    })
    if (result.kind !== "ok") {
      throw new Error(`Could not configure grading for ${offeringId}: ${result.kind}`)
    }
  }
}

type TestCaseSeed = {
  order: number
  name: string
  description: string
  category: "unit" | "structure"
  input: string
  expectedOutput: string | null
  isHidden: boolean
  points: number
}

type CodeTaskSeed = {
  offeringId: string
  instructions: string
  starterCode: string
  testCases: TestCaseSeed[]
}

/**
 * The lab experiments seeded as code tasks.
 *
 * The handbook's experiment list is explicitly **indicative**, so the test cases here are seed
 * fiction written to exercise the code-eval spine; they are not handbook content. Two lab
 * offerings share the DSA task (sections A and B of the same course).
 */
const CODE_TASK_SEEDS: CodeTaskSeed[] = [
  {
    offeringId: OFFERING_DSA_P_A,
    instructions:
      "Experiment 9 (graph traversals). Implement `bfs_order(adjacency, start)` returning the vertices in breadth-first order, starting at `start`. `adjacency` is an adjacency list given as a JSON array of arrays.",
    starterCode:
      "def bfs_order(adjacency, start):\n    # TODO: return the breadth-first traversal order\n    return []\n",
    testCases: [
      {
        order: 0,
        name: "Two-level graph",
        description: "Breadth-first order of a 4-vertex graph from vertex 0.",
        category: "unit",
        input: JSON.stringify({
          function: "bfs_order",
          args: [
            [
              [1, 2],
              [0, 3],
              [0, 3],
              [1, 2],
            ],
            0,
          ],
        }),
        expectedOutput: "[0, 1, 2, 3]",
        isHidden: false,
        points: 10,
      },
      {
        order: 1,
        name: "Disconnected vertex",
        description: "A vertex not reachable from the start is omitted, not appended last.",
        category: "unit",
        input: JSON.stringify({ function: "bfs_order", args: [[[1], [0], []], 0] }),
        expectedOutput: "[0, 1]",
        isHidden: true,
        points: 10,
      },
      {
        order: 2,
        name: "Structure check",
        description: "The submission defines a function and stays within the line budget.",
        category: "structure",
        input: JSON.stringify({ mustContain: ["def bfs_order"], maxLines: 30 }),
        expectedOutput: null,
        isHidden: true,
        points: 10,
      },
    ],
  },
  {
    offeringId: OFFERING_DSA_P_B,
    instructions:
      "Experiment 9 (graph traversals). Implement `bfs_order(adjacency, start)` returning the vertices in breadth-first order, starting at `start`. `adjacency` is an adjacency list given as a JSON array of arrays.",
    starterCode:
      "def bfs_order(adjacency, start):\n    # TODO: return the breadth-first traversal order\n    return []\n",
    testCases: [
      {
        order: 0,
        name: "Two-level graph",
        description: "Breadth-first order of a 4-vertex graph from vertex 0.",
        category: "unit",
        input: JSON.stringify({
          function: "bfs_order",
          args: [
            [
              [1, 2],
              [0, 3],
              [0, 3],
              [1, 2],
            ],
            0,
          ],
        }),
        expectedOutput: "[0, 1, 2, 3]",
        isHidden: false,
        points: 10,
      },
      {
        order: 1,
        name: "Disconnected vertex",
        description: "A vertex not reachable from the start is omitted, not appended last.",
        category: "unit",
        input: JSON.stringify({ function: "bfs_order", args: [[[1], [0], []], 0] }),
        expectedOutput: "[0, 1]",
        isHidden: true,
        points: 10,
      },
      {
        order: 2,
        name: "Structure check",
        description: "The submission defines a function and stays within the line budget.",
        category: "structure",
        input: JSON.stringify({ mustContain: ["def bfs_order"], maxLines: 30 }),
        expectedOutput: null,
        isHidden: true,
        points: 10,
      },
    ],
  },
  {
    offeringId: OFFERING_DAA_P_A,
    instructions:
      "Experiment 3 (dynamic programming). Implement `knapsack(weights, values, capacity)` returning the maximum total value of a 0-1 knapsack.",
    starterCode:
      "def knapsack(weights, values, capacity):\n    # TODO: return the maximum value\n    return 0\n",
    testCases: [
      {
        order: 0,
        name: "Three items",
        description: "Classic instance: capacity 5, weights (1, 2, 3), values (6, 10, 12).",
        category: "unit",
        input: JSON.stringify({ function: "knapsack", args: [[1, 2, 3], [6, 10, 12], 5] }),
        expectedOutput: "22",
        isHidden: false,
        points: 10,
      },
      {
        order: 1,
        name: "Zero capacity",
        description: "No item fits, so the value is zero.",
        category: "unit",
        input: JSON.stringify({ function: "knapsack", args: [[2, 3], [5, 9], 0] }),
        expectedOutput: "0",
        isHidden: true,
        points: 10,
      },
      {
        order: 2,
        name: "Structure check",
        description: "The submission defines a function and stays within the line budget.",
        category: "structure",
        input: JSON.stringify({ mustContain: ["def knapsack"], maxLines: 30 }),
        expectedOutput: null,
        isHidden: true,
        points: 10,
      },
    ],
  },
]

/**
 * Seed the code tasks, their test cases, and one finished run so the code-eval surface renders
 * real evidence.
 *
 * `resultsJson` is written with `toRunEvidenceJson`, the shape `readRunEvidence` parses, and
 * `finishedAt` is set — the two things the demo seed's run got wrong and reviewers caught.
 */
async function createCodeTasks(): Promise<void> {
  for (const seed of CODE_TASK_SEEDS) {
    const taskId = `${seed.offeringId}-code-task`
    const assessmentIdForTask = assessmentId(seed.offeringId, "cat-midterm-code")
    await prisma.codeTask.create({
      data: {
        id: taskId,
        assessmentId: assessmentIdForTask,
        language: "python",
        instructions: seed.instructions,
        starterCode: seed.starterCode,
        timeLimitMs: 5000,
        memoryLimitMb: 256,
        metadata: { generator: "code-eval", maxSubmissions: 3, draftTestCaseIds: [] },
      },
    })

    const createdTestCases: {
      id: string
      name: string
      category: TestResult["category"]
      points: number
    }[] = []

    for (const testCase of seed.testCases) {
      const created = await prisma.testCase.create({
        data: { codeTaskId: taskId, ...testCase },
        select: { id: true, name: true, category: true, points: true },
      })
      createdTestCases.push({
        id: created.id,
        name: created.name,
        category: created.category as TestResult["category"],
        points: Number(created.points),
      })
    }

    // One finished, readable run for the first DSA lab section, so at least one seeded run has
    // legible evidence rather than only the task definition.
    if (seed.offeringId !== OFFERING_DSA_P_A) continue

    const submission = await prisma.submission.create({
      data: {
        assessmentId: assessmentIdForTask,
        studentId: STUDENT_PROFILE_IDS[DSA_SECTION_A_INDEXES[0]],
        status: "SUBMITTED",
        submittedAt: fromNow(-13, 10),
        contentText:
          "def bfs_order(adjacency, start):\n    from collections import deque\n    order = []\n    seen = {start}\n    queue = deque([start])\n    while queue:\n        node = queue.popleft()\n        order.append(node)\n        for nxt in adjacency[node]:\n            if nxt not in seen:\n                seen.add(nxt)\n                queue.append(nxt)\n    return order\n",
      },
    })

    const runFinishedAt = fromNow(-13, 11)
    await prisma.testRun.create({
      data: {
        codeTaskId: taskId,
        studentId: STUDENT_PROFILE_IDS[DSA_SECTION_A_INDEXES[0]],
        submissionId: submission.id,
        status: "PASSED",
        language: "python",
        passedCount: 3,
        failedCount: 0,
        totalCount: 3,
        runtimeMs: 168,
        startedAt: new Date(runFinishedAt.getTime() - 2000),
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
            durationMs: 52,
          })),
          timedOut: false,
          memoryExceeded: false,
          killMessage: null,
        }) as unknown as Prisma.InputJsonValue,
      },
    })
  }
}

// ---------------------------------------------------------------------------
// Marks
// ---------------------------------------------------------------------------

/** A student's published CAT percentages, in the offering's CAT order. */
type CatMarkRow = {
  studentIndex: number
  percentages: number[]
}

function toPoints(percentage: number, maxMarks: number): number {
  return Math.round((percentage / 100) * maxMarks)
}

/**
 * DSA section A (9 enrolled). Two CATs published for everyone, so the offering has 9 published
 * totals. It never reaches the metrics check: `enrolledCount < 11` returns `small-class` first.
 * Student 8 is deliberately below the 30% CAT gate.
 */
const DSA_SECTION_A_MARKS: CatMarkRow[] = [
  { studentIndex: 0, percentages: [72, 65] },
  { studentIndex: 1, percentages: [64, 70] },
  { studentIndex: 2, percentages: [81, 76] },
  { studentIndex: 3, percentages: [55, 48] },
  { studentIndex: 4, percentages: [90, 86] },
  { studentIndex: 5, percentages: [68, 61] },
  { studentIndex: 6, percentages: [47, 52] },
  { studentIndex: 7, percentages: [76, 80] },
  { studentIndex: 8, percentages: [18, 22] },
]

/** The DSA section B students whose CAT 3 is graded by the AI/rubric pipeline. */
const DSA_SECTION_B_AI_INDEXES = [9, 10, 11]

/**
 * DSA section B (15 enrolled). CAT 1 and CAT 2 are published for 13 students, which is 13
 * published totals — above the 11 needed for relative grading, with a non-zero spread by
 * construction. Students 22 and 23 have no published marks at all, so they are excluded from the
 * totals rather than counted as zero.
 *
 * CAT 3 (`cat3: null`) is published by the rubric pipeline for students 9-11; for 12-21 the
 * percentage here is published by hand. Student 21 is deliberately below the CAT gate.
 */
const DSA_SECTION_B_MARKS: CatMarkRow[] = [
  { studentIndex: 9, percentages: [78, 71] },
  { studentIndex: 10, percentages: [66, 70] },
  { studentIndex: 11, percentages: [85, 79] },
  { studentIndex: 12, percentages: [59, 63, 61] },
  { studentIndex: 13, percentages: [92, 88, 90] },
  { studentIndex: 14, percentages: [74, 69, 77] },
  { studentIndex: 15, percentages: [51, 58, 55] },
  { studentIndex: 16, percentages: [83, 80, 78] },
  { studentIndex: 17, percentages: [45, 52, 49] },
  { studentIndex: 18, percentages: [69, 75, 72] },
  { studentIndex: 19, percentages: [88, 84, 86] },
  { studentIndex: 20, percentages: [62, 57, 60] },
  { studentIndex: 21, percentages: [24, 27, 23] },
]

/**
 * DAA section A (12 enrolled). Only 6 students have published totals, so the offering lands on
 * `awaiting-base-metrics`: it is large enough for relative grading but there is not yet a base
 * to compute a mean and sigma from.
 */
const DAA_SECTION_A_MARKS: CatMarkRow[] = [
  { studentIndex: 0, percentages: [70, 66] },
  { studentIndex: 1, percentages: [58, 62] },
  { studentIndex: 2, percentages: [85, 81] },
  { studentIndex: 3, percentages: [47, 53] },
  { studentIndex: 4, percentages: [76, 72] },
  { studentIndex: 5, percentages: [64, 59] },
]

/** Lab CAT marks: a handful per lab offering, enough for the offerings to have published grades. */
const LAB_CAT_MARKS: Record<string, CatMarkRow[]> = {
  [OFFERING_DSA_P_A]: [
    { studentIndex: 0, percentages: [80] },
    { studentIndex: 1, percentages: [72] },
    { studentIndex: 2, percentages: [65] },
    { studentIndex: 3, percentages: [88] },
    { studentIndex: 4, percentages: [55] },
  ],
  [OFFERING_DSA_P_B]: [
    { studentIndex: 9, percentages: [76] },
    { studentIndex: 10, percentages: [68] },
    { studentIndex: 11, percentages: [84] },
    { studentIndex: 12, percentages: [59] },
    { studentIndex: 13, percentages: [91] },
    { studentIndex: 14, percentages: [70] },
  ],
  [OFFERING_DAA_P_A]: [
    { studentIndex: 0, percentages: [82] },
    { studentIndex: 1, percentages: [74] },
    { studentIndex: 2, percentages: [61] },
    { studentIndex: 3, percentages: [88] },
    { studentIndex: 4, percentages: [69] },
  ],
}

async function publishTheoryMarks(input: {
  offeringId: string
  actor: SeedTeacher
  rows: CatMarkRow[]
  maxMarks: readonly number[]
  catSuffixes: readonly string[]
}): Promise<void> {
  for (const row of input.rows) {
    for (const [position, percentage] of row.percentages.entries()) {
      const maxMarks = input.maxMarks[position]
      await recordManualMark({
        assessmentId: assessmentId(input.offeringId, input.catSuffixes[position]),
        studentId: STUDENT_PROFILE_IDS[row.studentIndex],
        points: toPoints(percentage, maxMarks),
        maxPoints: maxMarks,
        actor: input.actor,
      })
    }
  }
}

async function publishLabMarks(input: {
  offeringId: string
  actor: SeedTeacher
  rows: CatMarkRow[]
}): Promise<void> {
  for (const row of input.rows) {
    await recordManualMark({
      assessmentId: assessmentId(input.offeringId, "cat-lab"),
      studentId: STUDENT_PROFILE_IDS[row.studentIndex],
      points: toPoints(row.percentages[0], LAB_MAX_MARKS.cat),
      maxPoints: LAB_MAX_MARKS.cat,
      actor: input.actor,
    })
  }
}

/**
 * The CAT 3 rubric for DSA section B, and the three submissions the model grades.
 *
 * This must run **before any CAT 3 grade is published**: `upsertRubricForTeacher` refuses to
 * change a rubric once a grade has been published against it, because the rubric is the binding
 * grading contract. The manual CAT 3 marks and the accept decisions therefore happen after this
 * function, not before.
 *
 * The rubric criteria sum to the assessment's 50 marks. The mock provider scores each submission
 * deterministically; the drafts it writes are unpublished until a human accepts.
 */
async function createCat3RubricAndDrafts(): Promise<void> {
  const teacherDsa = teacherUser(TEACHER_DSA_USER_ID, COURSES_ACCOUNTS.teacherDsa.email)
  const cat3AssessmentId = assessmentId(OFFERING_DSA_L_B, "cat-descriptive")

  await upsertRubricForTeacher(teacherDsa, {
    assessmentId: cat3AssessmentId,
    title: "Algorithm analysis — written response",
    description: "Explains an algorithm's design and its asymptotic behaviour with justification.",
    maxPoints: 50,
    criteria: [
      {
        label: "Correctness of the algorithm",
        description: "The described algorithm solves the stated problem.",
        weight: 1,
        maxPoints: 30,
        levels: [
          { label: "Exemplary", descriptor: "Correct with edge cases addressed.", points: 30 },
          { label: "Developing", descriptor: "Correct on the main case.", points: 18 },
          { label: "Beginning", descriptor: "Incorrect or incomplete.", points: 6 },
        ],
      },
      {
        label: "Complexity analysis",
        description: "The running time is derived and justified, not asserted.",
        weight: 1,
        maxPoints: 20,
        levels: [
          { label: "Exemplary", descriptor: "Derivation is explicit and correct.", points: 20 },
          {
            label: "Developing",
            descriptor: "Correct result with thin justification.",
            points: 12,
          },
          { label: "Beginning", descriptor: "States a bound without deriving it.", points: 4 },
        ],
      },
    ],
  })

  const submissions = [
    {
      studentIndex: 9,
      contentText:
        "The algorithm builds a maximum heap and then repeatedly extracts the maximum. Building the heap is linear because the sum of the per-node costs telescopes, and each extraction costs logarithmic time, so the whole sort is O(n log n). The bound is tight because every comparison sort requires at least n log n comparisons in the worst case.",
    },
    {
      studentIndex: 10,
      contentText:
        "To find the longest common subsequence I fill a table where each cell holds the length of the LCS of a prefix pair. The recurrence takes the diagonal value when the characters match and the better of the two neighbours when they do not, so filling the table is O(mn) and the trace-back is O(m + n).",
    },
    {
      studentIndex: 11,
      contentText:
        "I would use dynamic programming over the items and the capacity. The table has one row per item, and each cell is the better of taking the item or leaving it, so the running time is proportional to the number of items times the capacity.",
    },
  ] as const

  for (const submission of submissions) {
    const created = await prisma.submission.create({
      data: {
        assessmentId: cat3AssessmentId,
        studentId: STUDENT_PROFILE_IDS[submission.studentIndex],
        status: "SUBMITTED",
        submittedAt: fromNow(-15, 14),
        contentText: submission.contentText,
      },
    })
    // The explicit provider keeps the evaluation offline and reproducible.
    await evaluateSubmissionForTeacher(teacherDsa, created.id, { provider: createMockProvider() })
  }
}

/**
 * Publish the CAT 3 grades the rubric pipeline did not.
 *
 * Students 9–11 are graded by the model; students 12–21 have their percentage published by hand.
 * Student 11's draft is deliberately left for the review queue.
 */
async function publishDsaSectionBCat3Manual(): Promise<void> {
  const teacherDsa = teacherUser(TEACHER_DSA_USER_ID, COURSES_ACCOUNTS.teacherDsa.email)

  for (const row of DSA_SECTION_B_MARKS) {
    if (row.percentages.length < 3) continue
    if (DSA_SECTION_B_AI_INDEXES.includes(row.studentIndex)) continue
    await recordManualMark({
      assessmentId: assessmentId(OFFERING_DSA_L_B, "cat-descriptive"),
      studentId: STUDENT_PROFILE_IDS[row.studentIndex],
      points: toPoints(row.percentages[2], THEORY_MAX_MARKS.cat3),
      maxPoints: THEORY_MAX_MARKS.cat3,
      actor: teacherDsa,
    })
  }
}

/**
 * Two human accepts publish the model's CAT 3 drafts. Student 11 is left `PENDING`, so the
 * review queue has real work and the offering has an unpublished draft that must not count.
 */
async function acceptCat3Drafts(): Promise<void> {
  for (const studentIndex of [9, 10]) {
    await submitReviewDecision({
      assessmentId: assessmentId(OFFERING_DSA_L_B, "cat-descriptive"),
      studentId: STUDENT_PROFILE_IDS[studentIndex],
      reviewer: { id: TEACHER_DSA_USER_ID, role: "teacher" },
      decision: { action: "accept" },
    })
  }
}

async function publishMarks(): Promise<void> {
  const teacherDsa = teacherUser(TEACHER_DSA_USER_ID, COURSES_ACCOUNTS.teacherDsa.email)
  const teacherDaa = teacherUser(TEACHER_DAA_USER_ID, COURSES_ACCOUNTS.teacherDaa.email)

  await publishTheoryMarks({
    offeringId: OFFERING_DSA_L_A,
    actor: teacherDsa,
    rows: DSA_SECTION_A_MARKS,
    maxMarks: [THEORY_MAX_MARKS.cat1, THEORY_MAX_MARKS.cat2],
    catSuffixes: ["cat-quiz", "cat-assignment"],
  })

  await publishTheoryMarks({
    offeringId: OFFERING_DAA_L_A,
    actor: teacherDaa,
    rows: DAA_SECTION_A_MARKS,
    maxMarks: [THEORY_MAX_MARKS.cat1, THEORY_MAX_MARKS.cat2],
    catSuffixes: ["cat-quiz", "cat-assignment"],
  })

  // CAT 1 and CAT 2 for the 13 marked students of DSA section B.
  await publishTheoryMarks({
    offeringId: OFFERING_DSA_L_B,
    actor: teacherDsa,
    rows: DSA_SECTION_B_MARKS.map((row) => ({
      studentIndex: row.studentIndex,
      percentages: row.percentages.slice(0, 2),
    })),
    maxMarks: [THEORY_MAX_MARKS.cat1, THEORY_MAX_MARKS.cat2],
    catSuffixes: ["cat-quiz", "cat-assignment"],
  })

  // Rubric first, then the CAT 3 grades it grades against.
  await createCat3RubricAndDrafts()
  await publishDsaSectionBCat3Manual()
  await acceptCat3Drafts()

  for (const offeringId of LAB_OFFERING_IDS) {
    await publishLabMarks({
      offeringId,
      actor: offeringId === OFFERING_DAA_P_A ? teacherDaa : teacherDsa,
      rows: LAB_CAT_MARKS[offeringId],
    })
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function countSummary(): Promise<CoursesSeedSummary> {
  const [
    courses,
    offerings,
    students,
    activeEnrollments,
    inactiveEnrollments,
    assessments,
    releasedAssessments,
    publishedGrades,
    materials,
    materialChunks,
    rubricCriteria,
    aiSuggestions,
    codeTasks,
    testCases,
    testRuns,
  ] = await Promise.all([
    prisma.course.count({ where: { id: { in: COURSE_IDS } } }),
    prisma.courseOffering.count({ where: { id: { in: ALL_OFFERING_IDS } } }),
    prisma.studentProfile.count({ where: { id: { in: STUDENT_PROFILE_IDS } } }),
    prisma.enrollment.count({
      where: { offeringId: { in: ALL_OFFERING_IDS }, status: "active" },
    }),
    prisma.enrollment.count({
      where: { offeringId: { in: ALL_OFFERING_IDS }, status: { not: "active" } },
    }),
    prisma.assessment.count({ where: { id: { in: ASSESSMENT_IDS } } }),
    prisma.assessment.count({
      where: { id: { in: ASSESSMENT_IDS }, releasedAt: { not: null } },
    }),
    prisma.grade.count({
      where: { assessmentId: { in: ASSESSMENT_IDS }, publishedAt: { not: null } },
    }),
    prisma.material.count({ where: { id: { in: MATERIAL_IDS } } }),
    prisma.materialChunk.count({ where: { materialId: { in: MATERIAL_IDS } } }),
    prisma.rubricCriterion.count({
      where: { rubric: { assessmentId: assessmentId(OFFERING_DSA_L_B, "cat-descriptive") } },
    }),
    prisma.aIGradeSuggestion.count({
      where: { assessmentId: assessmentId(OFFERING_DSA_L_B, "cat-descriptive") },
    }),
    prisma.codeTask.count({ where: { id: { in: CODE_TASK_IDS } } }),
    prisma.testCase.count({ where: { codeTaskId: { in: CODE_TASK_IDS } } }),
    prisma.testRun.count({ where: { codeTaskId: { in: CODE_TASK_IDS } } }),
  ])

  return {
    courses,
    offerings,
    students,
    activeEnrollments,
    inactiveEnrollments,
    assessments,
    releasedAssessments,
    unpublishedAssessments: assessments - releasedAssessments,
    publishedGrades,
    materials,
    materialChunks,
    rubricCriteria,
    aiSuggestions,
    codeTasks,
    testCases,
    testRuns,
  }
}

/** Create (or recreate) the two courses. Safe to run repeatedly. */
export async function seedCourses(): Promise<CoursesSeedSummary> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set")
  }
  // Force the offline, deterministic provider regardless of the ambient env.
  process.env.LLM_PROVIDER = "mock"
  const provider = createMockProvider()

  await deleteCoursesData()

  const passwordHash = await bcrypt.hash(COURSES_PASSWORD, 10)
  await createPeople(passwordHash)
  await createCoursesAndOfferings()
  await createMaterials()
  await createAssessments()
  await configureGrading()
  await createCodeTasks()
  await publishMarks()

  // Index every course-wide material through the real pipeline, so retrieval and quiz generation
  // work offline against seeded content.
  for (const materialId of MATERIAL_IDS) {
    await indexMaterial(materialId, { provider, chunkOptions: { maxChars: 700, overlapChars: 80 } })
  }

  return countSummary()
}

const isDirectRun =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  seedCourses()
    .then((summary) => {
      console.log("Course seed complete")
      console.log(JSON.stringify(summary, null, 2))
      console.log(`DSA teacher: ${COURSES_ACCOUNTS.teacherDsa.email} / ${COURSES_PASSWORD}`)
      console.log(`DAA teacher: ${COURSES_ACCOUNTS.teacherDaa.email} / ${COURSES_PASSWORD}`)
      console.log(`Student: ${COURSES_ACCOUNTS.students[0].email} / ${COURSES_PASSWORD}`)
    })
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
    .finally(async () => {
      await prisma.$disconnect()
    })
}
