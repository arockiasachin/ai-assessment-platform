/**
 * The display label for a `ClassRoom`: its name with its section, unless the
 * name already carries the section.
 *
 * ## Why this is one function
 *
 * `ClassRoom` has both a `name` and a `section` column, and the label convention
 * is "name section". That append had been copied into roughly eighteen call
 * sites across `lib/`, and the courses seed writes names that already end in
 * their section (`M.Tech (CSE) BDA — DSA — Section A`). The two facts together
 * rendered `Section A A` on nine teacher pages.
 *
 * This is the single definition of the rule now, so a reader cannot disagree
 * with another reader about what a class is called. It is pure and lives
 * outside any `server-only` module so it can be unit-tested and imported from a
 * route, a service or a component.
 *
 * ## The rule
 *
 * Append the section when it is present and the name does not already end with
 * that section as its own token. The token boundary matters: a section of `A`
 * must not consider `Intro to Data` to already carry it, and it must not match
 * the `A` inside a word. `Section A`, `- A`, `— A` and a bare trailing ` A`
 * all count as already present; anything else gets the section appended.
 */
export function classroomLabel(name: string, section: string | null | undefined): string {
  const trimmedName = name.trim()
  const trimmedSection = section?.trim() ?? ""
  if (trimmedSection === "") return trimmedName
  if (alreadyCarriesSection(trimmedName, trimmedSection)) return trimmedName
  return `${trimmedName} ${trimmedSection}`
}

function alreadyCarriesSection(name: string, section: string): boolean {
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  // Case-insensitive: a name ending "SECTION A" is the same section as "A".
  return new RegExp(`(^|[\\s\\u2014\\u2013-])${escaped}$`, "i").test(name)
}
