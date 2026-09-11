import { letterGrade, markKey, type Assessment, type MarksMap, type Student } from "@/lib/gradebook"

export function scorePct(marks: MarksMap, studentId: string, a: Assessment): number | null {
  const raw = marks[markKey(studentId, a.id)]
  if (raw === undefined) return null
  return (raw / a.maxMarks) * 100
}

// Average percentage for one student across a set of assessments.
export function studentAverage(marks: MarksMap, studentId: string, assessments: Assessment[]): number | null {
  const vals = assessments.map((a) => scorePct(marks, studentId, a)).filter((v): v is number => v !== null)
  if (vals.length === 0) return null
  return vals.reduce((s, v) => s + v, 0) / vals.length
}

// Average percentage for one assessment across all students who have a mark.
export function assessmentAverage(marks: MarksMap, students: Student[], a: Assessment): number | null {
  const vals = students.map((s) => scorePct(marks, s.id, a)).filter((v): v is number => v !== null)
  if (vals.length === 0) return null
  return vals.reduce((s, v) => s + v, 0) / vals.length
}

export function classAverage(marks: MarksMap, students: Student[], assessments: Assessment[]): number | null {
  const vals: number[] = []
  students.forEach((s) => assessments.forEach((a) => {
    const p = scorePct(marks, s.id, a)
    if (p !== null) vals.push(p)
  }))
  if (vals.length === 0) return null
  return vals.reduce((s, v) => s + v, 0) / vals.length
}

export function gradeDistribution(marks: MarksMap, students: Student[], assessments: Assessment[]) {
  const counts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 }
  students.forEach((s) => assessments.forEach((a) => {
    const p = scorePct(marks, s.id, a)
    if (p !== null) counts[letterGrade(p)]++
  }))
  return (["A", "B", "C", "D", "F"] as const).map((grade) => ({ grade, count: counts[grade] }))
}

export function passRate(marks: MarksMap, students: Student[], assessments: Assessment[]): number | null {
  let total = 0
  let passed = 0
  students.forEach((s) => assessments.forEach((a) => {
    const p = scorePct(marks, s.id, a)
    if (p !== null) {
      total++
      if (p >= 60) passed++
    }
  }))
  if (total === 0) return null
  return (passed / total) * 100
}

export function filterAssessments(assessments: Assessment[], courseId: string | "all") {
  return courseId === "all" ? assessments : assessments.filter((a) => a.courseId === courseId)
}
