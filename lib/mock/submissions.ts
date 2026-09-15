import { MOCK_MARKS, MOCK_STUDENTS, MOCK_STUDENT_BY_ID } from "./course"
import type { StudentAssessmentRow, SubmissionRow } from "./types"

/**
 * Submission tables for the teacher's "Submissions" page and the demo student's
 * own "Assessments" page.
 *
 * Marks are read from the shared `MOCK_MARKS` table, so a row here can never
 * disagree with the student's average or the assessment's mean. The mix is
 * intentional: published and unpublished grades, late and resubmitted work, a
 * draft that was never submitted, and a student with no rows at all (Ravi).
 */

const gradedQuizStudents = MOCK_STUDENTS.filter((student) => MOCK_MARKS.quiz1[student.id] !== null)

const QUIZ_FEEDBACK = [
  "Strong on rearranging; watch the sign when a term crosses the equals sign.",
  "Good work. Re-read question 4 — the negative coefficient tripped you up.",
  "Excellent. All working shown and notation is precise.",
]

const QUIZ_ROWS: SubmissionRow[] = gradedQuizStudents.map((student, index) => ({
  id: `sub_quiz1_${student.id}`,
  assessmentId: "asm_quiz1",
  assessmentTitle: "Quiz 1 — Linear Equations",
  kind: "QUIZ",
  studentId: student.id,
  studentName: student.name,
  state: "GRADED",
  submittedAt: index % 3 === 0 ? "2026-09-02T13:05:00.000Z" : "2026-09-02T12:40:00.000Z",
  points: MOCK_MARKS.quiz1[student.id],
  maxPoints: 20,
  published: true,
  gradedAt: "2026-09-03T06:30:00.000Z",
  feedback: QUIZ_FEEDBACK[index % QUIZ_FEEDBACK.length],
  versionCount: 1,
  late: false,
}))

const descriptiveGradedStudents = MOCK_STUDENTS.filter(
  (student) => MOCK_MARKS.descriptive[student.id] !== null,
).slice(0, 6)

const descriptivePendingStudents = MOCK_STUDENTS.filter(
  (student) => MOCK_MARKS.descriptive[student.id] !== null,
).slice(6)

const DESCRIPTIVE_GRADED_ROWS: SubmissionRow[] = descriptiveGradedStudents.map(
  (student): SubmissionRow => ({
    id: `sub_descriptive_${student.id}`,
    assessmentId: "asm_descriptive",
    assessmentTitle: "Descriptive — Modelling with Functions",
    kind: "DESCRIPTIVE",
    studentId: student.id,
    studentName: student.name,
    state: "GRADED",
    submittedAt: "2026-09-09T12:15:00.000Z",
    points: MOCK_MARKS.descriptive[student.id],
    maxPoints: 30,
    // Graded by AI and accepted, but the assessment is not published yet.
    published: false,
    gradedAt: "2026-09-10T08:05:00.000Z",
    feedback: "Rubric-applied feedback is summarised per criterion in the review panel.",
    versionCount: 2,
    late: false,
  }),
)

const DESCRIPTIVE_PENDING_ROWS: SubmissionRow[] = descriptivePendingStudents.map(
  (student, index): SubmissionRow => ({
    id: `sub_descriptive_${student.id}`,
    assessmentId: "asm_descriptive",
    assessmentTitle: "Descriptive — Modelling with Functions",
    kind: "DESCRIPTIVE",
    studentId: student.id,
    studentName: student.name,
    state: index === 0 ? "RESUBMITTED" : index === 1 ? "LATE" : "SUBMITTED",
    submittedAt: index === 0 ? "2026-09-11T19:40:00.000Z" : "2026-09-09T15:20:00.000Z",
    points: null,
    maxPoints: 30,
    published: false,
    gradedAt: null,
    feedback: null,
    versionCount: index === 0 ? 3 : 1,
    late: index === 1,
  }),
)

