/**
 * Markdown table parsing and validation for the audit report convention.
 *
 * The parser is strict by design. A dashboard that silently drops a row it
 * cannot read under-reports the audit, which is worse than refusing to render,
 * so every deviation — a renamed column, a bad severity, a duplicate id, a row
 * with the wrong number of cells — throws `AuditFormatError` naming the file,
 * the table and the line. `docs/audit/README.md` documents the shape it
 * enforces.
 */

import {
  CATEGORIES,
  FINDING_COLUMNS,
  FINDING_STATUSES,
  GROUP_FIELDS,
  GROUP_STATUSES,
  REQUIRED_FINDING_COLUMNS,
  SEVERITIES,
  siblingGroup,
  type Finding,
  type GroupDefinition,
  type GroupStatus,
} from "./groups"

export type ParsedGroup = {
  definition: GroupDefinition
  status: GroupStatus
  agents: number
  agentsReported: number
  findings: Finding[]
}

type RawRow = { cells: string[]; line: number }

/** Malformed audit data. The message always locates the problem precisely. */
export class AuditFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AuditFormatError"
  }
}

function fail(filePath: string, line: number, message: string): never {
  throw new AuditFormatError(
    line > 0 ? `${filePath}:${line}: ${message}` : `${filePath}: ${message}`,
  )
}

/**
 * Split one Markdown table row into cells.
 *
 * `\|` is the escape for a literal pipe, so a plain `split("|")` would be
 * wrong for evidence cells that quote a shell command or a status pair. Cells
 * are trimmed; the surrounding table formatting is not otherwise interpreted.
 */
function splitRow(raw: string): string[] {
  let body = raw.trim()
  if (body.startsWith("|")) body = body.slice(1)
  if (body.endsWith("|") && !body.endsWith("\\|")) body = body.slice(0, -1)

  const cells: string[] = []
  let current = ""
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i]
    if (char === "\\" && body[i + 1] === "|") {
      current += "|"
      i += 1
      continue
    }
    if (char === "|") {
      cells.push(current.trim())
      current = ""
      continue
    }
    current += char
  }
  cells.push(current.trim())
  return cells
}

function isSeparatorCell(cell: string): boolean {
  return /^:?-{3,}:?$/.test(cell)
}

function findHeading(lines: string[], pattern: RegExp, filePath: string, label: string): number {
  const hits: number[] = []
  lines.forEach((line, index) => {
    if (pattern.test(line)) hits.push(index)
  })
  if (hits.length === 0) fail(filePath, 0, `no "## ${label}" section found.`)
  if (hits.length > 1) {
    fail(filePath, hits[1] + 1, `duplicate "## ${label}" section; each file has exactly one.`)
  }
  return hits[0]
}

/** Body lines of a section: everything up to the next `##` heading or EOF. */
function sectionBody(lines: string[], headingIndex: number): { body: string[]; bodyStart: number } {
  let end = lines.length
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) {
      end = i
      break
    }
  }
  return { body: lines.slice(headingIndex + 1, end), bodyStart: headingIndex + 1 }
}

function extractTable(
  body: string[],
  bodyStart: number,
  filePath: string,
  label: string,
): { header: RawRow; rows: RawRow[] } {
  const first = body.findIndex((line) => line.trim().startsWith("|"))
  if (first < 0) fail(filePath, bodyStart + 1, `"## ${label}" has no Markdown table.`)

  const tableLines: RawRow[] = []
  for (let i = first; i < body.length; i += 1) {
    const line = body[i]
    if (!line.trim().startsWith("|")) break
    tableLines.push({ cells: splitRow(line), line: bodyStart + i + 1 })
  }

  if (tableLines.length < 2) {
    fail(
      filePath,
      tableLines[0].line,
      `"## ${label}" table needs a header row and a separator row (\`| --- |\`).`,
    )
  }

  const header = tableLines[0]
  const separator = tableLines[1]
  if (!separator.cells.every(isSeparatorCell)) {
    fail(
      filePath,
      separator.line,
      `"## ${label}" is missing its separator row (\`| --- |\`); line 2 of the table is data.`,
    )
  }
  if (separator.cells.length !== header.cells.length) {
    fail(
      filePath,
      separator.line,
      `"## ${label}" separator has ${separator.cells.length} cells but the header has ${header.cells.length}.`,
    )
  }

  return { header, rows: tableLines.slice(2) }
}

