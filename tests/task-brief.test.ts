import { describe, expect, it } from "vitest"

import { parseBriefSegments, parseTaskBrief } from "@/lib/task-brief"

describe("parseBriefSegments", () => {
  it("returns one text segment when there is no code span", () => {
    expect(parseBriefSegments("Write a function.")).toEqual([
      { kind: "text", value: "Write a function." },
    ])
  })

  it("splits a code span out of the surrounding prose", () => {
    expect(parseBriefSegments("Implement `bfs_order(adjacency, start)` now.")).toEqual([
      { kind: "text", value: "Implement " },
      { kind: "code", value: "bfs_order(adjacency, start)" },
      { kind: "text", value: " now." },
    ])
  })

  it("handles a code span at the start and end", () => {
    expect(parseBriefSegments("`a` and `b`")).toEqual([
      { kind: "code", value: "a" },
      { kind: "text", value: " and " },
      { kind: "code", value: "b" },
    ])
  })

  it("leaves an unbalanced backtick as literal text", () => {
    expect(parseBriefSegments("an `unclosed span")).toEqual([
      { kind: "text", value: "an `unclosed span" },
    ])
  })

  it("never emits an empty segment", () => {
    expect(parseBriefSegments("`whole`")).toEqual([{ kind: "code", value: "whole" }])
  })
})

describe("parseTaskBrief", () => {
  it("splits paragraphs on blank lines and trims them", () => {
    const brief = parseTaskBrief("First paragraph.\n\nSecond paragraph.\n\n\nThird.")

    expect(brief.paragraphs.map((paragraph) => paragraph.id)).toEqual([
      "brief-0",
      "brief-1",
      "brief-2",
    ])
    expect(brief.paragraphs[1].segments).toEqual([{ kind: "text", value: "Second paragraph." }])
  })

  it("keeps a single newline inside one paragraph", () => {
    const brief = parseTaskBrief("Line one\nline two")

    expect(brief.paragraphs).toHaveLength(1)
    expect(brief.paragraphs[0].segments).toEqual([{ kind: "text", value: "Line one\nline two" }])
  })

  it("normalises CRLF and trims surrounding whitespace", () => {
    const brief = parseTaskBrief("  Alpha.\r\n\r\nBeta.  ")

    expect(brief.paragraphs.map((paragraph) => paragraph.segments[0].value)).toEqual([
      "Alpha.",
      "Beta.",
    ])
  })

  it("parses code spans inside each paragraph", () => {
    const brief = parseTaskBrief("Use `bfs_order`. Return the order.\n\nUse `dfs_order` too.")

    expect(brief.paragraphs[0].segments[1]).toEqual({ kind: "code", value: "bfs_order" })
    expect(brief.paragraphs[1].segments[1]).toEqual({ kind: "code", value: "dfs_order" })
  })

  it("returns no paragraphs for null, undefined and whitespace-only input", () => {
    expect(parseTaskBrief(null)).toEqual({ paragraphs: [] })
    expect(parseTaskBrief(undefined)).toEqual({ paragraphs: [] })
    expect(parseTaskBrief("   \n\n  \t ")).toEqual({ paragraphs: [] })
  })
})
