import { z } from "zod"

/**
 * Shared building blocks for the API contract. Route handlers parse request
 * bodies with these schemas; the same shapes are exported for client fetchers
 * and tests so there is exactly one definition of each payload.
 */

export const nonEmptyString = z.string().trim().min(1)

/**
 * A string JavaScript can parse into a real `Date`. Rejecting invalid dates at
 * the contract boundary keeps them from reaching Prisma, where an `Invalid Date`
 * surfaces as a raw `PrismaClientValidationError` (with internal file paths) that
 * routes used to echo back to the caller.
 */
export const parseableDateString = z
  .string()
  .trim()
  .min(1, "A date is required.")
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "Invalid date.",
  })

/** Turn a failed `safeParse` into a single human-readable message. */
export function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return "Invalid request body."
  return issue.message
}

/** Standard error envelope every JSON route handler returns. */
export const errorResponseSchema = z.object({
  success: z.literal(false),
  message: z.string(),
})
export type ErrorResponse = z.infer<typeof errorResponseSchema>

export const successResponseSchema = z.object({
  success: z.literal(true),
  message: z.string().optional(),
})
export type SuccessResponse = z.infer<typeof successResponseSchema>
