export type AssessmentType = "Quiz" | "Assignment"

export type Course = {
  id: string
  code: string
  name: string
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

export type QuizQuestion = {
  id: string
  prompt: string
  options: string[]
  correctIndex: number
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

export type GradeBand = "excellent" | "good" | "pass" | "fail" | "ungraded"

export function letterGrade(pct: number): string {
  if (pct >= 90) return "A"
  if (pct >= 80) return "B"
  if (pct >= 70) return "C"
  if (pct >= 60) return "D"
  return "F"
}

export function gradeBand(pct: number | null): GradeBand {
  if (pct === null) return "ungraded"
  if (pct >= 85) return "excellent"
  if (pct >= 70) return "good"
  if (pct >= 60) return "pass"
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

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export function round(n: number, dp = 1) {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

export function quizForAssessment(quizzes: Quiz[], assessmentId: string): Quiz | undefined {
  return quizzes.find((q) => q.assessmentId === assessmentId)
}
