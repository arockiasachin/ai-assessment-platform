import { initialsFromName } from "./format"
import type { Assessment, Course, Rubric, Student } from "./types"

/**
 * Course spine for the mockups: one offering, its roster, its assessments, and
 * the rubric that binds descriptive grading.
 *
 * The averages here are DERIVED from a single marks table rather than typed in
 * twice, so a student's average, an assessment's average, and the cohort average
 * can never contradict the marks a reviewer can see on screen.
 */

const QUIZ_1_MAX = 20
const DESCRIPTIVE_MAX = 30

/** The two assessments that already have published marks. */
type MarkKey = "quiz1" | "descriptive"

type StudentSeed = {
  id: string
  name: string
  registerNumber: string
  email: string
  groupId: string | null
  groupName: string | null
  submittedCount: number
  missingCount: number
  atRisk: boolean
  lastActiveAt: string | null
  marks: Record<MarkKey, number | null>
}

/**
 * Deliberately awkward-but-real roster:
 *  - #10 has a four-part, very long name (table truncation);
 *  - #13 enrolled late: no submissions, no published marks, so `avgPercent` and
 *    `lastActiveAt` are both `null`;
 *  - #9 is academically at risk on low published marks.
 */
const STUDENT_SEEDS: StudentSeed[] = [
  {
    id: "stu_aarav",
    name: "Aarav Mehta",
    registerNumber: "22BDS0114",
    email: "aarav.mehta@vitstudent.ac.in",
    groupId: "grp_matrices",
    groupName: "Team Matrices",
    submittedCount: 4,
    missingCount: 0,
    atRisk: false,
    lastActiveAt: "2026-09-15T12:10:00.000Z",
    marks: { quiz1: 18, descriptive: 26 },
  },
  {
    id: "stu_beatriz",
    name: "Beatriz Oliveira",
    registerNumber: "22BDS0121",
    email: "beatriz.oliveira@vitstudent.ac.in",
    groupId: "grp_matrices",
    groupName: "Team Matrices",
    submittedCount: 3,
    missingCount: 1,
    atRisk: false,
    lastActiveAt: "2026-09-14T17:45:00.000Z",
    marks: { quiz1: 16, descriptive: 24 },
  },
  {
    id: "stu_chen",
    name: "Chen Wei",
    registerNumber: "22BDS0102",
    email: "chen.wei@vitstudent.ac.in",
    groupId: "grp_vectors",
    groupName: "Team Vectors",
    submittedCount: 4,
    missingCount: 0,
    atRisk: false,
    lastActiveAt: "2026-09-15T06:05:00.000Z",
    marks: { quiz1: 19, descriptive: 27 },
  },
  {
    id: "stu_diya",
    name: "Diya Nair",
    registerNumber: "22BDS0119",
    email: "diya.nair@vitstudent.ac.in",
    groupId: "grp_vectors",
    groupName: "Team Vectors",
    submittedCount: 3,
    missingCount: 1,
    atRisk: false,
    lastActiveAt: "2026-09-13T09:30:00.000Z",
    marks: { quiz1: 15, descriptive: 22 },
  },
  {
    id: "stu_ethan",
    name: "Ethan Brooks",
    registerNumber: "22BDS0133",
    email: "ethan.brooks@vitstudent.ac.in",
    groupId: "grp_matrices",
    groupName: "Team Matrices",
    submittedCount: 3,
    missingCount: 1,
    atRisk: false,
    lastActiveAt: "2026-09-14T20:15:00.000Z",
    marks: { quiz1: 12, descriptive: 18 },
  },
  {
    id: "stu_farah",
    name: "Farah Al-Rashid",
    registerNumber: "22BDS0107",
    email: "farah.al-rashid@vitstudent.ac.in",
    groupId: "grp_matrices",
    groupName: "Team Matrices",
    submittedCount: 4,
    missingCount: 0,
    atRisk: false,
    lastActiveAt: "2026-09-15T10:50:00.000Z",
    marks: { quiz1: 17, descriptive: 25 },
  },
  {
    id: "stu_gabriela",
    name: "Gabriela Santos",
    registerNumber: "22BDS0128",
    email: "gabriela.santos@vitstudent.ac.in",
    groupId: "grp_graphs",
    groupName: "Team Graphs",
    submittedCount: 3,
    missingCount: 1,
    atRisk: false,
    lastActiveAt: "2026-09-12T14:05:00.000Z",
    marks: { quiz1: 14, descriptive: 21 },
  },
  {
    id: "stu_hiroshi",
    name: "Hiroshi Tanaka",
    registerNumber: "22BDS0105",
    email: "hiroshi.tanaka@vitstudent.ac.in",
    groupId: "grp_vectors",
    groupName: "Team Vectors",
    submittedCount: 4,
    missingCount: 0,
    atRisk: false,
    lastActiveAt: "2026-09-15T11:40:00.000Z",
    marks: { quiz1: 20, descriptive: 28 },
  },
  {
    id: "stu_isaiah",
    name: "Isaiah Thompson",
    registerNumber: "22BDS0131",
    email: "isaiah.thompson@vitstudent.ac.in",
    groupId: "grp_graphs",
    groupName: "Team Graphs",
    submittedCount: 2,
    missingCount: 2,
    atRisk: true,
    lastActiveAt: "2026-09-08T15:20:00.000Z",
    marks: { quiz1: 11, descriptive: 17 },
  },
  {
    id: "stu_alexandria",
    name: "Alexandria Catherine Montgomery-Worthington",
    registerNumber: "22BDS0122",
    email: "alexandria.montgomery-worthington@vitstudent.ac.in",
    groupId: "grp_vectors",
    groupName: "Team Vectors",
    submittedCount: 3,
    missingCount: 1,
    atRisk: false,
    lastActiveAt: "2026-09-13T18:00:00.000Z",
    marks: { quiz1: 13, descriptive: 20 },
  },
  {
    id: "stu_mateo",
    name: "Mateo Fernández",
    registerNumber: "22BDS0116",
    email: "mateo.fernandez@vitstudent.ac.in",
    groupId: "grp_graphs",
    groupName: "Team Graphs",
    submittedCount: 3,
    missingCount: 1,
    atRisk: false,
    lastActiveAt: "2026-09-14T08:25:00.000Z",
    marks: { quiz1: 16, descriptive: 23 },
  },
  {
    id: "stu_priya",
    name: "Priya Krishnan",
    registerNumber: "22BDS0110",
    email: "priya.krishnan@vitstudent.ac.in",
    groupId: "grp_graphs",
    groupName: "Team Graphs",
    submittedCount: 4,
    missingCount: 0,
    atRisk: false,
    lastActiveAt: "2026-09-15T09:05:00.000Z",
    marks: { quiz1: 18, descriptive: 25 },
  },
  {
    id: "stu_ravi",
    name: "Ravi Anand",
    registerNumber: "22BDS0140",
    email: "ravi.anand@vitstudent.ac.in",
    groupId: null,
    groupName: null,
    submittedCount: 0,
    missingCount: 6,
    atRisk: true,
    lastActiveAt: null,
    marks: { quiz1: null, descriptive: null },
  },
]

