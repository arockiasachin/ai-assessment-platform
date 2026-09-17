import "dotenv/config"

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import { DeskClient, deskConfigFromEnv } from "./desk"
import { rewriteStatuses, readFindings, writeIfChanged } from "./findings"
import { planSync, summarisePlan, type Snapshot, type SyncAction } from "./status"

/**
 * Reconciles the audit reports with the support desk.
 *
 * The support desk is the system of record for a ticket's **status**; the reports
 * are the system of record for a finding's **content** — evidence, location,
 * severity, category. This script keeps the one field they both hold in step, and
 * refuses to guess when they disagree.
 *
 * The merge is three-way, against a snapshot of what the two sides agreed on last
 * time, so an edit on either side is carried across rather than clobbered. See the
 * long note in `status.ts` for why last-write-wins was rejected.
 *
 * Usage:
 *   npx tsx scripts/audit-sync/run.ts                 # apply
 *   npx tsx scripts/audit-sync/run.ts --dry-run        # show the plan only
 *   npx tsx scripts/audit-sync/run.ts --no-markdown    # push only, never edit reports
 */

const DEFAULT_AUDIT_DIR = join(process.cwd(), "docs", "audit")

/**
 * Where the last agreed state is kept.
 *
 * Deliberately gitignored. It is derived state, and committing it would mean a
 * merge conflict in a file no human wants to resolve. A fresh clone therefore
 * behaves as a first sighting — nothing is changed on the first run, which is the
 * safe default — and starts reconciling from the second.
 */
const SNAPSHOT_PATH = join(DEFAULT_AUDIT_DIR, ".sync-state.json")

const STATUS_LABEL: Record<SyncAction["kind"], string> = {
  push: "report → desk",
  pull: "desk → report",
  converged: "already agreed",
  conflict: "CONFLICT",
  noop: "no change",
  "missing-ticket": "no ticket",
}

function parseArgs(argv: string[]) {
  const dryRun = argv.includes("--dry-run")
  const markdown = !argv.includes("--no-markdown")
  const dirIndex = argv.indexOf("--dir")
  const auditDir = dirIndex >= 0 ? argv[dirIndex + 1] : DEFAULT_AUDIT_DIR
  const verbose = argv.includes("--verbose")
  return { dryRun, markdown, auditDir, verbose }
}

async function loadSnapshot(path: string): Promise<Snapshot> {
  try {
    const raw = await readFile(path, "utf8")
    const parsed = JSON.parse(raw) as Snapshot
    return typeof parsed === "object" && parsed !== null ? parsed : {}
  } catch {
    // Absent or unreadable: treat as a first sighting rather than failing. A
    // first run must never act on data it does not have.
    return {}
  }
}

async function saveSnapshot(path: string, snapshot: Snapshot): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8")
}

async function main() {
  const { dryRun, markdown, auditDir, verbose } = parseArgs(process.argv.slice(2))

  process.stdout.write(`\n  Audit ⇄ Support Desk sync\n`)
  process.stdout.write(`  reports: ${auditDir}\n`)
  process.stdout.write(
    `  mode:    ${dryRun ? "dry run" : "apply"}${markdown ? "" : ", reports read-only"}\n\n`,
  )

  const { findings, reportsUpdatedAt, files } = await readFindings(auditDir)
  process.stdout.write(`  read ${findings.length} finding(s) from ${files.length} report(s)\n`)

  const config = deskConfigFromEnv()
  const desk = new DeskClient(config)
  await desk.signIn()

  const tickets = await desk.listTickets()
  process.stdout.write(`  read ${tickets.length} reconciled ticket(s) from the desk\n\n`)

  const snapshot = await loadSnapshot(SNAPSHOT_PATH)
  const plan = planSync({ findings, tickets, snapshot, reportsUpdatedAt })
  const counts = summarisePlan(plan)

  // The plan is printed in full before anything is written, so a dry run is a
  // genuine preview and an apply can be reviewed afterwards from scrollback.
  const interesting = plan.actions.filter((action) =>
    verbose ? true : action.kind !== "noop" && action.kind !== "missing-ticket",
  )
  for (const action of interesting) {
    process.stdout.write(`    [${STATUS_LABEL[action.kind]}] ${action.findingId}`)
    if (action.kind === "conflict") {
      process.stdout.write(` — report says "${action.md}", desk says "${action.desk}"`)
    }
    process.stdout.write(`\n        ${action.reason}\n`)
  }

  process.stdout.write(
    `\n  plan: ${counts.push} to push, ${counts.pull} to pull, ${counts.conflict} conflict(s), ` +
      `${counts.noop} unchanged, ${counts["missing-ticket"]} without a ticket\n\n`,
  )

  if (dryRun) {
    process.stdout.write("  Dry run complete; nothing was written.\n\n")
    return
  }

  // 1. Push: report → desk.
  let pushed = 0
  for (const action of plan.actions) {
    if (action.kind !== "push") continue
    await desk.setStatus(action.ticketId, action.to)
    pushed += 1
  }

  // 2. Pull: desk → report.
  const updatesByFile = new Map<string, Map<string, "open" | "fixed" | "wontfix">>()
  if (markdown) {
    for (const action of plan.actions) {
      const next =
        action.kind === "pull"
          ? action.to
          : action.kind === "conflict" && action.winner === "desk"
            ? action.desk
            : null
      if (!next) continue

      const file = files.find((entry) => entry.group === findingGroupOf(action.findingId))
      if (!file) continue

      const updates = updatesByFile.get(file.path) ?? new Map()
      updates.set(action.findingId, next)
      updatesByFile.set(file.path, updates)
    }
  }

  let rewritten = 0
  for (const [path, updates] of updatesByFile) {
    const contents = await rewriteStatuses(path, updates)
    if (await writeIfChanged(path, contents)) rewritten += 1
  }

  await saveSnapshot(SNAPSHOT_PATH, plan.nextSnapshot)

  process.stdout.write(
    `  applied: ${pushed} ticket(s) updated, ${rewritten} report file(s) rewritten, snapshot saved\n`,
  )

  if (rewritten > 0) {
    process.stdout.write(
      `  note: run \`npx prettier --write docs/audit\` to restore table alignment\n`,
    )
  }

  if (counts.conflict > 0) {
    process.stdout.write(
      `\n  ${counts.conflict} conflict(s) were resolved by time and are listed above. ` +
        `Set the losing side explicitly if any resolution was wrong.\n`,
    )
  }

  process.stdout.write("\n")
}

/** `TN-12` → `teacher-native`. Derived from the id prefix, matching the reports. */
function findingGroupOf(findingId: string): string {
  if (findingId.startsWith("TN")) return "teacher-native"
  if (findingId.startsWith("TL")) return "teacher-langchain"
  if (findingId.startsWith("SN")) return "student-native"
  if (findingId.startsWith("SL")) return "student-langchain"
  return ""
}

main().catch((error) => {
  process.stderr.write(
    `\n  sync failed: ${error instanceof Error ? error.message : String(error)}\n\n`,
  )
  process.exitCode = 1
})
