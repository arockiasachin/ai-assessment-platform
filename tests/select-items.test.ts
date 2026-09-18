import { globSync, readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

/**
 * Every `<Select>` root must supply `items`.
 *
 * Base UI's `Select.Value` renders the **raw** `value` unless the root is given the
 * value→label map, so a missing `items` shows the stored value to the user — an enum
 * (`QUIZ`), a sentinel (`all`), or a raw id. `components/ui/filter-bar.tsx` documents the
 * pitfall in its own docblock and does it correctly; the rest of the app did not.
 *
 * This shipped twice before anyone noticed: once on the assessments hub's filter card and
 * once in the shared `AssessmentPicker`, where it put a raw assessment id in the header of
 * both editor pages. Neither had a test, so nothing failed. This is that test.
 *
 * ## The exemption
 *
 * A `<Select>` that genuinely wants the raw value carries a `select-raw-value-ok:` comment
 * with a reason. There is no such case today; the escape hatch exists so a real future one
 * is a deliberate, reviewed decision rather than a weakened assertion.
 */

/**
 * The `<Select …>` opening tag starting at `start`.
 *
 * Tracks bracket depth so an arrow function in a prop (`onValueChange={(next) => …}`)
 * cannot terminate the tag early — a naive "first `>`" search reports false positives.
 */
function openingTag(source: string, start: number): string {
  let depth = 0
  for (let i = start; i < source.length; i += 1) {
    const char = source[i]
    if (char === "(" || char === "{" || char === "[") depth += 1
    else if (char === ")" || char === "}" || char === "]") depth -= 1
    else if (char === ">" && depth === 0) return source.slice(start, i + 1)
  }
  return source.slice(start)
}

const SELECT_ROOT = /<Select(?![A-Za-z])/g
const EXEMPTION = "select-raw-value-ok:"

describe("every Select root supplies items", () => {
  const files = [
    ...globSync("app/(dashboard)/**/*.tsx", { cwd: process.cwd() }),
    ...globSync("components/**/*.tsx", { cwd: process.cwd() }),
  ]

  it("scans a non-trivial number of files, so this cannot pass by finding nothing", () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it("has no Select root without items", () => {
    const offenders: string[] = []

    for (const file of files) {
      const source = readFileSync(file, "utf8")
      for (const match of source.matchAll(SELECT_ROOT)) {
        const start = match.index
        const tag = openingTag(source, start)
        if (tag.includes("items=")) continue
        // A reasoned exemption immediately above the element is allowed.
        if (source.slice(Math.max(0, start - 300), start).includes(EXEMPTION)) continue

        offenders.push(`${file}:${source.slice(0, start).split("\n").length}`)
      }
    }

    expect(
      offenders,
      `These <Select> roots omit \`items\`, so Base UI renders the raw value in the trigger:\n  ${offenders.join("\n  ")}`,
    ).toEqual([])
  })
})