function averagePercent(values: number[]): number | null {
  if (values.length === 0) return null
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length)
}

export const MOCK_STUDENTS: Student[] = STUDENT_SEEDS.map((seed) => {
  const percents: number[] = []
  if (seed.marks.quiz1 !== null) percents.push((seed.marks.quiz1 / QUIZ_1_MAX) * 100)
  if (seed.marks.descriptive !== null) {
    percents.push((seed.marks.descriptive / DESCRIPTIVE_MAX) * 100)
  }
  return {
    id: seed.id,
    name: seed.name,
    registerNumber: seed.registerNumber,
    email: seed.email,
    initials: initialsFromName(seed.name),
    groupId: seed.groupId,
    groupName: seed.groupName,
    avgPercent: averagePercent(percents),
    submittedCount: seed.submittedCount,
    missingCount: seed.missingCount,
    atRisk: seed.atRisk,
    lastActiveAt: seed.lastActiveAt,
  }
})

export const MOCK_STUDENT_BY_ID: Record<string, Student> = Object.fromEntries(
  MOCK_STUDENTS.map((student) => [student.id, student]),
)

/**
 * Raw marks keyed by student, straight from the marks table above. Other mock
 * modules read from here so a grade panel, a marks table, and an analytics
 * series always agree. `null` means "no mark recorded" (not zero).
 */
