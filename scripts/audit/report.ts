import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { z } from "zod"

import { FINDING_CATEGORIES, type AuditGroupId, type FindingCategory } from "./groups"

/**
 * Finding collection and report rendering.
 *
 * Two outputs, deliberately:
 *
 * 1. `scripts/audit/report-<timestamp>.md` (+ a `.json` sidecar) — the
 *    human-readable record of a single harness run, including which agents ran,
 *    how many tool calls they made and which ones failed.
 * 2. `docs/audit/<domain>-langchain.md` — the repo-wide convention that
 *    `npm run audit:dashboard` parses and compares against the native groups.
 *    The format is fixed by `docs/audit/README.md`: positional tables with exact
 *    columns, so a stray rename is a parse failure rather than a silent drop.
 *
 * The comparison only works if the LangChain findings land in (2) with the same
 * columns the native agents use, so the timestamped report is a convenience and
 * the group file is the deliverable.
 */

export const severitySchema = z.enum(["blocker", "major", "minor"])
export type Severity = z.infer<typeof severitySchema>

export const categorySchema = z.enum(FINDING_CATEGORIES)
export type Category = FindingCategory

const SEVERITY_RANK: Record<Severity, number> = { blocker: 0, major: 1, minor: 2 }

/**
 * What the model is trusted to supply.
 *
 * `whyItMatters` is optional on purpose. It is not a column in the shared
 * convention, and dropping an otherwise complete finding because the model
 * omitted one sentence would lose real coverage — the thing the audit exists to
 * measure. Missing ones are visible as "(not stated)" in the timestamped report.
 */
const rawFindingSchema = z.object({
  title: z.string().min(1),
  severity: severitySchema,
  category: categorySchema,
  location: z.string().min(1),
  evidence: z.string().min(1),
  whyItMatters: z.string().optional().default(""),
})
export type RawFinding = z.infer<typeof rawFindingSchema>

/**
 * Group/agent identity is stamped by the harness, not parsed from the model's
 * output: a model that mislabels its own group must not corrupt the grouping the
 * comparison depends on.
 */
export type Finding = RawFinding & {
  group: AuditGroupId
  agentId: string
  agent: string
}

export type AgentRunStatus = "completed" | "capped" | "failed"

export type AgentRun = {
  agentId: string
  agentTitle: string
  group: AuditGroupId
  status: AgentRunStatus
  /** Number of tool calls the agent actually made. */
  toolCalls: number
  /**
   * Tool calls the step cap refused. Counted separately from `toolCalls`: a
   * report that says "16 tool calls" when the budget was 14 reads as if the cap
   * did not apply.
   */
  blockedCalls: number
  /** Number of assistant turns, i.e. model calls between tool batches. */
  modelTurns: number
  findings: Finding[]
  /** Set when the findings block was missing or unparseable. */
  parseError?: string
  /** Set when the agent threw, timed out, or was aborted. */
  error?: string
  /** Free-text closing notes the agent wrote before its findings block. */
  notes?: string
  durationMs: number
}

export type ReportMeta = {
  generatedAt: Date
  baseUrl: string
  model: string
  baseModelUrl: string
  concurrency: number
  maxSteps: number
  groupIds: AuditGroupId[]
}

// ---------------------------------------------------------------------------
// Parsing the agent's closing findings block
// ---------------------------------------------------------------------------

const FINDINGS_BLOCK = /<AUDIT_FINDINGS>([\s\S]*?)<\/AUDIT_FINDINGS>/g

function stripFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim()
}

/**
 * Parse the findings an agent emitted.
 *
 * A delimited JSON block is used rather than LangChain's structured-output mode
 * because DeepSeek's tool-calling JSON support varies by endpoint, while plain
 * text is universally supported — and because this parser can be exercised with
 * a canned string, i.e. verified today without an API key. The trade-off is
 * that a malformed block has to be detected and reported rather than raised by
 * the framework, which is what `parseError` is for.
 */
