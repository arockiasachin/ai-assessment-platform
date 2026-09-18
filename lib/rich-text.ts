import "server-only"

import sanitizeHtml from "sanitize-html"

import { htmlToPlainText } from "./html-to-text"

/**
 * Rich-text handling for written submissions.
 *
 * ## What is stored
 *
 * A written submission's `Submission.contentText` holds **sanitized HTML**, not
 * plain prose. Before this module existed the field was plain text and every
 * reader rendered it verbatim; now the writing page is a TipTap editor whose
 * `getHTML()` output is stored, and every reader must render it as HTML or a
 * teacher sees raw tags.
 *
 * ## Sanitize on save *and* on render
 *
 * {@link sanitizeSubmissionHtml} is applied in two places on purpose:
 *
 * 1. the submission route, before the value is written; and
 * 2. the server readers that build teacher-facing views
 *    (`lib/teacher-submissions.ts`, `lib/rubric-grading/review-queue.ts`),
 *    before the value reaches a `dangerouslySetInnerHTML` call.
 *
 * The second pass is defense in depth: it protects rows written before this
 * change (which were never sanitized) and any row whose content might be altered
 * outside the route.
 *
 * ## What the 4000-character cap measures
 *
 * The old `contentText` cap was a raw string length, which no longer has a fixed
 * relationship to how much a student wrote — `<p></p>` is seven characters of
 * markup and zero characters of prose. The cap now measures the **plain-text
 * character count of the sanitized content** ({@link submissionTextLength}), so
 * the budget is stable no matter how the student formats their work. A separate
 * hard ceiling, {@link SUBMISSION_HTML_MAX_LENGTH}, bounds the stored markup
 * itself so a pathological document cannot be used to grow the row without
 * limit. The route enforces both; the client shows the plain-text count.
 */

/**
 * The student-facing writing budget, in **plain-text characters** (markup
 * excluded). This is what the editor's counter shows and what the route checks.
 */
export const SUBMISSION_TEXT_MAX_LENGTH = 4000

/**
 * A hard ceiling on the **sanitized HTML** stored in `contentText`. Not a
 * writing budget: it exists so markup alone cannot grow the row unbounded.
 */
export const SUBMISSION_HTML_MAX_LENGTH = 20_000

/** The markup a submission may carry. Formatting only: no media, no scripts. */
export const SUBMISSION_ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "strike",
  "del",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "code",
  "pre",
  "hr",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "a",
]

/**
 * The attributes a submission may carry.
 *
 * `href` is the only meaningful one, and `sanitize-html`'s scheme allow-list
 * (`http`, `https`, `mailto`) refuses a `javascript:` URL even before the
 * attribute filter runs. Table spans are kept because both the TipTap table
 * extension and Mammoth's DOCX conversion emit them; width/alignment styling is
 * deliberately dropped.
 */
export const SUBMISSION_ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  // `target`/`rel` are listed so the transform below can *set* them: an attribute
  // added by `transformTags` is still removed by the attribute filter unless it
  // is allowed here. The transform overwrites both on every link, so a value in
  // the input can never survive.
  a: ["href", "title", "target", "rel"],
  th: ["colspan", "rowspan"],
  td: ["colspan", "rowspan"],
}

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: SUBMISSION_ALLOWED_TAGS,
  allowedAttributes: SUBMISSION_ALLOWED_ATTRIBUTES,
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesAppliedToAttributes: ["href"],
  // `script`/`style`/`iframe` contents are discarded rather than kept as text.
  disallowedTagsMode: "discard",
  transformTags: {
    // A link the student inserted is the one attribute worth keeping useful. It
    // is forced into a new tab with `rel="noopener noreferrer nofollow"`, which
    // is what makes `target="_blank"` safe, so `target` is set here rather than
    // accepted from the input.
    a: (tagName, attribs) => {
      const next: Record<string, string> = {
        rel: "noopener noreferrer nofollow",
        target: "_blank",
      }
      if (attribs.href) next.href = attribs.href
      if (attribs.title) next.title = attribs.title
      return { tagName, attribs: next }
    },
  },
}

/**
 * Sanitize submission HTML: formatting tags only, no script, style, iframe,
 * media, or event handlers.
 *
 * The output is a **fixed point** — sanitizing already-sanitized HTML returns it
 * unchanged — which is what lets the save path and the render path both apply it
 * without double-escaping.
 */
export function sanitizeSubmissionHtml(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS).trim()
}

/**
 * Sanitize, mapping content with no readable text to `null` (the column's
 * "nothing written" value).
 *
 * The plain-text check matters because TipTap's empty document serializes to
 * `<p></p>`, which is non-empty markup but zero prose. Treating that as content
 * would store a body and let an empty submission pass the route's emptiness
 * guard.
 */
export function sanitizeSubmissionContent(content: string | null | undefined): string | null {
  if (content == null) return null
  const sanitized = sanitizeSubmissionHtml(content)
  if (sanitized.length === 0) return null
  return submissionTextLength(sanitized) > 0 ? sanitized : null
}

/**
 * `Submission.contentText` is not always HTML: a **code** submission stores the
 * student's source in it (`lib/code-eval/submissions.ts`). Source is not markup,
 * so it must be escaped once and presented preformatted rather than sanitized —
 * sanitizing it would treat `#include <stdio.h>` as a tag and delete it.
 *
 * This converts such content into safe HTML so every renderer can be uniform.
 */
export function preformattedContentHtml(content: string | null | undefined): string | null {
  if (content == null || content.trim().length === 0) return null
  return sanitizeSubmissionHtml(`<pre>${escapeHtml(content)}</pre>`)
}

/*
 * `htmlToPlainText` lives in `./html-to-text` and is re-exported here so this
 * module keeps its public surface. It sits outside the `server-only` sentinel
 * because `lib/rubric-grading/evaluation.ts` is reachable from the `tsx` seeds
 * and needs the same conversion; see that module for the full reason.
 */
export { htmlToPlainText }

/**
 * The character count the 4000 cap is measured against: the plain text of the
 * sanitized content, whitespace-collapsed and trimmed. Markup is not counted.
 */
export function submissionTextLength(html: string): number {
  return htmlToPlainText(html).length
}

/** The number of whitespace-separated words in the readable content. */
export function submissionWordCount(html: string): number {
  const text = htmlToPlainText(html)
  if (text.length === 0) return 0
  return text.split(/\s+/).filter(Boolean).length
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/**
 * Plain text into submission-safe HTML: blank lines separate paragraphs, single
 * newlines become `<br />`. Used by the upload extraction path for PDF/TXT/MD,
 * whose extracted bytes are text rather than markup. The result is sanitized by
 * the caller for one consistent output shape.
 */
export function plainTextToSubmissionHtml(text: string): string {
  const normalized = text.replace(/\r\n?/g, "\n").trim()
  if (normalized.length === 0) return ""
  return normalized
    .split(/\n{2,}/)
    .map((block) => `<p>${block.split("\n").map(escapeHtml).join("<br />")}</p>`)
    .join("")
}
