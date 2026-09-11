export type AssessmentKind = "Quiz" | "Assignment"

export type SubmissionState =
  "not_submitted" | "draft" | "submitted" | "resubmitted" | "graded" | "late"

export type StudentAssessmentItem = {
  id: string
  title: string
  type: AssessmentKind
  dueDate: string
  maxMarks: number
  courseId: string
  courseCode: string
  courseName: string
  className: string
  term: string
  academicYear: number
  teacherName: string
  score: number | null
  percentage: number | null
  classAveragePercentage: number | null
  quizQuestionCount: number
  submissionState: SubmissionState
  submittedAt: string | null
  gradedAt: string | null
  feedback: string | null
  submissionContent: string | null
  daysUntilDue: number
  isPastDue: boolean
}

export type StudentAssessmentsPayload = {
  generatedAt: string
  assessments: StudentAssessmentItem[]
}