export const MOCK_MARKS: {
  quiz1: Record<string, number | null>
  descriptive: Record<string, number | null>
} = {
  quiz1: Object.fromEntries(STUDENT_SEEDS.map((seed) => [seed.id, seed.marks.quiz1])),
  descriptive: Object.fromEntries(STUDENT_SEEDS.map((seed) => [seed.id, seed.marks.descriptive])),
}

/** Mean of the published marks for one mark key, as a percentage. */
function assessmentAverage(key: MarkKey, maxPoints: number): number | null {
  const points = STUDENT_SEEDS.map((seed) => seed.marks[key]).filter(
    (value): value is number => value !== null,
  )
  if (points.length === 0) return null
  const total = points.reduce((sum, value) => sum + value, 0)
  return Math.round((total / points.length / maxPoints) * 100)
}

/** Cohort mean over every student who has at least one published mark. */
export const MOCK_COHORT_AVERAGE: number | null = averagePercent(
  MOCK_STUDENTS.map((student) => student.avgPercent).filter(
    (value): value is number => value !== null,
  ),
)

/** The offering the mockups are written against. */
export const MOCK_COURSE: Course = {
  id: "off_algebra_a_2026",
  code: "MTH-201",
  name: "Algebra Foundations",
  description:
    "Linear and quadratic structures, functions as models, and an introduction to computational thinking with code tasks.",
  credits: 3,
  term: "Fall 2026",
  academicYear: 2026,
  section: "Section A",
  teacherName: "Dr. Meera Raman",
  room: "TT-204",
  studentCount: MOCK_STUDENTS.length,
  avgPercent: MOCK_COHORT_AVERAGE,
  completionPercent: 62,
  atRiskCount: MOCK_STUDENTS.filter((student) => student.atRisk).length,
  startsOn: "2026-08-24T04:00:00.000Z",
  endsOn: "2026-12-04T10:00:00.000Z",
}

/**
 * Six assessments covering every type in the product: two graded quizzes, a
 * rubric-graded descriptive piece, a code task with a live test harness, an
 * in-flight group project, and a draft that has not been published.
 *
 * Weights sum to 100%.
 */
export const MOCK_ASSESSMENTS: Assessment[] = [
  {
    id: "asm_quiz1",
    title: "Quiz 1 — Linear Equations",
    kind: "QUIZ",
    courseCode: MOCK_COURSE.code,
    dueAt: "2026-09-02T13:30:00.000Z",
    maxPoints: QUIZ_1_MAX,
    state: "completed",
    expectedCount: 13,
    submissionCount: 12,
    gradedCount: 12,
    averagePercent: assessmentAverage("quiz1", QUIZ_1_MAX),
    weightPercent: 10,
    published: true,
  },
  {
    id: "asm_descriptive",
    title: "Descriptive — Modelling with Functions",
    kind: "DESCRIPTIVE",
    courseCode: MOCK_COURSE.code,
    dueAt: "2026-09-09T13:30:00.000Z",
    maxPoints: DESCRIPTIVE_MAX,
    state: "needs-review",
    rubricId: "rub_modelling",
    expectedCount: 13,
    submissionCount: 12,
    gradedCount: 6,
    averagePercent: assessmentAverage("descriptive", DESCRIPTIVE_MAX),
    weightPercent: 20,
    published: false,
  },
  {
    id: "asm_code",
    title: "Code Task — Sorting & Big-O",
    kind: "CODE",
    courseCode: MOCK_COURSE.code,
    dueAt: "2026-09-20T13:30:00.000Z",
    maxPoints: 25,
    state: "in-progress",
    expectedCount: 13,
    submissionCount: 9,
    gradedCount: 0,
    averagePercent: null,
    weightPercent: 15,
    published: false,
  },
  {
    id: "asm_group",
    title: "Group Project — Data Storytelling",
    kind: "GROUP_PROJECT",
    courseCode: MOCK_COURSE.code,
    dueAt: "2026-10-10T13:30:00.000Z",
    maxPoints: 40,
    state: "in-progress",
    expectedCount: 13,
    submissionCount: 0,
    gradedCount: 0,
    averagePercent: null,
    weightPercent: 30,
    published: false,
  },
  {
    id: "asm_assignment",
    title: "Assignment — Inequalities",
    kind: "ASSIGNMENT",
    courseCode: MOCK_COURSE.code,
    dueAt: "2026-09-14T13:30:00.000Z",
    maxPoints: 15,
    state: "needs-review",
    expectedCount: 13,
    submissionCount: 12,
    gradedCount: 3,
    averagePercent: null,
    weightPercent: 15,
    published: false,
  },
  {
    id: "asm_quiz2",
    title: "Quiz 2 — Quadratics",
    kind: "QUIZ",
    courseCode: MOCK_COURSE.code,
    dueAt: "2026-09-28T13:30:00.000Z",
    maxPoints: 20,
    state: "draft",
    expectedCount: 13,
    submissionCount: 0,
    gradedCount: 0,
    averagePercent: null,
    weightPercent: 10,
    published: false,
  },
]

