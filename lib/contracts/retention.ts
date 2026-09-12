import { z } from "zod"

/**
 * `POST /api/admin/retention/purge` body.
 *
 * `dryRun` defaults to `true`: an admin must explicitly send `{ "dryRun": false }`
 * to write. Reporting what would be purged is always safe; the destructive path
 * is always opt-in.
 */
export const retentionPurgeRequestSchema = z.object({
  dryRun: z.boolean().default(true),
})

export type RetentionPurgeRequest = z.infer<typeof retentionPurgeRequestSchema>