function assertColumns(
  header: RawRow,
  expected: readonly string[],
  filePath: string,
  label: string,
): void {
  const actual = header.cells
  const matches =
    actual.length === expected.length && actual.every((cell, index) => cell === expected[index])
  if (!matches) {
    fail(
      filePath,
      header.line,
      `"## ${label}" columns must be exactly: ${expected.map((column) => `\`${column}\``).join(", ")}. Found: ${actual.map((cell) => `\`${cell}\``).join(", ")}.`,
    )
  }
}

function requireNonEmpty(value: string, column: string, filePath: string, row: RawRow): string {
  if (value.length === 0) {
    fail(filePath, row.line, `findings row is missing \`${column}\`.`)
  }
  return value
}

function requireOneOf<T extends string>(
  value: string,
  allowed: readonly T[],
  column: string,
  filePath: string,
  row: RawRow,
): T {
  if (!(allowed as readonly string[]).includes(value)) {
    fail(
      filePath,
      row.line,
      `\`${column}\` is "${value}", which is not one of: ${allowed.join(", ")}.`,
    )
  }
  return value as T
}

function parseGroupBlock(
  body: string[],
  bodyStart: number,
  filePath: string,
  definition: GroupDefinition,
): { status: GroupStatus; agents: number; agentsReported: number } {
  const { header, rows } = extractTable(body, bodyStart, filePath, "Group")
  assertColumns(header, ["field", "value"], filePath, "Group")

  const fields = new Map<string, string>()
  for (const row of rows) {
    if (row.cells.length !== 2) {
      fail(
        filePath,
        row.line,
        `group row must have exactly two cells (\`field\` and \`value\`); found ${row.cells.length}.`,
      )
    }
    const [field, value] = row.cells
    if (!(GROUP_FIELDS as readonly string[]).includes(field)) {
      fail(
        filePath,
        row.line,
        `unknown group field "${field}"; allowed fields: ${GROUP_FIELDS.join(", ")}.`,
      )
    }
    if (fields.has(field)) fail(filePath, row.line, `group field "${field}" appears twice.`)
    fields.set(field, value)
  }

  const missing = GROUP_FIELDS.filter((field) => !fields.has(field))
  if (missing.length > 0) {
    fail(filePath, header.line, `group table is missing: ${missing.join(", ")}.`)
  }

  const value = (field: (typeof GROUP_FIELDS)[number]): string => {
    const found = fields.get(field)
    if (found === undefined || found.length === 0) {
      fail(filePath, header.line, `group field "${field}" is empty.`)
    }
    return found
  }

  const group = value("group")
  if (group !== definition.id) {
    fail(
      filePath,
      header.line,
      `group id is "${group}" but this file is ${definition.id}.md, whose id must be "${definition.id}".`,
    )
  }

  const domain = value("domain")
  if (domain !== definition.domain) {
    fail(
      filePath,
      header.line,
      `domain is "${domain}" but ${definition.id} is a ${definition.domain} group.`,
    )
  }

  const kind = value("kind")
  if (kind !== definition.kind) {
    fail(
      filePath,
      header.line,
      `kind is "${kind}" but ${definition.id} is a ${definition.kind} group.`,
    )
  }

  const status = requireOneOf(value("status"), GROUP_STATUSES, "status", filePath, {
    cells: [],
    line: header.line,
  })

  const integer = (field: "agents" | "agentsReported"): number => {
    const raw = value(field)
    if (!/^\d+$/.test(raw)) {
      fail(
        filePath,
        header.line,
        `group field "${field}" must be a non-negative integer; found "${raw}".`,
      )
    }
    return Number(raw)
  }
  const agents = integer("agents")
  const agentsReported = integer("agentsReported")

  if (agents !== definition.agents) {
    fail(
      filePath,
      header.line,
      `agents is ${agents} but the audit fixes ${definition.id} at ${definition.agents} agents.`,
    )
  }
  if (agentsReported > agents) {
    fail(
      filePath,
      header.line,
      `agentsReported is ${agentsReported}, which exceeds agents (${agents}).`,
    )
  }

  return { status, agents, agentsReported }
}