export const MOCK_ASSESSMENT_BY_ID: Record<string, Assessment> = Object.fromEntries(
  MOCK_ASSESSMENTS.map((assessment) => [assessment.id, assessment]),
)

/**
 * The binding grading contract for the descriptive piece. Weights sum to 1 and
 * every criterion's `maxPoints` equals `weight × 30`, so a suggestion can never
 * exceed its criterion ceiling.
 */
export const MOCK_RUBRIC: Rubric = {
  id: "rub_modelling",
  title: "Modelling with Functions — grading rubric",
  description:
    "Teacher-approved criteria for the descriptive task. The model may only score inside these ceilings.",
  maxPoints: DESCRIPTIVE_MAX,
  totalWeight: 1,
  updatedAt: "2026-09-05T07:00:00.000Z",
  criteria: [
    {
      id: "crit_reasoning",
      order: 1,
      label: "Mathematical reasoning",
      description: "Correct use of functional notation and justified algebraic steps.",
      weight: 0.35,
      maxPoints: 10.5,
      levels: [
        {
          label: "Excellent",
          points: 10.5,
          description: "Every step is justified and notation is used precisely throughout.",
        },
        {
          label: "Proficient",
          points: 8.4,
          description: "Sound reasoning with one minor gap or notational slip.",
        },
        {
          label: "Developing",
          points: 6.3,
          description: "Reasoning is directionally right but skips justification.",
        },
        {
          label: "Beginning",
          points: 4.2,
          description: "Steps are asserted without support.",
        },
      ],
    },
    {
      id: "crit_modelling",
      order: 2,
      label: "Modelling accuracy",
      description: "The chosen model fits the described situation and its units.",
      weight: 0.25,
      maxPoints: 7.5,
      levels: [
        {
          label: "Excellent",
          points: 7.5,
          description: "Model fits the context, with units and domain stated correctly.",
        },
        {
          label: "Proficient",
          points: 6,
          description: "Model fits; units are implied but not stated.",
        },
        {
          label: "Developing",
          points: 4.5,
          description: "Model is plausible but ignores a stated constraint.",
        },
        {
          label: "Beginning",
          points: 3,
          description: "Model does not represent the situation.",
        },
      ],
    },
    {
      id: "crit_evidence",
      order: 3,
      label: "Use of evidence",
      description: "Claims are supported with computed values or course material.",
      weight: 0.2,
      maxPoints: 6,
      levels: [
        {
          label: "Excellent",
          points: 6,
          description: "Every claim is tied to a computed value or a cited source.",
        },
        { label: "Proficient", points: 4.8, description: "Most claims are supported." },
        {
          label: "Developing",
          points: 3.6,
          description: "Evidence is present but does not support the conclusion.",
        },
        { label: "Beginning", points: 2.4, description: "No supporting evidence." },
      ],
    },
    {
      id: "crit_communication",
      order: 4,
      label: "Communication & clarity",
      description: "Structure, notation and prose that a peer could follow.",
      weight: 0.2,
      maxPoints: 6,
      levels: [
        { label: "Excellent", points: 6, description: "Clear, ordered and easy to follow." },
        {
          label: "Proficient",
          points: 4.8,
          description: "Clear overall, with one awkward passage.",
        },
        {
          label: "Developing",
          points: 3.6,
          description: "Ordering is unclear in places.",
        },
        { label: "Beginning", points: 2.4, description: "Hard to follow." },
      ],
    },
  ],
}

/** The demo student whose own pages the mockups render. */
export const MOCK_DEMO_STUDENT = MOCK_STUDENT_BY_ID["stu_aarav"]