export function parseFindings(
  text: string,
  meta: { group: AuditGroupId; agentId: string; agent: string },
): { findings: Finding[]; notes?: string; parseError?: string } {
  const blocks = [...text.matchAll(FINDINGS_BLOCK)]
  let payload: string | undefined
  let notes: string | undefined

  if (blocks.length > 0) {
    const last = blocks[blocks.length - 1]
    payload = last[1]
    notes = text.slice(0, last.index).trim() || undefined
  } else {
    // Fallback: a fenced json array. Models forget the exact tag fairly often;
    // recovering here is cheaper than a failed run.
    const fence = text.match(/```json\s*([\s\S]*?)```/g)
    if (fence && fence.length > 0) {
      payload = fence[fence.length - 1].replace(/```json\s*/i, "").replace(/```$/, "")
    }
  }

  if (payload === undefined) {
    return {
      findings: [],
      notes: text.trim() || undefined,
      parseError: "no <AUDIT_FINDINGS> block found in the agent's final message",
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(stripFence(payload))
  } catch (error) {
    return {
      findings: [],
      notes,
      parseError: `findings block was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  const array = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" &&
        parsed !== null &&
        Array.isArray((parsed as { findings?: unknown }).findings)
      ? (parsed as { findings: unknown[] }).findings
      : undefined
  if (!array) {
    return {
      findings: [],
      notes,
      parseError: "findings block was JSON but not an array of findings",
    }
  }

  const findings: Finding[] = []
  const rejected: string[] = []
  for (const candidate of array) {
    const result = rawFindingSchema.safeParse(candidate)
    if (result.success) {
      findings.push({ ...result.data, group: meta.group, agentId: meta.agentId, agent: meta.agent })
    } else {
      rejected.push(result.error.issues.map((issue) => issue.path.join(".") || "value").join(", "))
    }
  }

  return {
    findings,
    notes,
    parseError:
      rejected.length > 0
        ? `${rejected.length} finding(s) dropped for missing or invalid fields: ${rejected.join("; ")}`
        : undefined,
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function orderedFindings(runs: AgentRun[]): Finding[] {
  return runs
    .flatMap((run) => run.findings)
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.agentId.localeCompare(b.agentId),
    )
}

function severityCounts(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { blocker: 0, major: 0, minor: 0 }
  for (const finding of findings) counts[finding.severity] += 1
  return counts
}

export function buildSummary(runs: AgentRun[]) {
  const findings = runs.flatMap((run) => run.findings)
  const counts = severityCounts(findings)
  return {
    agents: runs.length,
    completed: runs.filter((run) => run.status === "completed").length,
    capped: runs.filter((run) => run.status === "capped").length,
    failed: runs.filter((run) => run.status === "failed").length,
    toolCalls: runs.reduce((total, run) => total + run.toolCalls, 0),
    blockedCalls: runs.reduce((total, run) => total + run.blockedCalls, 0),
    findings: findings.length,
    blockers: counts.blocker,
    majors: counts.major,
    minors: counts.minor,
  }
}

export function timestampSlug(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

// ---------------------------------------------------------------------------
// The per-run report
// ---------------------------------------------------------------------------

export function renderReport(runs: AgentRun[], meta: ReportMeta): string {
  const summary = buildSummary(runs)
  const lines: string[] = []

  lines.push("# LangChain audit run")
  lines.push("")
  lines.push(`- Generated: ${meta.generatedAt.toISOString()}`)
  lines.push(`- Base URL: ${meta.baseUrl}`)
  lines.push(`- Model: ${meta.model} at ${meta.baseModelUrl}`)
  lines.push(`- Groups: ${meta.groupIds.join(", ")}`)
  lines.push(`- Concurrency: ${meta.concurrency}; max tool calls per agent: ${meta.maxSteps}`)
  lines.push("")
  lines.push(
    "Findings carry the same fields the native audit groups produce (severity, category, title, evidence, location) so the two sets can be diffed side by side. The machine-readable half of this file lives beside it as JSON, and the comparison itself is written to `docs/audit/`.",
  )
  lines.push("")

  lines.push("## Summary")
  lines.push("")
  lines.push("| Metric | Value |")
  lines.push("| --- | --- |")
  lines.push(`| Agents run | ${summary.agents} |`)
  lines.push(`| Completed | ${summary.completed} |`)
  lines.push(`| Hit step cap | ${summary.capped} |`)
  lines.push(`| Failed | ${summary.failed} |`)
  lines.push(`| Tool calls | ${summary.toolCalls} |`)
  lines.push(`| Tool calls refused by the step cap | ${summary.blockedCalls} |`)
  lines.push(`| Findings | ${summary.findings} |`)
  lines.push(`| Blockers | ${summary.blockers} |`)
  lines.push(`| Majors | ${summary.majors} |`)
  lines.push(`| Minors | ${summary.minors} |`)
  lines.push("")

  lines.push("## Agent runs")
  lines.push("")
  lines.push("| Group | Agent | Status | Tool calls | Refused | Findings | Time |")
  lines.push("| --- | --- | --- | --- | --- | --- | --- |")
  for (const run of runs) {
    lines.push(
      `| ${run.group} | ${run.agentId} | ${run.status} | ${run.toolCalls} | ${run.blockedCalls} | ${run.findings.length} | ${seconds(run.durationMs)} |`,
    )
  }
  lines.push("")

  const findings = orderedFindings(runs)
  lines.push("## Findings")
  lines.push("")
  if (findings.length === 0) {
    lines.push(
      "No findings were reported. Check the agent-run table above for coverage before treating that as a clean bill of health.",
    )
    lines.push("")
  } else {
    findings.forEach((finding, index) => {
      lines.push(`### ${index + 1}. ${finding.title}`)
      lines.push("")
      lines.push(`- **Severity:** \`${finding.severity}\``)
      lines.push(`- **Category:** \`${finding.category}\``)
      lines.push(`- **Group:** ${finding.group} / ${finding.agentId}`)
      lines.push(`- **Location:** ${finding.location}`)
      lines.push(`- **Evidence:** ${finding.evidence}`)
      lines.push(`- **Why it matters:** ${finding.whyItMatters || "(not stated)"}`)
      lines.push("")
    })
  }

  const incomplete = runs.filter((run) => run.status !== "completed" || run.parseError)
  if (incomplete.length > 0) {
    lines.push("## Failed or incomplete agents")
    lines.push("")
    for (const run of incomplete) {
      lines.push(`### ${run.agentId} (${run.group}) — ${run.status}`)
      if (run.error) lines.push(`- Error: ${run.error}`)
      if (run.status === "capped") {
        lines.push(
          `- Stopped at the ${meta.maxSteps}-tool-call cap (${run.blockedCalls} call(s) refused); its findings are partial.`,
        )
      }
      if (run.parseError) lines.push(`- Finding parse: ${run.parseError}`)
      lines.push("")
    }
  }

  lines.push("---")
  lines.push("")
  lines.push(
    "Produced by LangChain agents driving this harness's tools against a running dev server. This supplements, and does not replace, the native audit groups: the coverage differs by construction, which is the point of running both.",
  )
  lines.push("")
  return lines.join("\n")
}

