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

/**
 * The team a submission came from.
 *
 * The queue row prints the group next to the assessment kind, so leaving the
 * field off would make every row claim the student is in no team — which is
 * false for every student in this fixture except `stu_ravi`. Derived from the
 * roster rather than typed in, so it cannot drift from the groups pages.
 */
function groupOf(studentId: string): string | undefined {
  return MOCK_STUDENTS.find((student) => student.id === studentId)?.groupName ?? undefined
}

/**
 * An item's confidence is its WEAKEST criterion's.
 *
 * The queue row prints one confidence next to a proposal the model split into
 * criteria, and the acceptance rule is "every criterion must clear the floor",
 * so an item cannot be more trustworthy than its least trustworthy line. The
 * page also reasons from this number ("N of 4 criteria fell below the floor"),
 * which only lines up with the criteria it lists if it is derived from them.
 */
function itemConfidence(suggestions: readonly GradeSuggestion[]): number {
  if (suggestions.length === 0) return 1
  return Math.min(...suggestions.map((suggestion) => suggestion.confidence))
}

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
 * The one descriptive submission whose mark a teacher lowered.
 *
 * `MOCK_MARKS` holds the FINAL mark, so the model's proposal derived below sits
 * slightly above it: the criterion in `OVERRIDDEN_CRITERION_ID` is recorded as
 * OVERRIDDEN with the deduction and the reason, and `MOCK_GRADES` plus the
 * `grade.override` audit event report the same final mark. Before this was tied
 * together, the grade fixture subtracted two marks from a value the marks table
 * never held, so the grade and the spine disagreed and no fixture grade was
 * ever `TEACHER_OVERRIDE`.
 */
const OVERRIDDEN_DESCRIPTIVE_STUDENT_ID = "stu_chen"
const OVERRIDDEN_CRITERION_ID = "crit_communication"
const OVERRIDE_DEDUCTION = 0.5
const OVERRIDE_REASON = "0.5 marks deducted: the notation slip repeats in the final paragraph."

/**
 * The one submission carrying a criterion below the confidence floor.
 *
 * It has to be a submission the QUEUE actually holds, otherwise the "Low" badge
 * on a queue row has no criterion to explain it — the model's low-confidence
 * line used to sit on a student whose criteria are never rendered. This is
 * `stu_gabriela`, whose first flag is "Low confidence on Use of evidence" and
 * whose third criterion is exactly `crit_evidence`.
 */
const LOW_CONFIDENCE_DESCRIPTIVE_STUDENT_ID = "stu_gabriela"
const LOW_CONFIDENCE_CRITERION_INDEX = 2

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
    const lowConfidence =
      student.id === LOW_CONFIDENCE_DESCRIPTIVE_STUDENT_ID &&
      criterionIndex === LOW_CONFIDENCE_CRITERION_INDEX
    const isOverridden =
      student.id === OVERRIDDEN_DESCRIPTIVE_STUDENT_ID && criterion.id === OVERRIDDEN_CRITERION_ID
    const state: ReviewState = isOverridden
      ? "OVERRIDDEN"
      : studentIndex < 4
        ? "AUTO_ACCEPTED"
        : "NEEDS_REVIEW"
    const decided = state === "AUTO_ACCEPTED" || state === "OVERRIDDEN"
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
      decidedBy: isOverridden ? "Dr. Meera Raman" : decided ? "auto-threshold" : undefined,
      decidedAt: decided
        ? isOverridden
          ? "2026-09-15T06:40:00.000Z"
          : "2026-09-10T08:05:00.000Z"
        : undefined,
      finalPoints: isOverridden
        ? Math.round((suggestedPoints - OVERRIDE_DEDUCTION) * 10) / 10
        : state === "AUTO_ACCEPTED"
          ? suggestedPoints
          : undefined,
      overrideReason: isOverridden ? OVERRIDE_REASON : undefined,
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
      groupName: student.groupName ?? undefined,
      submittedAt: "2026-09-09T12:15:00.000Z",
      state,
      suggestedPoints: Math.round(suggested * 10) / 10,
      maxPoints: 30,
      confidence: itemConfidence(suggestions),
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
  groupName: groupOf("stu_farah"),
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
  groupName: groupOf("stu_ethan"),
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
  groupName: groupOf("stu_diya"),
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
    // The marks table already holds the FINAL mark, so an override needs no
    // arithmetic here — it only changes the source and adds the stored reason.
    const points = MOCK_MARKS.descriptive[student.id]
    const overridden = student.id === OVERRIDDEN_DESCRIPTIVE_STUDENT_ID
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
      overrideReason: overridden ? OVERRIDE_REASON : undefined,
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

/**
 * KPI-style summary used by the reviews page header.
 *
 * Auto-accept is a CRITERION-level outcome: an item whose criteria all clear the
 * floor stays in the queue for a spot check, so an item-level count would always
 * be zero. The last two fields count criteria and the submissions they belong
 * to instead of pretending there is a `AUTO_ACCEPTED` queue row to count.
 */
const autoAcceptedCriteria = MOCK_GRADE_SUGGESTIONS.filter(
  (suggestion) => suggestion.state === "AUTO_ACCEPTED",
)

export const MOCK_REVIEW_SUMMARY = {
  pending: MOCK_REVIEW_QUEUE.filter((item) => item.state === "PENDING").length,
  needsReview: MOCK_REVIEW_QUEUE.filter((item) => item.state === "NEEDS_REVIEW").length,
  autoAcceptedCriteria: autoAcceptedCriteria.length,
  autoAcceptedSubmissions: new Set(autoAcceptedCriteria.map((s) => s.studentId)).size,
  overridden: MOCK_REVIEW_QUEUE.filter((item) => item.state === "OVERRIDDEN").length,
  rejected: MOCK_REVIEW_QUEUE.filter((item) => item.state === "REJECTED").length,
  assessmentTitle: "Descriptive — Modelling with Functions",
  assessmentId: "asm_descriptive",
}
