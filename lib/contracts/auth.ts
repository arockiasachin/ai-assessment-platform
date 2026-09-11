import { z } from "zod"

import { nonEmptyString } from "./common"

/** `POST /api/auth/login` request body. Every login goes through the database. */
export const loginRequestSchema = z.object({
  email: nonEmptyString,
  password: z.string().min(1, "Username/email and password are required."),
})
export type LoginRequest = z.infer<typeof loginRequestSchema>

/** `POST /api/auth/register` request body. Only teacher/student self-serve. */
export const registerRequestSchema = z.object({
  email: z.string().trim().min(3, "Email and password are required.").max(254),
  password: z.string().min(1, "Email and password are required."),
  role: z.enum(["teacher", "student"]).optional(),
})
export type RegisterRequest = z.infer<typeof registerRequestSchema>

/**
 * `POST /api/auth/seed` request body.
 *
 * The literal confirmation token means a stray or replayed request cannot reset
 * credentials by accident: the caller must opt in explicitly.
 */
export const SEED_CONFIRMATION_TOKEN = "RESET-SEED"
export const seedRequestSchema = z.object({
  confirm: z.literal(SEED_CONFIRMATION_TOKEN),
})
export type SeedRequest = z.infer<typeof seedRequestSchema>

export const authUserResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.enum(["admin", "teacher", "student"]),
})
