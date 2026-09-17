import { readFile, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { FindingRow, FindingStatus } from "./status"

/**
 * Reading and rewriting the report files.
 *
 * The files are hand-authored Markdown read by two other programs — the audit
 * dashboard's parser and this sync — so the writer here is deliberately
 * conservative. It changes the one cell it was asked to change and touches nothing
 * else, leaving re-padding to `prettier` rather than trying to reproduce the
 * table's alignment itself.
 */

/** The four report files, in the order the dashboard lists them. */
export const GROUPS = [
  "teacher-native",
  "teacher-langchain",
  "student-native",
  "student-langchain",
] as const

export type GroupId = (typeof GROUPS)[number]

/** Data cells before the status cell: id, agent, severity, category, title, evidence, location. */
const STATUS_CELL_INDEX = 7

const ROW_PATTERN = /^\|\s*(TN|TL|SN|SL)-\d+\s*\|/

/**
 * Splits a table row on unescaped pipes.
 *
 * Evidence routinely contains `|` inside code spans — `status: 200 | 404` — which
 * the reports escape as `\|`. Splitting naively would shear those cells and
 * silently corrupt the evidence it is supposed to preserve.
 */
function splitRow(line: string): string[] {
  const PLACEHOLDER = "\u0000"
  const cells: string[] = []
  let current = ""
  let escaped = false

  for (const char of line) {
    if (escaped) {
      current += char === "|" ? PLACEHOLDER : char
      escaped = false
      continue
    }
    if (char === "\\") {
      escaped = true
      current += char
      continue
    }
    if (char === "|") {
      cells.push(current)
      current = ""
      continue
    }
    current += char
  }
  cells.push(current)

  // Drop the empty leading and trailing fields produced by the outer pipes.
  return cells.slice(1, -1).map((cell) => cell.replaceAll(PLACEHOLDER, "|").trim())
}

export type ReadResult = {
  findings: FindingRow[]
  /** Newest mtime across all four files, used only to break a genuine conflict. */
  reportsUpdatedAt: Date
  files: { group: GroupId; path: string }[]
}

export async function readFindings(dir: string): Promise<ReadResult> {
  const findings: FindingRow[] = []
  const files: { group: GroupId; path: string }[] = []
  let newest = 0

  for (const group of GROUPS) {
    const path = join(dir, `${group}.md`)
    const [text, info] = await Promise.all([readFile(path, "utf8"), stat(path)])
    files.push({ group, path })
    newest = Math.max(newest, info.mtimeMs)

    for (const line of text.split("\n")) {
      if (!ROW_PATTERN.test(line)) continue
      const cells = splitRow(line)
      if (cells.length < 9) continue

      const [id, , , , , , , status, dupOf] = cells
      if (!["open", "fixed", "wontfix"].includes(status)) continue

      findings.push({
        id,
        status: status as FindingStatus,
        dupOf: dupOf && dupOf !== "—" ? dupOf : null,
      })
    }
  }

  return { findings, reportsUpdatedAt: new Date(newest), files }
}

/**
 * Rewrites the status cell of the named rows, returning the new file contents.
 *
 * Returns `null` when a file needs no change, so a no-op sync writes nothing and
 * therefore does not disturb any mtime.
 */
export async function rewriteStatuses(
  path: string,
  updates: Map<string, FindingStatus>,
): Promise<string | null> {
  if (updates.size === 0) return null

  const original = await readFile(path, "utf8")
  let changed = false

  const next = original
    .split("\n")
    .map((line) => {
      if (!ROW_PATTERN.test(line)) return line

      const cells = splitRow(line)
      if (cells.length < 9) return line

      const [id, , , , , , , currentStatus] = cells
      const wanted = updates.get(id)
      if (!wanted || wanted === currentStatus) return line

      cells[STATUS_CELL_INDEX] = wanted
      changed = true
      // Rejoin unpadded; `prettier` restores the table's alignment afterwards.
      return `| ${cells.join(" | ")} |`
    })
    .join("\n")

  return changed ? next : null
}

export async function writeIfChanged(path: string, contents: string | null): Promise<boolean> {
  if (contents === null) return false
  await writeFile(path, contents, "utf8")
  return true
}
