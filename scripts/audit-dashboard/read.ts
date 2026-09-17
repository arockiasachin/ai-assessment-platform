/**
 * Reading and validating the four group report files.
 *
 * This was the top of `run.ts` until the live server arrived. It moved here so
 * the CLI and the server cannot drift: both call `readGroupFiles`, and both
 * therefore fail on exactly the same malformed rows. The trade-off is a little
 * indirection in the CLI, which is cheap next to two readers disagreeing about
 * what a finding is.
 *
 * It returns errors rather than throwing because the two callers want opposite
 * things from a bad file. The CLI has nothing to fall back on, so it aborts; the
 * server is watching a live audit and keeps serving the last good aggregate.
 */

import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { GROUPS } from "./groups"
import { parseGroupFile, validateDupOf, type ParsedGroup } from "./parse"

export const REPO_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)))
export const AUDIT_DIR = path.join(REPO_ROOT, "docs", "audit")
export const AGGREGATE_PATH = path.join(AUDIT_DIR, "aggregate.json")

export type ReadResult = { ok: true; parsed: ParsedGroup[] } | { ok: false; errors: string[] }

export function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT"
  )
}

/** A path for messages: repo-relative when it is inside the repo, absolute otherwise. */
export function humanPath(target: string, repoRoot: string = REPO_ROOT): string {
  const relative = path.relative(repoRoot, target)
  return relative.startsWith("..") ? target : relative
}

export async function readGroupFiles(
  auditDir: string = AUDIT_DIR,
  repoRoot: string = REPO_ROOT,
): Promise<ReadResult> {
  const parsed: ParsedGroup[] = []
  const errors: string[] = []

  // Every file is attempted before reporting, so one refresh surfaces every
  // problem instead of making the reader fix four tables in four passes.
  for (const definition of GROUPS) {
    const absolute = path.join(auditDir, `${definition.id}.md`)
    const display = humanPath(absolute, repoRoot)
    try {
      const text = await readFile(absolute, "utf8")
      parsed.push(parseGroupFile({ filePath: display, text, definition }))
    } catch (error) {
      if (isNotFound(error)) {
        errors.push(
          `${display}: file is missing. Every group has a report file; see docs/audit/README.md.`,
        )
      } else {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors }

  try {
    validateDupOf(parsed)
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] }
  }

  return { ok: true, parsed }
}
