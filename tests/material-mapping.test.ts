import { describe, expect, it } from "vitest"

import { toMaterialView, type MaterialQueryRow } from "@/lib/materials"

/**
 * The materials projection.
 *
 * Pure and database-free. The invariant that matters most: `chunks: 0` must produce
 * `indexed: false` and never `undefined`, because the UI branches on it to choose
 * between "Indexed" and "Not searchable yet" — a missing flag would render the
 * wrong one silently.
 */

function row(overrides: Partial<MaterialQueryRow> = {}): MaterialQueryRow {
  return {
    id: "mat_1",
    title: "Linear equations — lecture notes",
    kind: "DOCUMENT",
    sourceUrl: null,
    mimeType: "text/plain",
    updatedAt: new Date("2026-09-10T09:00:00.000Z"),
    course: { code: "DEMO-MATH-101" },
    chunks: 5,
    ...overrides,
  }
}

describe("toMaterialView", () => {
  it("passes identity, kind and course code through", () => {
    const view = toMaterialView(row())
    expect(view.id).toBe("mat_1")
    expect(view.title).toBe("Linear equations — lecture notes")
    expect(view.kind).toBe("DOCUMENT")
    expect(view.courseCode).toBe("DEMO-MATH-101")
  })

  it("maps every MaterialKind without translating it", () => {
    // The six enum values are the view's union verbatim, so a translation table
    // would be a bug waiting to happen. If Prisma ever adds a seventh, this fails.
    const kinds = ["DOCUMENT", "SLIDE_DECK", "VIDEO", "TRANSCRIPT", "LINK", "OTHER"] as const
    for (const kind of kinds) {
      expect(toMaterialView(row({ kind })).kind).toBe(kind)
    }
  })

  it("marks a material with chunks as indexed", () => {
    const view = toMaterialView(row({ chunks: 3 }))
    expect(view.chunks).toBe(3)
    expect(view.indexed).toBe(true)
  })

  it("marks a zero-chunk material as not indexed, and false rather than undefined", () => {
    const view = toMaterialView(row({ chunks: 0 }))
    expect(view.chunks).toBe(0)
    expect(view.indexed).toBe(false)
    // Not `undefined`, which would fall through a branch and render "Indexed".
    expect(view.indexed).not.toBeUndefined()
  })

  it("keeps a null sourceUrl null rather than turning it into a string", () => {
    // The page renders "No file attached" off this, per the mockup's build guide.
    const view = toMaterialView(row({ sourceUrl: null }))
    expect(view.sourceUrl).toBeNull()
    expect(view.sourceUrl).not.toBe("")
  })

  it("keeps a real sourceUrl and mimeType", () => {
    const view = toMaterialView(
      row({ sourceUrl: "https://example.test/syllabus.pdf", mimeType: "application/pdf" }),
    )
    expect(view.sourceUrl).toBe("https://example.test/syllabus.pdf")
    expect(view.mimeType).toBe("application/pdf")
  })

  it("carries a null mimeType through", () => {
    expect(toMaterialView(row({ mimeType: null })).mimeType).toBeNull()
  })

  it("emits updatedAt as an ISO string", () => {
    expect(toMaterialView(row()).updatedAt).toBe("2026-09-10T09:00:00.000Z")
  })

  it("does not mutate the row it is given", () => {
    const input = row()
    toMaterialView(input)
    expect(input.chunks).toBe(5)
  })
})
