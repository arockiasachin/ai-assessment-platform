import { MOCK_MARKS, MOCK_RUBRIC, MOCK_STUDENTS } from "./course"
import type { Grade, GradeSuggestion, ReviewQueueItem, ReviewState } from "./types"

/**
 * The grading pipeline: AI suggestions → review queue → grades.
 *
 * Everything a reviewer sees on screen is derived from one rubric and one marks
 * table, and every suggestion respects its criterion ceiling. The deliberate
 * edge cases live here:
 *  - a suggestion accepted at a LOWER score than the model proposed (override,
 *    with a reason stored as calibration data);
 *  - a rejected suggestion;
 *  - an unpublished grade (AI accepted, awaiting the teacher's publish action)
 *    alongside published Quiz 1 grades;
 *  - a review item with no submission time, because the attempt was never
 *    submitted.
 */

const CRITERION_RATIONALE: Record<string, string> = {
  crit_reasoning:
    "The response isolates the variable and justifies each rearrangement. One step (dividing by a negative coefficient) is stated without comment.",
  crit_modelling:
    "The chosen model matches the described situation and the domain is stated. Units are implied by the scenario but never written down.",
  crit_evidence:
    "Two of the three claims are backed by computed values from the data table; the third assertion is unsupported.",
  crit_communication:
    "The argument is ordered and readable. Notation is consistent except for one switched variable name in the final paragraph.",
}

const CRITERION_EVIDENCE: Record<string, string | null> = {
  crit_reasoning: '"3x = 22 − 7 = 15, therefore x = 5."',
  crit_modelling: '"Let h(t) = −4.9t² + 12t, where t is time in seconds."',
  crit_evidence: '"the mean rises from 61% to 78% between week 2 and week 5"',
  crit_communication: null,
}

/** Small deterministic wobble so the six graded scripts are not identical. */
const WOBBLE = [1, 0.98, 1.02, 0.95, 1.0, 1.03]

/**
 * Build the four per-criterion suggestions for one descriptive submission,
 * scaled to the student's marks-table total.
 */
function buildSuggestions(studentIndex: number): GradeSuggestion[] {
  const student = MOCK_STUDENTS[studentIndex]
  const total = MOCK_MARKS.descriptive[student.id] ?? 0
  const wobble = WOBBLE[studentIndex % WOBBLE.length]
  return MOCK_RUBRIC.criteria.map((criterion, criterionIndex) => {
    const raw = (criterion.maxPoints * total * wobble) / MOCK_RUBRIC.maxPoints
    const suggestedPoints = Math.min(criterion.maxPoints, Math.round(raw * 10) / 10)
    const lowConfidence = studentIndex === 4 && criterionIndex === 2
    const state: ReviewState = studentIndex < 4 ? "AUTO_ACCEPTED" : "NEEDS_REVIEW"
    return {
      id: `sug_desc_${student.id}_${criterion.id}`,
      assessmentId: "asm_descriptive",
      assessmentTitle: "Descriptive — Modelling with Functions",
      studentId: student.id,
      studentName: student.name,
      criterionId: criterion.id,
      criterionLabel: criterion.label,
      suggestedPoints,
      maxPoints: criterion.maxPoints,
      rationale: CRITERION_RATIONALE[criterion.id],
      evidence: CRITERION_EVIDENCE[criterion.id] ?? null,
      confidence: lowConfidence ? 0.42 : 0.78 + (criterionIndex % 3) * 0.06,
      model: "gpt-5.1-mini",
      promptVersion: "rubric-grader-v3",
      latencyMs: 1_180 + criterionIndex * 140,
      state,
      decidedBy: state === "AUTO_ACCEPTED" ? "auto-threshold" : undefined,
      decidedAt: state === "AUTO_ACCEPTED" ? "2026-09-10T08:05:00.000Z" : undefined,
      finalPoints: state === "AUTO_ACCEPTED" ? suggestedPoints : undefined,
    }
  })
}

/** Suggestions for the six scripts whose AI pass has completed. */
export const MOCK_GRADE_SUGGESTIONS: GradeSuggestion[] = MOCK_STUDENTS.filter(
  (student) => MOCK_MARKS.descriptive[student.id] !== null,
).flatMap((student) => buildSuggestions(MOCK_STUDENTS.findIndex((s) => s.id === student.id)))

const descriptiveQueueStudents = MOCK_STUDENTS.filter(
  (student) => MOCK_MARKS.descriptive[student.id] !== null,
).slice(6)

const DESCRIPTIVE_REVIEW_STATES: ReviewState[] = [
  "NEEDS_REVIEW",
  "NEEDS_REVIEW",
  "NEEDS_REVIEW",
  "PENDING",
  "OVERRIDDEN",
  "REJECTED",
]