const ASSIGNMENT_ROWS: SubmissionRow[] = MOCK_STUDENTS.slice(0, 12).map(
  (student, index): SubmissionRow => {
    const state =
      index === 3 ? "DRAFT" : index === 7 ? "LATE" : index === 9 ? "RESUBMITTED" : "SUBMITTED"
    const graded = index < 3
    return {
      id: `sub_assignment_${student.id}`,
      assessmentId: "asm_assignment",
      assessmentTitle: "Assignment — Inequalities",
      kind: "ASSIGNMENT",
      studentId: student.id,
      studentName: student.name,
      state: graded ? "GRADED" : state,
      submittedAt: state === "DRAFT" ? null : "2026-09-14T12:00:00.000Z",
      points: graded ? 12 - index : null,
      maxPoints: 15,
      published: false,
      gradedAt: graded ? "2026-09-15T06:10:00.000Z" : null,
      feedback: graded ? "Solution set is correct; show the boundary check next time." : null,
      versionCount: state === "RESUBMITTED" ? 2 : 1,
      late: state === "LATE",
    }
  },
)

const CODE_ROWS: SubmissionRow[] = MOCK_STUDENTS.slice(1, 10).map(
  (student, index): SubmissionRow => ({
    id: `sub_code_${student.id}`,
    assessmentId: "asm_code",
    assessmentTitle: "Code Task — Sorting & Big-O",
    kind: "CODE",
    studentId: student.id,
    studentName: student.name,
    state: index === 4 ? "LATE" : "SUBMITTED",
    submittedAt: "2026-09-14T10:30:00.000Z",
    points: null,
    maxPoints: 25,
    published: false,
    gradedAt: null,
    feedback: null,
    versionCount: index === 6 ? 2 : 1,
    late: index === 4,
  }),
)

export const MOCK_SUBMISSIONS: SubmissionRow[] = [
  ...QUIZ_ROWS,
  ...DESCRIPTIVE_GRADED_ROWS,
  ...DESCRIPTIVE_PENDING_ROWS,
  ...ASSIGNMENT_ROWS,
  ...CODE_ROWS,
]

/** Rows for the student's own assessment list (the demo student, Aarav). */
export const MOCK_STUDENT_ASSESSMENTS: StudentAssessmentRow[] = [
  {
    assessmentId: "asm_quiz1",
    title: "Quiz 1 — Linear Equations",
    kind: "QUIZ",
    dueAt: "2026-09-02T13:30:00.000Z",
    state: "graded",
    points: MOCK_MARKS.quiz1["stu_aarav"],
    maxPoints: 20,
    submittedAt: "2026-09-02T12:58:00.000Z",
    feedback: "Strong on rearranging; watch the sign when a term crosses the equals sign.",
    published: true,
  },
  {
    assessmentId: "asm_descriptive",
    title: "Descriptive — Modelling with Functions",
    kind: "DESCRIPTIVE",
    dueAt: "2026-09-09T13:30:00.000Z",
    state: "pending",
    points: null,
    maxPoints: 30,
    submittedAt: "2026-09-09T12:15:00.000Z",
    feedback: null,
    published: false,
  },
  {
    assessmentId: "asm_assignment",
    title: "Assignment — Inequalities",
    kind: "ASSIGNMENT",
    dueAt: "2026-09-14T13:30:00.000Z",
    state: "submitted",
    points: null,
    maxPoints: 15,
    submittedAt: "2026-09-14T10:05:00.000Z",
    feedback: null,
    published: false,
  },
  {
    assessmentId: "asm_code",
    title: "Code Task — Sorting & Big-O",
    kind: "CODE",
    dueAt: "2026-09-20T13:30:00.000Z",
    state: "in-progress",
    points: null,
    maxPoints: 25,
    // Not submitted yet — the student has a saved draft.
    submittedAt: null,
    feedback: null,
    published: false,
  },
  {
    assessmentId: "asm_group",
    title: "Group Project — Data Storytelling",
    kind: "GROUP_PROJECT",
    dueAt: "2026-10-10T13:30:00.000Z",
    state: "active",
    points: null,
    maxPoints: 40,
    submittedAt: null,
    feedback: null,
    published: false,
  },
  {
    assessmentId: "asm_quiz2",
    title: "Quiz 2 — Quadratics",
    kind: "QUIZ",
    dueAt: "2026-09-28T13:30:00.000Z",
    state: "draft",
    points: null,
    maxPoints: 20,
    submittedAt: null,
    feedback: null,
    published: false,
  },
]

/** Convenience lookup used by the submission detail panels. */
export function findStudentName(studentId: string): string {
  return MOCK_STUDENT_BY_ID[studentId]?.name ?? "Unknown student"
}
