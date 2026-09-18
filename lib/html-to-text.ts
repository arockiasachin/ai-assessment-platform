import sanitizeHtml from "sanitize-html"

/**
 * HTML → readable text, shared across the `server-only` boundary.
 *
 * ## Why this is its own module
 *
 * `lib/rich-text.ts` carries the `server-only` sentinel so the sanitizer
 * configuration cannot be pulled into a Client Component (see the docblock on
 * `components/rich-text-content.tsx`). That sentinel is a **sentinel**, not a
 * dependency: Next stubs it, `vitest` aliases it, and **`tsx` cannot resolve
 * it**.
 *
 * `prisma/seed-demo.ts` and `prisma/seed-courses.ts` import
 * `lib/rubric-grading/evaluation.ts` directly to seed AI suggestions, so that
 * module must stay loadable under `tsx` — which
 * `tests/seed-import-graph.test.ts` enforces by walking the seed's import graph.
 * Importing `lib/rich-text.ts` from `evaluation.ts` adds the sentinel to that
 * graph and breaks the seed.
 *
 * The pure HTML→text conversion is the one piece both sides need (the teacher
 * readers need it for display; the rubric evaluator needs it so the model is
 * shown prose rather than markup). It lives here, **without** the sentinel, so
 * the rule stays single-sourced without unguarding the sanitizer configuration.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, body: string) => {
    try {
      if (body.startsWith("#x") || body.startsWith("#X")) {
        return String.fromCodePoint(Number.parseInt(body.slice(2), 16))
      }
      if (body.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(body.slice(1), 10))
      }
      return NAMED_ENTITIES[body] ?? match
    } catch {
      return match
    }
  })
}

/**
 * The readable text of submission HTML: block boundaries become newlines, tags
 * are removed, and entities are decoded back to characters.
 *
 * `sanitize-html` with no allowed tags strips markup but does **not** insert
 * separators, so `<p>one</p><p>two</p>` would read as `onetwo`; the block
 * replacements below run first so a word or character count is not silently low.
 * This is the value `submissionTextLength`/`submissionWordCount` measure, and the
 * readable form the rubric evaluator feeds its prompt.
 */
export function htmlToPlainText(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|pre|table)>/gi, "\n")
  const stripped = sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} })
  return decodeEntities(stripped)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
