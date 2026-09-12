import { NextResponse } from "next/server"

import { parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { retentionPurgeRequestSchema } from "@/lib/contracts"
import { runRetentionPurge } from "@/lib/retention/purge"

/**
 * Admin-only retention purge trigger.
 *
 * `POST /api/admin/retention/purge` with `{ "dryRun": true }` (the default)
 * reports exactly what would be redacted without writing. `{ "dryRun": false }`
 * performs the redaction. Eligibility (results published ≥ 15 days ago) is
 * always derived server-side from `CourseOffering.resultsPublishedAt`; the
 * request cannot name an offering or a cutoff.
 *
 * There is no scheduler in this project. For an unattended run, schedule the
 * `retention:purge` npm script (`npm run retention:purge -- --execute`) from
 * cron; see docs/privacy/retention-policy.md.
 */
export async function POST(request: Request) {
  const auth = await requireRole("admin")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, retentionPurgeRequestSchema)
  if (!parsed.ok) return parsed.response

  const report = await runRetentionPurge({ dryRun: parsed.data.dryRun })

  return NextResponse.json({ success: true, ...report })
}
