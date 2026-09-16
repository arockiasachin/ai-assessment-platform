import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

/**
 * `lib/mock` is scoped to the design-reference tree.
 *
 * ## Why this is a source-level guard
 *
 * `lib/mock` used to be load-bearing for the **real** app. `lib/labels.ts` imported nine view
 * unions from it, `lib/teacher-submissions.ts` two more, `components/shell/nav-config.ts` imported
 * `MockupRole`, and `components/shell/top-bar.tsx` imported `MOCK_NOTIFICATIONS` and
 * `MOCK_CURRENT_USER` as **values**. The first three were value-identical duplicates of Prisma
 * enums; the last meant a shell component the real app renders depended on fixture data at module
 * scope.
 *
 * They are now all gone, so the dependency points one way: the design-reference tree reads the mock
 * layer, and nothing else does. That is what lets the `/mockup` tree be kept as a design reference
 * without the mock layer quietly becoming part of the product again.
 *
 * ## Why not just delete it
 *
 * The owner chose to keep `/mockup` as a tagged design reference, and its 38 pages render from
 * `lib/mock`. So the layer stays — but a *one-directional* dependency is a property that decays
 * silently: the next person to need a label map will reach for `@/lib/mock` because it is there.
 * A helper-level test cannot catch that, because the import is the problem, not the behaviour. So
 * this asserts on the source, the same way the `NAV_SECTIONS` guard does.
 */

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..")

/** Where the mock layer is legitimately imported from. */
const ALLOWED_PREFIXES = [
  "app/mockup/",
  "app/(mockup-standalone)/mockup/",
  "lib/mock/",
  // Build output and dependencies.
  "node_modules/",
  ".next/",
  ".git/",
]

/** This file names the mock layer in its own patterns and prose, so it cannot scan itself. */
const SELF = "tests/mock-layer-scope.test.ts"

const SCANNED_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"]

/**
 * Every way a module can reach another module: static `import`/`export … from`, a side-effect
 * `import "…"`, a dynamic `import("…")`, and `require("…")`.
 *
 * Matched against the **raw** source. Comments are deliberately *not* stripped: a line-based `//`
 * strip truncates at the first `//` inside a string literal — a URL like `https://…` — which would
 * hide any import sharing that line. Prose in this codebase names the layer as `` `lib/mock` ``,
 * never as a module specifier, so matching raw text does not produce false positives.
 */
const MODULE_SPECIFIER = /(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)["']([^"']+)["']/g

/**
 * Whether a module specifier resolves to the mock layer.
 *
 * Handles the alias forms (`@/lib/mock`, `~/lib/mock`), relative forms (`../../lib/mock`) and the
 * `lib/mock/types` sub-path, while not matching lookalikes: the trailing boundary means
 * `@/lib/mockup-*` and a bare package such as `some-lib/mock` are both rejected.
 */
function resolvesToMockLayer(specifier: string): boolean {
  return /(?:^|\/)lib\/mock(?:\/|$)/.test(specifier.replace(/\\/g, "/"))
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (["node_modules", ".next", ".git"].includes(entry.name)) continue
      walkFiles(full, out)
    } else if (SCANNED_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      out.push(full)
    }
  }
  return out
}

/** The mock-layer imports in one file, as module specifiers. */
function mockLayerImportsIn(file: string): string[] {
  const source = fs.readFileSync(file, "utf8")
  const found: string[] = []
  for (const match of source.matchAll(MODULE_SPECIFIER)) {
    if (resolvesToMockLayer(match[1])) found.push(match[1])
  }
  return found
}

describe("mock layer scope", () => {
  it("is imported only from the design-reference tree", () => {
    const offenders: string[] = []

    for (const file of walkFiles(repoRoot)) {
      const relative = path.relative(repoRoot, file).replace(/\\/g, "/")
      if (ALLOWED_PREFIXES.some((prefix) => relative.startsWith(prefix))) continue
      if (relative === SELF) continue
      if (mockLayerImportsIn(file).length > 0) offenders.push(relative)
    }

    expect(
      offenders,
      "these files import a module from `lib/mock` but are outside the design-reference tree; " +
        "move the type to its real home, or use the generated Prisma enum",
    ).toEqual([])
  })

  it("keeps the shell free of mock values, not just mock types", () => {
    // The narrower property that matters most: a *value* import from the mock layer inside the
    // shell would put fixture data into a component the real app renders.
    const shellDir = path.join(repoRoot, "components", "shell")
    const offenders = walkFiles(shellDir)
      .filter((file) => mockLayerImportsIn(file).length > 0)
      .map((file) => path.relative(repoRoot, file))

    expect(offenders).toEqual([])
  })

  it("has no dead shell chain left behind", () => {
    // These five were the pre-design-system shell. All are unreferenced now, and they were deleted
    // rather than left in place — but a re-introduction would be invisible without this, because
    // nothing imports them.
    for (const dead of [
      "components/role-page-shell.tsx",
      "components/dashboard.tsx",
      "components/dashboard-header.tsx",
      "components/role-routes-menu.tsx",
      "components/future-page-placeholder.tsx",
      "components/admin-page-shell.tsx",
      "components/admin-routes-menu.tsx",
      "components/logout-button.tsx",
    ]) {
      expect(fs.existsSync(path.join(repoRoot, dead)), `${dead} should not exist`).toBe(false)
    }
  })
})
