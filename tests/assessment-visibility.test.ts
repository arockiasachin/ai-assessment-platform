import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { releasedAssessmentWhere } from "@/lib/assessment-visibility"

/**
 * The release predicate has one definition, and this file is why that stays true.
 *
 * The release fragment used to be written by hand at every read site with a
 * comment asking the next reader to keep the copies identical. A comment cannot
 * enforce that, and this project has already shipped a repeated class of bug — a
 * rule correct on the paths someone considered and missing or divergent on the one
 * they did not. So the literal is pinned to one module by a scan as well as by a
 * unit test.
 */

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..")

describe("releasedAssessmentWhere", () => {
  it("names an assessment whose releasedAt is not null", () => {
    const where = releasedAssessmentWhere()

    expect(where).toHaveProperty("releasedAt")
    expect(where.releasedAt).toEqual({ not: null })
  })

  it("returns a fresh object each call, so one caller cannot mutate another's where", () => {
    const first: Partial<{ releasedAt: unknown }> = releasedAssessmentWhere()
    delete first.releasedAt

    expect(releasedAssessmentWhere().releasedAt).not.toBeUndefined()
  })
})

/** Source trees a release predicate could plausibly be written into. */
const SOURCE_ROOTS = ["app", "components", "lib", "prisma", "scripts", "tests"] as const

/** Directories that are generated or vendored, never hand-edited. */
const SKIPPED_DIRS = new Set(["node_modules", ".next", "generated"])

/**
 * The literal a hand-written copy of the predicate takes. The escaped regex is
 * deliberately spelled this way: it must not match *itself* when this file is
 * scanned, and `releasedAt\s*:` cannot, because after `releasedAt` comes a
 * backslash rather than a colon.
 */
const PREDICATE_LITERAL = /releasedAt\s*:\s*\{\s*not\s*:\s*null\s*\}/

function sourceFilesUnder(dir: string): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...sourceFilesUnder(full))
    else if (/\.(ts|tsx|mts)$/.test(entry.name)) files.push(full)
  }
  return files
}

describe("release predicate has a single definition", () => {
  it("is written only in lib/assessment-visibility.ts", () => {
    const offenders = SOURCE_ROOTS.flatMap((root) => sourceFilesUnder(path.join(repoRoot, root)))
      .filter((file) => PREDICATE_LITERAL.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(repoRoot, file))

    expect(offenders).toEqual(["lib/assessment-visibility.ts"])
  })
})