/** Machine-readable sidecar so the two audits can be diffed by script, not by eye. */
export function renderJson(runs: AgentRun[], meta: ReportMeta): string {
  return `${JSON.stringify(
    {
      generatedAt: meta.generatedAt.toISOString(),
      baseUrl: meta.baseUrl,
      model: meta.model,
      baseModelUrl: meta.baseModelUrl,
      concurrency: meta.concurrency,
      maxSteps: meta.maxSteps,
      groups: meta.groupIds,
      summary: buildSummary(runs),
      agentRuns: runs,
    },
    null,
    2,
  )}\n`
}

export async function writeReport(
  runs: AgentRun[],
  meta: ReportMeta,
  outDir: string,
): Promise<{ markdownPath: string; jsonPath: string }> {
  await mkdir(outDir, { recursive: true })
  const slug = timestampSlug(meta.generatedAt)
  const markdownPath = path.join(outDir, `report-${slug}.md`)
  const jsonPath = path.join(outDir, `report-${slug}.json`)
  await writeFile(markdownPath, renderReport(runs, meta), "utf8")
  await writeFile(jsonPath, renderJson(runs, meta), "utf8")
  return { markdownPath, jsonPath }
}

// ---------------------------------------------------------------------------
// The repo-wide group file (docs/audit/<domain>-langchain.md)
// ---------------------------------------------------------------------------

export const GROUP_FINDING_COLUMNS = [
  "id",
  "agent",
  "severity",
  "category",
  "title",
  "evidence",
  "location",
  "status",
  "dupOf",
] as const

const GROUP_FILE_AGENT_COUNT = 5

/** The `<domain>-langchain` id and finding-id prefix used by the convention. */
function groupFileId(domain: AuditGroupId): { id: string; prefix: string } {
  return domain === "teacher"
    ? { id: "teacher-langchain", prefix: "TL" }
    : { id: "student-langchain", prefix: "SL" }
}

