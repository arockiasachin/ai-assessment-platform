import { z } from "zod"

import { nonEmptyString, parseableDateString } from "./common"

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
  /**
   * The offering the assessment belongs to. Required on purpose: a teacher can
   * teach the same course in several offerings (different class/section/term),
   * and resolving by `courseId` alone silently wrote the assessment into the
   * wrong class. `courseId`/`classId` are derived server-side from this offering
   * and are deliberately not accepted from the client.
   */
  offeringId: nonEmptyString,
  /**
   * The kind of assessment being created.
   *
   * **Widened from `Quiz | Assignment` to every kind the schema holds.** The narrow pair meant a
   * teacher could not author a descriptive, code or group-project assessment from the gradebook at
   * all — the other three exist in `AssessmentType` and are used throughout the app, so the create
   * path was the only thing that could not produce them. `Quiz | Assignment` was also the last place
   * carrying its own Title Case vocabulary; the values are the enum's now, so there is no translation
   * table and nothing for a second vocabulary to drift against.
   */
  type: z.enum(["QUIZ", "ASSIGNMENT", "DESCRIPTIVE", "CODE", "GROUP_PROJECT"]),
  date: parseableDateString,
  // 32-bit Postgres `Int` column: an unbounded value is a Prisma validation
  // error, not a clean client error.
  maxMarks: z.coerce.number().int().positive().max(1_000_000, "Max marks is too large."),
})
export type CreateAssessmentRequest = z.infer<typeof createAssessmentRequestSchema>

/**
 * `PATCH /api/gradebook/assessments/[assessmentId]` request body.
 *
 * `type` is deliberately not editable. Flipping a QUIZ that already has questions into an
 * ASSIGNMENT (or a CODE assessment with a code task into a quiz) is not a rename — it changes
 * what the assessment's children mean. A mis-kinded assessment is deleted and re-created while
 * it is still bare. `maxMarks` is accepted here but the service refuses it once marks exist,
 * because a changed ceiling would silently rescale recorded results.
 */
export const updateAssessmentRequestSchema = z
  .object({
    title: nonEmptyString.optional(),
    date: parseableDateString.optional(),
    maxMarks: z.coerce
      .number()
      .int()
      .positive()
      .max(1_000_000, "Max marks is too large.")
      .optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined || value.date !== undefined || value.maxMarks !== undefined,
    {
      message: "At least one field must be provided.",
    },
  )
export type UpdateAssessmentRequest = z.infer<typeof updateAssessmentRequestSchema>

/** `PUT /api/teacher/offerings/[offeringId]` request body. */
export const updateOfferingRequestSchema = z.object({
  studentLimit: z.coerce.number().int().min(1).max(500),
  registrationOpenAt: parseableDateString.nullable().optional(),
  registrationCloseAt: parseableDateString.nullable().optional(),
  startsOn: parseableDateString.nullable().optional(),
  endsOn: parseableDateString.nullable().optional(),
})
export type UpdateOfferingRequest = z.infer<typeof updateOfferingRequestSchema>

/** `POST /api/student/courses/rating` request body. */
export const courseRatingRequestSchema = z.object({
  offeringId: nonEmptyString,
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
})
export type CourseRatingRequest = z.infer<typeof courseRatingRequestSchema>

/** One rating row in a teacher's course-ratings report. */
export const courseRatingItemSchema = z.object({
  id: z.string(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().nullable(),
  /**
   * Whether this rating was processed by a retention sweep.
   *
   * **It does not mean "a comment was removed."** The purge stamps `purgedAt` on
   * every rating in an offering, comment or not — the marker is what makes the
   * sweep idempotent (`where: purgedAt: null`) and what the operator's count
   * reports. So after a purge, a rating where the student never wrote anything is
   * indistinguishable here from one whose text was redacted, and the UI must make
   * an **offering-level** claim rather than a per-row one.
   */
  purged: z.boolean(),
  studentName: z.string(),
  registerNumber: z.string(),
  updatedAt: z.string(),
})
export type CourseRatingItem = z.infer<typeof courseRatingItemSchema>

/** Aggregate rating report for one teacher-owned offering. */
export const courseOfferingRatingsReportSchema = z.object({
  offeringId: z.string(),
  courseCode: z.string(),
  courseName: z.string(),
  className: z.string(),
  term: z.string(),
  academicYear: z.number().int(),
  ratingsCount: z.number().int().nonnegative(),
  averageRating: z.number().nullable(),
  ratings: z.array(courseRatingItemSchema),
})
export type CourseOfferingRatingsReport = z.infer<typeof courseOfferingRatingsReportSchema>

/** `GET /api/teacher/reports/ratings` response. */
export const courseRatingsReportResponseSchema = z.object({
  offerings: z.array(courseOfferingRatingsReportSchema),
})
export type CourseRatingsReportResponse = z.infer<typeof courseRatingsReportResponseSchema>

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

/**
 * `POST /api/teacher/quiz` request body (JSON quiz import).
 *
 * `offeringId` is required for the same reason the create-assessment contract
 * requires it: a teacher can teach the same course in several offerings, and
 * resolving by `courseId`/course name silently imported the quiz into the wrong
 * class. The offering is resolved and ownership-checked server-side; the legacy
 * `quizMetadata.courseId`/`quizMetadata.course` keys are no longer read.
 */
export const quizImportRequestSchema = z.object({
  offeringId: nonEmptyString,
  quizMetadata: z.object({
    title: nonEmptyString,
    dueDate: z.string().optional(),
    totalMarks: z.number().positive().optional(),
  }),
  questions: z.array(importedQuizQuestionSchema).min(1, "Quiz must include at least one question."),
})
export type QuizImportRequest = z.infer<typeof quizImportRequestSchema>
