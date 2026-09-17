import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

/**
 * The seed must stay runnable under `tsx`.
 *
 * ## The bug this guards
 *
 * `server-only` is a **sentinel**, not a real dependency — it is absent from `node_modules`. Next stubs
 * it during a server build and `vitest.config.mts` aliases it to `tests/stubs/server-only.ts`, so both
 * of those resolve it. **`tsx` does not**, and `prisma/seed-demo.ts` runs under `tsx`
 * (`npm run prisma:seed:demo`).
 *
 * So a `server-only` import anywhere in the seed's transitive imports makes the seed fail with
 * `Cannot find module 'server-only'`. That happened: `lib/quiz-attempts/service.ts` began importing
 * `lib/grading/offering-config-service.ts`, which carried the sentinel, and the seed broke — while
 * `npm run verify`, `npm test` and CI all stayed green, because **nothing in CI runs the seed**.
 *
 * That is the shape of failure worth a test: the suite was green and the tool was broken. A comment
 * asking people to remember would not have caught it; walking the import graph does.
 *
 * ## What it walks
 *
 * The seed's own file, then every **local** import it reaches (`@/…` and relative), transitively. It
 * stops at bare package specifiers, which cannot be inspected this way.
 */

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..")

/** Local specifier → absolute path, honouring the `@/` alias and relative forms. */
function resolveLocal(specifier: string, fromFile: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(repoRoot, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(fromFile), specifier)
      : null
  if (base === null) return null

  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return null
}

const IMPORT_PATTERN = /(?:from\s*|import\s*\(\s*|import\s+)["']([^"']+)["']/g

/**
 * Anchored to the **start of a line**, which is where an import statement lives.
 *
 * Without the anchor this matched the comment in `offering-config-service.ts` that *explains why the
 * sentinel is absent* — prose quoting `import "server-only"` is not an import, and a guard that cannot
 * tell them apart fails on its own documentation. Comment-stripping would be the other fix and is worse
 * here: it needs a `//`-in-string-literal hazard handled, and the anchor is exact instead.
 */
const SENTINEL_IMPORT = /^import\s+["']server-only["']/m

/** Every local module reachable from a file, without following bare packages. */
function localImportGraph(entry: string): Map<string, string[]> {
  const graph = new Map<string, string[]>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (graph.has(file)) continue
    const source = fs.readFileSync(file, "utf8")
    const locals: string[] = []
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const resolved = resolveLocal(match[1], file)
      if (resolved) locals.push(resolved)
    }
    graph.set(file, locals)
    queue.push(...locals)
  }
  return graph
}

describe("the seed's import graph", () => {
  it("contains no `server-only` sentinel, which `tsx` cannot resolve", () => {
    const entry = path.join(repoRoot, "prisma", "seed-demo.ts")
    const graph = localImportGraph(entry)

    // Sanity: the walk found something. A broken resolver would make this test vacuous, which is the
    // failure mode it would otherwise have.
    expect(graph.size, "expected to walk more than the entry file").toBeGreaterThan(30)

    const offenders: string[] = []
    for (const file of graph.keys()) {
      const source = fs.readFileSync(file, "utf8")
      if (SENTINEL_IMPORT.test(source)) offenders.push(path.relative(repoRoot, file))
    }

    expect(
      offenders,
      "these modules are reachable from the seed and import the `server-only` sentinel, which `tsx` " +
        "cannot resolve — the seed will fail with 'Cannot find module server-only'. Remove the " +
        "sentinel, or stop importing the module from the seed's graph",
    ).toEqual([])
  })

  it("would catch the sentinel if it were reintroduced", () => {
    // The guard has to be able to fail, or it is decoration. Written to a temp file inside the repo so
    // the resolver can follow it, then removed.
    const probe = path.join(repoRoot, "lib", "__server_only_probe.ts")
    fs.writeFileSync(probe, 'import "server-only"\n')
    try {
      const graph = localImportGraph(probe)
      const offenders = [...graph.keys()].filter((file) =>
        SENTINEL_IMPORT.test(fs.readFileSync(file, "utf8")),
      )
      expect(offenders).toHaveLength(1)
    } finally {
      fs.rmSync(probe, { force: true })
    }
  })
})
