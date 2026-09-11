import { z } from "zod"

import { authUserResponseSchema } from "./auth"

export * from "./common"
export * from "./auth"
export * from "./gradebook"
export * from "./grading"
export * from "./quiz"
export * from "./quiz-generation"

/** `GET /api/auth/me` response. */
export const meResponseSchema = z.union([
  z.object({ authenticated: z.literal(false) }),
  z.object({ authenticated: z.literal(true), user: authUserResponseSchema }),
])
export type MeResponse = z.infer<typeof meResponseSchema>
