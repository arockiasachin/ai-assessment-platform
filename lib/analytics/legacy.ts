import { markKey, type Assessment, type MarksMap, type Student } from "@/lib/gradebook"

import { ABSOLUTE_BANDS, ABSOLUTE_PASS_MARK, absoluteLetter } from "./grading-bands"

/**
 * Mark-map analytics (the original `lib/analytics.ts` helpers, moved verbatim
 * into the `lib/analytics` module). These operate on the gradebook's
 * `MarksMap` shape. The new quiz-attempt analytics in this module build on the
 * same grade bands (`letterGrade`) but read real `QuizAttempt` rows instead.
 */

export function scorePct(marks: MarksMap, studentId: string, a: Assessment): number | null {
  const raw = marks[markKey(studentId, a.id)]
  if (raw === undefined) return null
  return (raw / a.maxMarks) * 100
}

// Average percentage for one student across a set of assessments.
export function studentAverage(
  marks: MarksMap,
  studentId: string,
  assessments: Assessment[],
): number | null {
  const vals = assessments
    .map((a) => scorePct(marks, studentId, a))
    .filter((v): v is number => v !== null)
  if (vals.length === 0) return null
  return vals.reduce((s, v) => s + v, 0) / vals.length
}

// Average percentage for one assessment across all students who have a mark.
export function assessmentAverage(
  marks: MarksMap,
  students: Student[],
  a: Assessment,
): number | null {
  const vals = students.map((s) => scorePct(marks, s.id, a)).filter((v): v is number => v !== null)
  if (vals.length === 0) return null
  return vals.reduce((s, v) => s + v, 0) / vals.length
}

export function classAverage(
  marks: MarksMap,
  students: Student[],
  assessments: Assessment[],
): number | null {
  const vals: number[] = []
  students.forEach((s) =>
    assessments.forEach((a) => {
      const p = scorePct(marks, s.id, a)
      if (p !== null) vals.push(p)
    }),
  )
  if (vals.length === 0) return null
  return vals.reduce((s, v) => s + v, 0) / vals.length
}

export function gradeDistribution(marks: MarksMap, students: Student[], assessments: Assessment[]) {
  // VIT's seven absolute bands, from the same source the cohort histogram uses, so the
  // two distributions on the dashboards cannot disagree. This counts **component mark
  // cells**, which is what the chart is for — the bands describe where each mark would
  // sit, not a course grade per student.
  const counts: Record<string, number> = Object.fromEntries(
    ABSOLUTE_BANDS.map((band) => [band.letter, 0]),
  )
  students.forEach((s) =>
    assessments.forEach((a) => {
      const p = scorePct(marks, s.id, a)
      if (p === null) return
      const letter = absoluteLetter(p)
      if (letter !== null) counts[letter]++
    }),
  )
  return ABSOLUTE_BANDS.map((band) => ({ grade: band.letter, count: counts[band.letter] }))
}

export function passRate(
  marks: MarksMap,
  students: Student[],
  assessments: Assessment[],
): number | null {
  let total = 0
  let passed = 0
  students.forEach((s) =>
    assessments.forEach((a) => {
      const p = scorePct(marks, s.id, a)
      if (p !== null) {
        total++
        if (p >= ABSOLUTE_PASS_MARK) passed++
      }
    }),
  )
  if (total === 0) return null
  return (passed / total) * 100
}

export function filterAssessments(assessments: Assessment[], courseId: string | "all") {
  return courseId === "all" ? assessments : assessments.filter((a) => a.courseId === courseId)
}
