import { z } from "zod"

/**
 * Contracts for the observability surface: the health probe and the teacher
 * grade-activity view. Query params arrive as strings, so `limit` is coerced.
 */

export const gradeActivityQuerySchema = z.object({
  offeringId: z.string().trim().min(1, "offeringId is required."),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})
export type GradeActivityQueryInput = z.infer<typeof gradeActivityQuerySchema>

export const gradeActivityItemSchema = z.object({
  id: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  entityLabel: z.string(),
  assessmentId: z.string().nullable(),
  actorId: z.string().nullable(),
  actorRole: z.string().nullable(),
  /**
   * The actor's display name, or null when it cannot be resolved.
   *
   * A lookup rather than a stored fact — `AuditLog` keeps only an id and a role so
   * it survives user deletion — so a deleted actor is legitimately null.
   */
  actorName: z.string().nullable(),
  createdAt: z.string(),
  summary: z.unknown(),
})
export type GradeActivityItemResponse = z.infer<typeof gradeActivityItemSchema>

export const gradeActivityResponseSchema = z.object({
  success: z.literal(true),
  offeringId: z.string(),
  items: z.array(gradeActivityItemSchema),
  truncated: z.boolean(),
})
export type GradeActivityResponse = z.infer<typeof gradeActivityResponseSchema>

export const healthOverallStatusSchema = z.enum(["ok", "degraded"])
export const healthCheckStatusSchema = z.enum(["ok", "error", "timeout", "skipped"])
export const healthLlmModeSchema = z.enum(["offline", "live", "unknown"])

export const healthResponseSchema = z.object({
  success: z.literal(true),
  status: healthOverallStatusSchema,
  timestamp: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  version: z.string().nullable(),
  commit: z.string().nullable(),
  environment: z.string(),
  checks: z.object({
    app: z.literal("ok"),
    database: z.object({
      status: healthCheckStatusSchema,
      latencyMs: z.number().nonnegative().nullable(),
    }),
    llm: z.object({
      generation: z.object({
        provider: z.string(),
        mode: healthLlmModeSchema,
      }),
      embeddings: z.object({
        provider: z.string(),
        mode: healthLlmModeSchema,
      }),
    }),
  }),
})
export type HealthResponse = z.infer<typeof healthResponseSchema>