/**
 * A Markdown table cell must not contain a newline or a bare `|`.
 *
 * The convention escapes a literal pipe as `\|`, and the parser treats a cell
 * with a line break as a malformed row, so both are normalised here rather than
 * left for the parser to reject.
 */
function cell(value: string): string {
  return value
    .replace(/\s*\r?\n\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim()
}

/**
 * Render a table the way Prettier does.
 *
 * `npm run format:check` covers `docs/**`, so a hand-rolled generator that
 * padded differently from Prettier would leave the repo failing its own gate
 * after every audit run. Prettier's rule is simple: every column is padded to
 * the widest cell in it, with a floor of three so the `| --- |` separator stays
 * valid.
 */
function renderTable(header: string[], rows: string[][]): string {
  const widths = header.map((heading, index) =>
    Math.max(3, heading.length, ...rows.map((row) => (row[index] ?? "").length)),
  )
  const renderRow = (cells: string[]) =>
    `| ${cells.map((value, index) => value.padEnd(widths[index])).join(" | ")} |`
  const separator = widths.map((width) => "-".repeat(width))
  return [renderRow(header), renderRow(separator), ...rows.map(renderRow)].join("\n")
}

export function renderGroupFile(domain: AuditGroupId, runs: AgentRun[]): string {
  const { id, prefix } = groupFileId(domain)
  const reported = runs.filter((run) => run.status !== "failed").length
  // "reported" with agentsReported < 5 is legitimate and is the honest state
  // for a run where some agents failed: the group did report, partially.
  const status = reported === 0 ? "failed" : "reported"

  const findings = orderedFindings(runs)
  const rows = findings.map((finding, index) => {
    const evidence = finding.whyItMatters
      ? `${finding.evidence} Why it matters: ${finding.whyItMatters}`
      : finding.evidence
    return [
      `${prefix}-${index + 1}`,
      cell(finding.agentId),
      finding.severity,
      finding.category,
      cell(finding.title),
      cell(evidence),
      cell(finding.location),
      "open",
      // dupOf is left empty: it names a finding in the sibling native file,
      // whose ids this harness cannot know. Duplicate detection is the
      // aggregator's job (docs/audit/README.md), not the agent's.
      "",
    ]
  })

  const groupTable = renderTable(
    ["field", "value"],
    [
      ["group", id],
      ["domain", domain],
      ["kind", "langchain"],
      ["status", status],
      ["agents", String(GROUP_FILE_AGENT_COUNT)],
      ["agentsReported", String(reported)],
    ],
  )

  const findingsTable = renderTable([...GROUP_FINDING_COLUMNS], rows)

  return `# Audit group — ${id}

<!--
  Generated by \`npm run audit:langchain\`. Do not edit by hand: re-running the
  harness overwrites this file.

  Findings for group \`${id}\`: the ${domain} domain, audited by the five
  independently-driven LangChain agents and compared finding-by-finding against
  \`${domain}-native.md\`. An empty findings table here means "the run reported
  no findings", never "not run" — the group \`status\` says which.

  The schema, the categories and the escaping rules are in docs/audit/README.md.
  Table columns are fixed and the aggregator fails loudly on a deviation, so a
  reordered column is a hard error rather than a silently dropped row.
-->

## Group

${groupTable}

## Findings

${findingsTable}
`
}

/**
 * Write one group file. The caller must only call this when every one of the
 * group's five agents was selected for the run: a partial run must leave the
 * file as "not-started" rather than claim coverage it did not have.
 */
export async function writeGroupFile(
  domain: AuditGroupId,
  runs: AgentRun[],
  outDir: string,
): Promise<string> {
  if (runs.length !== GROUP_FILE_AGENT_COUNT) {
    throw new Error(
      `refusing to write the ${domain} group file from ${runs.length} agent run(s); the convention fixes the group at ${GROUP_FILE_AGENT_COUNT}.`,
    )
  }
  if (runs.some((run) => run.group !== domain)) {
    throw new Error(`group file for "${domain}" was handed a run from another domain.`)
  }
  await mkdir(outDir, { recursive: true })
  const filePath = path.join(outDir, `${groupFileId(domain).id}.md`)
  await writeFile(filePath, renderGroupFile(domain, runs), "utf8")
  return filePath
}
