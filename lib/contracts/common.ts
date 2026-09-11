import { z } from "zod"

/**
 * Shared building blocks for the API contract. Route handlers parse request
 * bodies with these schemas; the same shapes are exported for client fetchers
 * and tests so there is exactly one definition of each payload.
 */

export const nonEmptyString = z.string().trim().min(1)

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