const DESCRIPTIVE_REVIEW_FLAGS: string[][] = [
  ["Low confidence on Use of evidence", "Unsupported claim"],
  ["Long response (1,840 words)", "Rubric criterion ambiguous"],
  ["Model disagreed with a prior attempt"],
  [],
  ["Teacher lowered the score"],
  ["Response did not address the task"],
]

const DESCRIPTIVE_REVIEW_ITEMS: ReviewQueueItem[] = descriptiveQueueStudents.map(
  (student, index): ReviewQueueItem => {
    const suggestions = MOCK_GRADE_SUGGESTIONS.filter((s) => s.studentId === student.id)
    const suggested = suggestions.reduce((total, s) => total + s.suggestedPoints, 0)
    const state = DESCRIPTIVE_REVIEW_STATES[index] ?? "NEEDS_REVIEW"
    return {
      id: `rev_desc_${student.id}`,
      assessmentId: "asm_descriptive",
      assessmentTitle: "Descriptive — Modelling with Functions",
      kind: "DESCRIPTIVE",
      studentId: student.id,
      studentName: student.name,
      submittedAt: "2026-09-09T12:15:00.000Z",
      state,
      suggestedPoints: Math.round(suggested * 10) / 10,
      maxPoints: 30,
      confidence: state === "NEEDS_REVIEW" ? 0.44 : 0.86,
      flags: DESCRIPTIVE_REVIEW_FLAGS[index] ?? [],
      reviewer: index >= 4 ? "Dr. Meera Raman" : null,
      priority: index < 2 ? "high" : "normal",
      criteria: suggestions,
    }
  },
)

/**
 * One overridden item with the full calibration trail: the model proposed 12.5,
 * the teacher accepted 10.5 and wrote why.
 */
const OVERRIDE_ITEM: ReviewQueueItem = {
  id: "rev_asm_assignment_stu_farah",
  assessmentId: "asm_assignment",
  assessmentTitle: "Assignment — Inequalities",
  kind: "ASSIGNMENT",
  studentId: "stu_farah",
  studentName: "Farah Al-Rashid",
  submittedAt: "2026-09-14T11:10:00.000Z",
  state: "OVERRIDDEN",
  suggestedPoints: 12.5,
  maxPoints: 15,
  confidence: 0.71,
  flags: ["Teacher lowered the score"],
  reviewer: "Dr. Meera Raman",
  priority: "normal",
  criteria: [
    {
      id: "sug_asn_farah",
      assessmentId: "asm_assignment",
      assessmentTitle: "Assignment — Inequalities",
      studentId: "stu_farah",
      studentName: "Farah Al-Rashid",
      criterionId: "asn_solution_set",
      criterionLabel: "Solution set & boundary",
      suggestedPoints: 12.5,
      maxPoints: 15,
      rationale:
        "The solution set is correct and the boundary values are tested, but the interval notation mixes open and closed brackets.",
      evidence: "x ∈ (−∞, 5), not x ∈ (−∞, 5]",
      confidence: 0.71,
      model: "gpt-5.1-mini",
      promptVersion: "rubric-grader-v3",
      latencyMs: 940,
      state: "OVERRIDDEN",
      decidedBy: "Dr. Meera Raman",
      decidedAt: "2026-09-15T06:40:00.000Z",
      finalPoints: 10.5,
      overrideReason: "Notation error repeats in three places; 2 marks deducted rather than 0.5.",
    },
  ],
}

/** A code submission waiting on the similarity flag. */
const CODE_REVIEW_ITEM: ReviewQueueItem = {
  id: "rev_asm_code_stu_ethan",
  assessmentId: "asm_code",
  assessmentTitle: "Code Task — Sorting & Big-O",
  kind: "CODE",
  studentId: "stu_ethan",
  studentName: "Ethan Brooks",
  submittedAt: "2026-09-14T10:30:00.000Z",
  state: "NEEDS_REVIEW",
  suggestedPoints: 18,
  maxPoints: 25,
  confidence: 0.63,
  flags: ["Similarity 0.91 with Chen Wei", "2 tests failed"],
  reviewer: null,
  priority: "high",
  criteria: [
    {
      id: "sug_code_ethan",
      assessmentId: "asm_code",
      assessmentTitle: "Code Task — Sorting & Big-O",
      studentId: "stu_ethan",
      studentName: "Ethan Brooks",
      criterionId: "code_tests",
      criterionLabel: "Correctness (test suite)",
      suggestedPoints: 18,
      maxPoints: 25,
      rationale:
        "Four of six test cases pass. The two failures are both empty-input cases the instructions do not mention explicitly.",
      evidence: "4 passed / 2 failed — see run 9f21c4",
      confidence: 0.63,
      model: "code-eval",
      promptVersion: "test-analysis-v2",
      latencyMs: 320,
      state: "NEEDS_REVIEW",
    },
  ],
}

