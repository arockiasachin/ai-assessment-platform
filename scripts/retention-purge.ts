import "dotenv/config"

import { runRetentionPurge } from "@/lib/retention/purge"

/**
 * Retention purge entry point for cron / manual operation.
 *
 * This project has no always-on worker and adds no scheduler dependency, so the
 * purge is a run-to-completion script. It is a dry run by default:
 *
 *   npm run retention:purge                 # report only, writes nothing
 *   npm run retention:purge -- --execute    # actually redact
 *
 * A typical cron entry (03:15 daily):
 *
 *   15 3 * * * cd /srv/assessment && npm run retention:purge -- --execute >> /var/log/retention.log 2>&1
 *
 * The script prints the same JSON report the admin route returns. It never
 * deletes a `Grade` or an `AuditLog` row; eligibility comes from the stored
 * `CourseOffering.resultsPublishedAt` and the server clock.
 */
async function main(): Promise<void> {
  const execute = process.argv.includes("--execute")
  const report = await runRetentionPurge({ dryRun: !execute })

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(
    execute
      ? `Retention purge complete: ${report.eligibleOfferings} eligible offering(s) processed.\n`
      : `Dry run only: nothing was written. Re-run with --execute to redact.\n`,
  )
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown error"
  process.stderr.write(`Retention purge failed: ${message}\n`)
  process.exitCode = 1
})