function parseFindings(
  body: string[],
  bodyStart: number,
  filePath: string,
  definition: GroupDefinition,
): Finding[] {
  const { header, rows } = extractTable(body, bodyStart, filePath, "Findings")
  assertColumns(header, FINDING_COLUMNS, filePath, "Findings")

  const findings: Finding[] = []
  const seen = new Set<string>()

  for (const row of rows) {
    if (
      row.cells.length !== FINDING_COLUMNS.length &&
      row.cells.length !== REQUIRED_FINDING_COLUMNS
    ) {
      fail(
        filePath,
        row.line,
        `findings row has ${row.cells.length} cells; expected ${FINDING_COLUMNS.length} (the last, \`dupOf\`, may be omitted to give ${REQUIRED_FINDING_COLUMNS}).`,
      )
    }

    const cells = row.cells
    const id = cells[0]
    const agent = cells[1]
    const severity = cells[2]
    const category = cells[3]
    const title = cells[4]
    const evidence = cells[5]
    const location = cells[6]
    const status = cells[7]
    const dupOf: string | undefined =
      cells.length > REQUIRED_FINDING_COLUMNS ? cells[REQUIRED_FINDING_COLUMNS] : undefined

    requireNonEmpty(id, "id", filePath, row)
    if (seen.has(id)) fail(filePath, row.line, `duplicate finding id "${id}" in ${definition.id}.`)
    seen.add(id)

    const finding: Finding = {
      id,
      group: definition.id,
      domain: definition.domain,
      kind: definition.kind,
      agent: requireNonEmpty(agent, "agent", filePath, row),
      severity: requireOneOf(severity, SEVERITIES, "severity", filePath, row),
      category: requireOneOf(category, CATEGORIES, "category", filePath, row),
      title: requireNonEmpty(title, "title", filePath, row),
      evidence: requireNonEmpty(evidence, "evidence", filePath, row),
      location: requireNonEmpty(location, "location", filePath, row),
      status: requireOneOf(status, FINDING_STATUSES, "status", filePath, row),
    }
    if (dupOf !== undefined && dupOf.length > 0) finding.dupOf = dupOf

    findings.push(finding)
  }

  return findings
}

export function parseGroupFile(input: {
  filePath: string
  text: string
  definition: GroupDefinition
}): ParsedGroup {
  const { filePath, text, definition } = input
  const lines = text.split(/\r?\n/)

  const groupHeading = findHeading(lines, /^##\s+Group\s*$/, filePath, "Group")
  const findingsHeading = findHeading(lines, /^##\s+Findings\s*$/, filePath, "Findings")
  if (groupHeading > findingsHeading) {
    fail(filePath, findingsHeading + 1, `"## Findings" must come after "## Group".`)
  }

  const groupSection = sectionBody(lines, groupHeading)
  const findingsSection = sectionBody(lines, findingsHeading)

  const meta = parseGroupBlock(groupSection.body, groupSection.bodyStart, filePath, definition)
  const findings = parseFindings(
    findingsSection.body,
    findingsSection.bodyStart,
    filePath,
    definition,
  )

  // A file that has not started must be genuinely untouched. Without this the
  // tempting shortcut — paste findings and forget the metadata — would make a
  // running audit look not-started on the dashboard, which is the exact
  // confusion the convention exists to prevent.
  if (meta.status === "not-started" && (findings.length > 0 || meta.agentsReported > 0)) {
    fail(
      filePath,
      groupHeading + 1,
      `status is "not-started" but the file has ${findings.length} finding(s) and agentsReported=${meta.agentsReported}. Update the group table when the group runs.`,
    )
  }

  return {
    definition,
    status: meta.status,
    agents: meta.agents,
    agentsReported: meta.agentsReported,
    findings,
  }
}

/**
 * Cross-file check: a `dupOf` must name a finding that actually exists, either
 * in the same group (the same defect filed twice by two agents) or in the
 * sibling group of the same domain (a native row linked to its LangChain twin).
 * Run after every file has parsed, because a dangling reference is exactly the
 * kind of typo that would silently pair nothing and inflate the "unique to one
 * kind" count.
 */
export function validateDupOf(groups: ParsedGroup[]): void {
  const byGroup = new Map(groups.map((group) => [group.definition.id, group]))
  for (const group of groups) {
    const sibling = siblingGroup(group.definition)
    const siblingFindings = byGroup.get(sibling.id)?.findings ?? []
    const siblingIds = new Set(siblingFindings.map((finding) => finding.id))
    const ownIds = new Set(group.findings.map((finding) => finding.id))

    for (const finding of group.findings) {
      if (finding.dupOf === undefined) continue
      if (finding.dupOf === finding.id) {
        throw new AuditFormatError(
          `${group.definition.id}: finding "${finding.id}" has dupOf="${finding.dupOf}", which names itself. A finding cannot duplicate itself; leave dupOf empty on the canonical row.`,
        )
      }
      if (!ownIds.has(finding.dupOf) && !siblingIds.has(finding.dupOf)) {
        throw new AuditFormatError(
          `${group.definition.id}: finding "${finding.id}" has dupOf="${finding.dupOf}", but no such id exists in ${group.definition.id} or ${sibling.id}.`,
        )
      }
    }
  }
}
