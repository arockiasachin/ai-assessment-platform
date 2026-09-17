import { describe, expect, it } from "vitest"

import { reconcileDrafts } from "@/lib/student-drafts"

/**
 * The rule SN-3 depends on: a server refetch replaces the cards the student has not edited, and
 * never the ones they have. Tests are pure — no renderer, no database.
 */
describe("reconcileDrafts", () => {
  it("keeps an unsaved local edit for a dirty key and adopts the server for the rest", () => {
    const server = { a: "saved-a", b: "server-b" }
    const local = { a: "typing in a", b: "server-b" }
    const dirty = new Set(["a"])

    // Saving card B refetches; card A must survive.
    expect(reconcileDrafts(server, local, dirty)).toEqual({ a: "typing in a", b: "server-b" })
  })

  it("adopts the server value for a clean key even when a local value exists", () => {
    const server = { a: "server-a" }
    const local = { a: "stale local" }
    expect(reconcileDrafts(server, local, new Set())).toEqual({ a: "server-a" })
  })

  it("adopts the server value once the key is no longer dirty", () => {
    // After a successful save the component deletes the key from the dirty set, so the saved
    // text is confirmed from the server rather than trusted from memory.
    const server = { a: "saved-a" }
    const local = { a: "saved-a" }
    expect(reconcileDrafts(server, local, new Set())).toEqual({ a: "saved-a" })
  })

  it("preserves a local key the server did not return", () => {
    // A key can transiently disappear from the payload (a filter, a reload). Dropping the text
    // would be the same data loss in a quieter form.
    const server = { a: "server-a" }
    const local = { a: "local-a", gone: "still typing" }
    expect(reconcileDrafts(server, local, new Set(["gone"]))).toEqual({
      a: "server-a",
      gone: "still typing",
    })
  })

  it("does not mutate its inputs", () => {
    const server = { a: "s" }
    const local = { a: "l" }
    const dirty = new Set(["a"])
    reconcileDrafts(server, local, dirty)
    expect(server).toEqual({ a: "s" })
    expect(local).toEqual({ a: "l" })
    expect([...dirty]).toEqual(["a"])
  })
})
