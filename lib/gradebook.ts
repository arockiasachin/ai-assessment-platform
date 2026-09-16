import { ABSOLUTE_PASS_MARK } from "@/lib/analytics/grading-bands"
import type { AssessmentType } from "@/lib/generated/prisma/enums"

export type Course = {
  id: string
  code: string
  name: string
}

/**
 * A teacher-owned class offering (course + class/section + term). The create-
 * assessment flow keys on `id`, never on `courseId`: the same course can be
 * taught in several offerings and only the offering identifies the class.
 */
export type Offering = {
  id: string
  courseId: string
  courseCode: string
  courseName: string
  className: string
  term: string
  academicYear: number
}

export type Student = {
  id: string
  name: string
  email: string
  registerNumber?: string | null
  profilePicUrl?: string | null
}

export type Assessment = {
  id: string
  title: string
  courseId: string
  courseName: string
  type: AssessmentType
  date: string // ISO date
  maxMarks: number
  offeringId: string
  classId: string
}

// key format: `${studentId}:${assessmentId}` -> score (out of assessment.maxMarks)
export type MarksMap = Record<string, number>

/**
 * Client-safe quiz question. `correctIndex` must never be added back here: the
 * answer key stays on the server and is only returned after grading via
 * `POST /api/quiz/grade` (see `lib/quiz-scoring.ts`).
 */
export type QuizQuestion = {
  id: string
  prompt: string
  options: string[]
}

export type Quiz = {
  assessmentId: string
  questions: QuizQuestion[]
}

export type UpcomingEvent = {
  id: string
  title: string
  description?: string | null
  eventType: "CLASS" | "ASSESSMENT" | "HOLIDAY" | "REMINDER"
  date: string
  endDate?: string | null
  courseId?: string | null
  courseName?: string | null
  classId?: string | null
  assessmentId?: string | null
  assessmentType?: AssessmentType | null
}

export function markKey(studentId: string, assessmentId: string) {
  return `${studentId}:${assessmentId}`
}

/**
 * Project a stored mark onto an assessment's own ceiling. A manual mark is
 * stored with `maxPoints === assessment.maxMarks` (identity), but an AI/rubric
 * grade may carry the rubric ceiling, so readers render the equivalent score on
 * the assessment's scale.
 */
export function toAssessmentScale(points: number, maxPoints: number, maxMarks: number): number {
  if (!Number.isFinite(points)) return 0
  if (!Number.isFinite(maxPoints) || maxPoints <= 0) return points
  return Math.round((points / maxPoints) * maxMarks * 100) / 100
}

export type GradeBand = "excellent" | "good" | "pass" | "fail" | "ungraded"

export function gradeBand(pct: number | null): GradeBand {
  if (pct === null) return "ungraded"
  if (pct >= 85) return "excellent"
  if (pct >= 70) return "good"
  // VIT's pass mark is 50, not 60 — see `ABSOLUTE_PASS_MARK`.
  if (pct >= ABSOLUTE_PASS_MARK) return "pass"
  return "fail"
}

export const bandColor: Record<GradeBand, string> = {
  excellent: "var(--color-chart-2)",
  good: "var(--color-chart-1)",
  pass: "var(--color-chart-3)",
  fail: "var(--color-chart-4)",
  ungraded: "var(--color-muted-foreground)",
}

export function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

export function round(n: number, dp = 1) {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

export function quizForAssessment(quizzes: Quiz[], assessmentId: string): Quiz | undefined {
  return quizzes.find((q) => q.assessmentId === assessmentId)
}
