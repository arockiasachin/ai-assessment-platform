import { describe, expect, it } from "vitest"

import {
  htmlToPlainText,
  plainTextToSubmissionHtml,
  preformattedContentHtml,
  sanitizeSubmissionContent,
  sanitizeSubmissionHtml,
  submissionTextLength,
  submissionWordCount,
} from "@/lib/rich-text"

/**
 * The rich-text contract for written submissions.
 *
 * The load-bearing properties: script/style/event handlers and unsafe URL
 * schemes never survive a round trip; the formatting a student is offered does;
 * and the 4000-character cap measures prose rather than markup.
 */

describe("sanitizeSubmissionHtml", () => {
  it("strips script, style, iframe and inline event handlers", () => {
    const dirty =
      '<p onclick="steal()">Kept</p><script>alert(1)</script><style>p{color:red}</style><iframe src="https://evil.test"></iframe>'

    const clean = sanitizeSubmissionHtml(dirty)

    expect(clean).toBe("<p>Kept</p>")
    expect(clean).not.toContain("script")
    expect(clean).not.toContain("onclick")
    expect(clean).not.toContain("iframe")
  })

  it("removes a javascript: link but keeps an https link with a forced rel and target", () => {
    const clean = sanitizeSubmissionHtml(
      '<p><a href="javascript:alert(1)">bad</a> <a href="https://example.com">good</a></p>',
    )

    expect(clean).not.toContain("javascript:")
    // The safe link survives, and every anchor the transform touches carries the
    // forced new-tab attributes.
    expect(clean).toContain('href="https://example.com"')
    expect(clean.match(/rel="noopener noreferrer nofollow"/g)).toHaveLength(2)
    expect(clean.match(/target="_blank"/g)).toHaveLength(2)
  })

  it("keeps the formatting and table markup a submission may carry", () => {
    const clean = sanitizeSubmissionHtml(
      "<h1>Title</h1><p><strong>bold</strong> <em>italic</em> <u>under</u> <s>strike</s></p>" +
        "<ul><li>one</li></ul><blockquote>quote</blockquote><pre><code>code()</code></pre>" +
        "<table><tbody><tr><th>h</th><td>d</td></tr></tbody></table>",
    )

    for (const fragment of [
      "<h1>Title</h1>",
      "<strong>bold</strong>",
      "<em>italic</em>",
      "<u>under</u>",
      "<s>strike</s>",
      "<ul><li>one</li></ul>",
      "<blockquote>quote</blockquote>",
      "<pre><code>code()</code></pre>",
      "<table>",
      "<th>h</th>",
      "<td>d</td>",
    ]) {
      expect(clean).toContain(fragment)
    }
  })

  it("is a fixed point: sanitizing sanitized output changes nothing", () => {
    const once = sanitizeSubmissionHtml(
      "<p>Hello <strong>there</strong></p><script>alert(1)</script>",
    )
    expect(sanitizeSubmissionHtml(once)).toBe(once)
  })
})

describe("sanitizeSubmissionContent", () => {
  it("maps absent, blank, and text-free markup to null", () => {
    expect(sanitizeSubmissionContent(null)).toBeNull()
    expect(sanitizeSubmissionContent(undefined)).toBeNull()
    expect(sanitizeSubmissionContent("")).toBeNull()
    expect(sanitizeSubmissionContent("   ")).toBeNull()
    // TipTap's empty document: non-empty markup, zero prose.
    expect(sanitizeSubmissionContent("<p></p>")).toBeNull()
  })

  it("returns sanitized HTML when there is prose", () => {
    expect(sanitizeSubmissionContent("<p>Real work</p>")).toBe("<p>Real work</p>")
  })
})

describe("plain-text measurement", () => {
  it("separates block elements so a word count is not silently low", () => {
    expect(htmlToPlainText("<p>one</p><p>two</p>")).toBe("one\ntwo")
    expect(htmlToPlainText("<ul><li>a</li><li>b</li></ul>")).toBe("a\nb")
    expect(htmlToPlainText("<p>line1<br />line2</p>")).toBe("line1\nline2")
  })

  it("counts only prose, not the markup around it", () => {
    const html = `<p>${"a".repeat(4000)}</p>`
    expect(html.length).toBeGreaterThan(4000)
    expect(submissionTextLength(html)).toBe(4000)
  })

  it("decodes entities back to characters", () => {
    expect(htmlToPlainText("<p>5 &lt;3 and 2 &gt; 1</p>")).toBe("5 <3 and 2 > 1")
    expect(submissionTextLength("<p>a &amp; b</p>")).toBe(5)
  })

  it("counts whitespace-separated words", () => {
    expect(submissionWordCount("<h1>Hello</h1><p>world again</p>")).toBe(3)
    expect(submissionWordCount("<p></p>")).toBe(0)
  })
})

describe("plainTextToSubmissionHtml", () => {
  it("escapes text, splits blank lines into paragraphs, and keeps single breaks", () => {
    expect(plainTextToSubmissionHtml("a < b\nsecond\n\nnew para")).toBe(
      "<p>a &lt; b<br />second</p><p>new para</p>",
    )
  })

  it("returns an empty string for blank input", () => {
    expect(plainTextToSubmissionHtml("   \n  ")).toBe("")
  })
})

describe("preformattedContentHtml", () => {
  it("escapes source code so it survives a render as HTML", () => {
    const html = preformattedContentHtml("#include <stdio.h>\nint main() { return 0; }")
    expect(html).not.toBeNull()
    expect(html).toContain("&lt;stdio.h&gt;")
    expect(html).toContain("<pre>")
  })

  it("maps empty source to null", () => {
    expect(preformattedContentHtml(null)).toBeNull()
    expect(preformattedContentHtml("   ")).toBeNull()
  })
})
