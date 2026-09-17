import { describe, expect, it } from "vitest"

import { exportNeedsReload } from "@/lib/lms-export/selection"

/**
 * TN-32 regression: the export's derived state must follow the offering selector.
 *
 * The old component seeded its weight configuration from the **initial** offering once and
 * never recomputed it, so every other offering submitted assessment ids the server
 * correctly rejected with `400 "… does not belong to this offering"`. The condition below
 * is what the component uses to invalidate the loaded payload.
 */
describe("exportNeedsReload", () => {
  it("keeps the loaded payload when the selection has not moved", () => {
    expect(exportNeedsReload("demo-offering-active", "demo-offering-active")).toBe(false)
  })

  it("reloads when a different offering is selected", () => {
    expect(exportNeedsReload("demo-offering-active", "demo-offering-past")).toBe(true)
  })

  it("treats switching back as a change too — the first offering is not special", () => {
    expect(exportNeedsReload("demo-offering-past", "demo-offering-active")).toBe(true)
  })

  it("does nothing when there is no selection to load", () => {
    expect(exportNeedsReload("", "")).toBe(false)
    expect(exportNeedsReload("demo-offering-active", "")).toBe(false)
  })
})