/** An attempt that was opened and abandoned, so there is no submission time. */
const ABANDONED_ITEM: ReviewQueueItem = {
  id: "rev_asm_assignment_stu_diya",
  assessmentId: "asm_assignment",
  assessmentTitle: "Assignment — Inequalities",
  kind: "ASSIGNMENT",
  studentId: "stu_diya",
  studentName: "Diya Nair",
  submittedAt: null,
  state: "REJECTED",
  suggestedPoints: 0,
  maxPoints: 15,
  confidence: 0.98,
  flags: ["No submission received"],
  reviewer: "Dr. Meera Raman",
  priority: "low",
  criteria: [],
}

export const MOCK_REVIEW_QUEUE: ReviewQueueItem[] = [
  ...DESCRIPTIVE_REVIEW_ITEMS,
  OVERRIDE_ITEM,
  CODE_REVIEW_ITEM,
  ABANDONED_ITEM,
]

export const MOCK_PENDING_REVIEWS = MOCK_REVIEW_QUEUE.filter(
  (item) => item.state === "NEEDS_REVIEW" || item.state === "PENDING",
)

/** Published Quiz 1 grades plus unpublished grades awaiting the publish action. */
const quizGrades: Grade[] = MOCK_STUDENTS.filter(
  (student) => MOCK_MARKS.quiz1[student.id] !== null,
).map((student) => {
  const points = MOCK_MARKS.quiz1[student.id]
  return {
    id: `grade_quiz1_${student.id}`,
    assessmentId: "asm_quiz1",
    assessmentTitle: "Quiz 1 — Linear Equations",
    studentId: student.id,
    studentName: student.name,
    points,
    maxPoints: 20,
    percent: points === null ? null : Math.round((points / 20) * 100),
    source: "AUTO",
    published: true,
    publishedAt: "2026-09-03T06:35:00.000Z",
    approvedBy: "Dr. Meera Raman",
  }
})

const descriptiveGrades: Grade[] = MOCK_STUDENTS.filter(
  (student) => MOCK_MARKS.descriptive[student.id] !== null,
)
  .slice(0, 6)
  .map((student) => {
    const marks = MOCK_MARKS.descriptive[student.id]
    const overridden = student.id === "stu_gabriela"
    const points = overridden && marks !== null ? marks - 2 : marks
    return {
      id: `grade_descriptive_${student.id}`,
      assessmentId: "asm_descriptive",
      assessmentTitle: "Descriptive — Modelling with Functions",
      studentId: student.id,
      studentName: student.name,
      points,
      maxPoints: 30,
      percent: points === null ? null : Math.round((points / 30) * 100),
      source: overridden ? "TEACHER_OVERRIDE" : "AI_SUGGESTED",
      // Accepted by the teacher, but the assessment is not published yet.
      published: false,
      publishedAt: null,
      overrideReason: overridden
        ? "Rubric applied correctly; 2 marks deducted for repeated notation errors."
        : undefined,
      approvedBy: "Dr. Meera Raman",
    }
  })

const assignmentGrades: Grade[] = MOCK_STUDENTS.slice(0, 3).map((student, index) => ({
  id: `grade_assignment_${student.id}`,
  assessmentId: "asm_assignment",
  assessmentTitle: "Assignment — Inequalities",
  studentId: student.id,
  studentName: student.name,
  points: 12 - index,
  maxPoints: 15,
  percent: Math.round(((12 - index) / 15) * 100),
  source: "AI_SUGGESTED",
  published: false,
  publishedAt: null,
  approvedBy: "Dr. Meera Raman",
}))

export const MOCK_GRADES: Grade[] = [...quizGrades, ...descriptiveGrades, ...assignmentGrades]

/** KPI-style summary used by the reviews page header. */
export const MOCK_REVIEW_SUMMARY = {
  pending: MOCK_REVIEW_QUEUE.filter((item) => item.state === "PENDING").length,
  needsReview: MOCK_REVIEW_QUEUE.filter((item) => item.state === "NEEDS_REVIEW").length,
  autoAccepted: MOCK_REVIEW_QUEUE.filter((item) => item.state === "AUTO_ACCEPTED").length,
  overridden: MOCK_REVIEW_QUEUE.filter((item) => item.state === "OVERRIDDEN").length,
  rejected: MOCK_REVIEW_QUEUE.filter((item) => item.state === "REJECTED").length,
  assessmentTitle: "Descriptive — Modelling with Functions",
  assessmentId: "asm_descriptive",
}
