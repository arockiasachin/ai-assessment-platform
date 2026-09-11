import { z } from "zod"

import { nonEmptyString } from "./common"

/** `POST /api/gradebook/marks` request body (teacher/admin only). */
export const marksRequestSchema = z.object({
  studentId: nonEmptyString,
  assessmentId: nonEmptyString,
  score: z.union([z.number(), z.string(), z.null()]),
})
export type MarksRequest = z.infer<typeof marksRequestSchema>

/** `POST /api/gradebook/assessments` request body. */
export const createAssessmentRequestSchema = z.object({
  title: nonEmptyString,
  courseId: nonEmptyString,
  type: z.enum(["Quiz", "Assignment"]),
  date: nonEmptyString,
  maxMarks: z.coerce.number().positive(),
})
export type CreateAssessmentRequest = z.infer<typeof createAssessmentRequestSchema>

/** `PUT /api/teacher/offerings/[offeringId]` request body. */
export const updateOfferingRequestSchema = z.object({
  studentLimit: z.coerce.number().int().min(1).max(500),
  registrationOpenAt: z.string().nullable().optional(),
  registrationCloseAt: z.string().nullable().optional(),
  startsOn: z.string().nullable().optional(),
  endsOn: z.string().nullable().optional(),
})
export type UpdateOfferingRequest = z.infer<typeof updateOfferingRequestSchema>

/** `POST /api/student/courses/rating` request body. */
export const courseRatingRequestSchema = z.object({
  offeringId: nonEmptyString,
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
})
export type CourseRatingRequest = z.infer<typeof courseRatingRequestSchema>

/** `POST /api/student/courses/enroll` request body. */
export const courseEnrollRequestSchema = z.object({
  offeringId: nonEmptyString,
})
export type CourseEnrollRequest = z.infer<typeof courseEnrollRequestSchema>

/** `POST /api/student/assessments/[assessmentId]/submission` request body. */
export const submissionRequestSchema = z.object({
  contentText: z
    .string()
    .max(4000, "Submission content must be 4000 characters or fewer.")
    .optional(),
  action: z.enum(["saveDraft", "submit", "resubmit"]).default("submit"),
})
export type SubmissionRequest = z.infer<typeof submissionRequestSchema>

const importedQuizOptionSchema = z.object({
  optionId: z.string().optional(),
  text: nonEmptyString,
})

const importedQuizQuestionSchema = z
  .object({
    questionText: nonEmptyString,
    options: z.array(importedQuizOptionSchema).min(2, "Each question needs at least two options."),
    correctIndex: z.number().int().optional(),
    correctAnswerId: z.string().optional(),
    marks: z.number().positive().optional(),
  })
  .refine(
    (question) => question.correctIndex !== undefined || question.correctAnswerId !== undefined,
    {
      message: "Each question must include correctAnswerId or correctIndex.",
    },
  )

/** `POST /api/teacher/quiz` request body (legacy import shape). */
export const quizImportRequestSchema = z.object({
  quizMetadata: z.object({
    title: nonEmptyString,
    dueDate: z.string().optional(),
    courseId: z.string().optional(),
    course: z.string().optional(),
    totalMarks: z.number().positive().optional(),
  }),
  questions: z.array(importedQuizQuestionSchema).min(1, "Quiz must include at least one question."),
})
export type QuizImportRequest = z.infer<typeof quizImportRequestSchema>
