/**
 * Audit dashboard refresh.
 *
 *   npm run audit:dashboard
 *
 * Reads the four `docs/audit/<group>.md` files, validates every table, writes
 * the consolidated `docs/audit/aggregate.json`, and re-embeds that aggregate
 * into the Cursor canvas the owner opens beside chat, so one command produces
 * both the durable data and the live view.
 *
 * It does not touch the application, the database, the dev server or the
 * LangChain audit runner: other audit groups are working in this checkout, and
 * the dashboard is the progress view rather than something that produces
 * findings.
 */

import { readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

import { CATEGORIES, FINDING_STATUSES, SEVERITIES } from "./groups"
import { AuditFormatError } from "./parse"
import { buildAggregate } from "./aggregate"
import { AGGREGATE_PATH, REPO_ROOT, humanPath, isNotFound, readGroupFiles } from "./read"

/**
 * The canvas lives outside the repo, in the Cursor-managed projects directory,
 * so its path is derived rather than configured: `~/.cursor/projects/<repo path
 * with separators replaced>/canvases/`. The trade-off is that a different
 * machine's layout would need `AUDIT_CANVAS_PATH`; a missing canvas is a
 * warning, not a failure, because `aggregate.json` is the durable artifact.
 */
const CANVAS_PATH =
  process.env.AUDIT_CANVAS_PATH ??
  path.join(
    homedir(),
    ".cursor",
    "projects",
    REPO_ROOT.replace(/^\//, "").split("/").join("-"),
    "canvases",
    "audit-dashboard.canvas.tsx",
  )

/** Markers between which `run` owns the data block. Keep in step with the canvas. */
const DATA_BEGIN = "// audit-dashboard:data:begin"
const DATA_END = "// audit-dashboard:data:end"

/** Replace the generated data block, leaving the rest of the canvas untouched. */
async function injectCanvasData(aggregate: unknown): Promise<string> {
  const text = await readFile(CANVAS_PATH, "utf8")
  const lines = text.split(/\r?\n/)

  const begin = lines.findIndex((line) => line.trim() === DATA_BEGIN)
  const end = lines.findIndex((line, index) => index > begin && line.trim() === DATA_END)
  if (begin < 0 || end < 0) {
    throw new AuditFormatError(
      `${humanPath(CANVAS_PATH)} is missing the ${DATA_BEGIN} / ${DATA_END} markers, so the generated data block cannot be replaced. Restore them from git or re-create the canvas.`,
    )
  }

  // The whole declaration is generated, not just the literal: an earlier
  // version kept `const DATA: AuditAggregate =` outside the markers and the
  // first refresh deleted it, because the block between the markers is replaced
  // wholesale. The value goes through `unknown` because the aggregate is a
  // superset of the canvas's hand-written `AuditAggregate` view — adding a field
  // to the aggregator must not become a type error in a file the aggregator does
  // not own, and the canvas can adopt the field on its own schedule.
  const dataLines = [
    "// Generated from docs/audit/*.md by `npm run audit:dashboard`. Do not edit.",
    ...`const DATA = ${JSON.stringify(aggregate, null, 2)} as unknown as AuditAggregate`.split(
      "\n",
    ),
  ]
  const next = [...lines.slice(0, begin + 1), ...dataLines, ...lines.slice(end)]
  await writeFile(CANVAS_PATH, next.join("\n"), "utf8")
  return humanPath(CANVAS_PATH)
}

function report(aggregate: ReturnType<typeof buildAggregate>, canvasNote: string): string {
  const { totals } = aggregate
  const lines: string[] = []

  lines.push("")
  lines.push(
    `Audit dashboard — ${totals.findings} finding row(s) recorded (${totals.distinct} distinct, ${totals.duplicates} linked duplicate(s)), ${totals.groupsReported}/${totals.groups} group(s) reported, ${totals.agentsReported}/${totals.agents} agent(s) reported.`,
  )
  if (totals.findings === 0) {
    lines.push(
      "No findings have been recorded yet. That means no group has filed anything — it is not a clean result.",
    )
  }
  lines.push("")

  for (const group of aggregate.groups) {
    lines.push(
      `  ${group.id.padEnd(20)} ${group.status.padEnd(12)} agents ${group.agentsReported}/${group.agents}  ` +
        `findings ${group.total} (${group.distinct} distinct, ${group.duplicates} linked duplicate(s))  ` +
        `(${SEVERITIES.map((severity) => `${group.bySeverity[severity]} ${severity}`).join(", ")})`,
    )
  }

  if (totals.findings > 0) {
    lines.push("")
    lines.push(
      `  Totals: ${FINDING_STATUSES.map((status) => `${totals.byStatus[status]} ${status}`).join(", ")}`,
    )
    lines.push(
      `  Categories: ${CATEGORIES.map((category) => `${category} ${totals.byCategory[category]}`).join(", ")}`,
    )
  }

  lines.push("")
  lines.push("Comparison (match key = category + location; see docs/audit/README.md):")
  for (const comparison of aggregate.comparisons) {
    lines.push(
      `  ${comparison.domain.padEnd(8)} native ${comparison.native.total} (${comparison.native.distinct} distinct) vs ` +
        `langchain ${comparison.langchain.total} (${comparison.langchain.distinct} distinct)  ` +
        `unique: ${comparison.uniqueToNative.length} native / ${comparison.uniqueToLangchain.length} langchain  ` +
        `shared ${comparison.shared.length}`,
    )
  }

  lines.push("")
  lines.push(`Wrote ${humanPath(AGGREGATE_PATH)}`)
  lines.push(canvasNote)
  lines.push("")

  return lines.join("\n")
}

async function main(): Promise<void> {
  const result = await readGroupFiles()
  // The CLI has nothing to fall back on, so every problem reported by the
  // shared reader aborts the run in one message; the server keeps serving.
  if (!result.ok) throw new AuditFormatError(result.errors.join("\n  "))

  const aggregate = buildAggregate(result.parsed, new Date().toISOString())

  await writeFile(AGGREGATE_PATH, `${JSON.stringify(aggregate, null, 2)}\n`, "utf8")

  let canvasNote: string
  try {
    const updated = await injectCanvasData(aggregate)
    canvasNote = `Updated ${updated}`
  } catch (error) {
    if (isNotFound(error)) {
      canvasNote = `Canvas not found at ${CANVAS_PATH}; skipped. Set AUDIT_CANVAS_PATH to update one elsewhere.`
    } else {
      throw error
    }
  }

  process.stdout.write(report(aggregate, canvasNote))
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`Audit dashboard failed:\n  ${message}\n`)
  process.exitCode = 1
})
