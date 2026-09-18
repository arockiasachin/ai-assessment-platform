import type { Prisma } from "@/lib/generated/prisma/client"
import { prisma } from "@/lib/prisma"

import { toRunEvidenceJson } from "./serialize"

/**
 * A reaper for runs that were left `RUNNING`.
 *
 * The submit pipeline reserves a slot by creating the `TestRun` as `RUNNING`,
 * then updates it with the result in a second transaction. A crash in between —
 * a killed dev server, a deploy, an OOM — leaves the row `RUNNING` with no
 * `finishedAt`, and nothing else ever touches it, so the Runs tab shows "Still
 * running" forever (SN-48).
 *
 * Full recovery is impossible: the sandbox output is gone. What can be done is to
 * stop the row lying. A run whose `startedAt` is older than any sandbox run could
 * plausibly be is marked `ERROR` with a message saying it did not report a result.
 *
 * **Why a grace period rather than the task's own `timeLimitMs`:** the limit bounds
 * the container, not the request; queueing and result formatting sit outside it. A
 * flat quarter-hour is far beyond any real run (the seeded tasks allow 5 s) and far
 * below anything a student would wait, so a run that is still genuinely in flight
 * is never reaped. The `RUNNING` status is only ever set at reservation and cleared
 * by the result transaction, so a row older than the grace period cannot be live.
 */
export const STUCK_RUN_GRACE_MS = 15 * 60 * 1000

export const STUCK_RUN_MESSAGE =
  "This run did not report a result — it was interrupted before it finished. Run your code again."

/**
 * Mark every stale `RUNNING` run as `ERROR`, returning how many were reaped.
 *
 * Deliberately global: the reaper is a repair for any stuck row, not only the
 * signed-in student's, and the query is served by the `(status, queuedAt)` index.
 */
export async function reapStuckRuns(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STUCK_RUN_GRACE_MS)
  const evidence = toRunEvidenceJson({
    results: [],
    timedOut: false,
    memoryExceeded: false,
    killMessage: STUCK_RUN_MESSAGE,
  }) as unknown as Prisma.InputJsonValue

  const result = await prisma.testRun.updateMany({
    where: {
      status: "RUNNING",
      OR: [{ startedAt: { lt: cutoff } }, { startedAt: null, queuedAt: { lt: cutoff } }],
    },
    data: {
      status: "ERROR",
      finishedAt: now,
      stderr: STUCK_RUN_MESSAGE,
      resultsJson: evidence,
    },
  })

  return result.count
}
