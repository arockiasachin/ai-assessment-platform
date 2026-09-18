import { describe, expect, it } from "vitest"

import { isOfferingClosed } from "@/lib/offering-window"

const now = new Date("2026-09-18T00:00:00.000Z")

/**
 * TN-62: the create-assessment picker offered a completed 2025 offering, so an
 * assessment could be authored into a closed term. The rule is one function so
 * the picker and any other authoring guard cannot disagree.
 */
describe("isOfferingClosed", () => {
  it("is closed when the term end is in the past", () => {
    expect(isOfferingClosed("2025-06-06T08:00:00.000Z", now)).toBe(true)
  })

  it("is open when the term end is in the future", () => {
    expect(isOfferingClosed("2026-12-04T10:00:00.000Z", now)).toBe(false)
  })

  it("treats a missing or unparseable end as open, because unscheduled is not finished", () => {
    expect(isOfferingClosed(null, now)).toBe(false)
    expect(isOfferingClosed(undefined, now)).toBe(false)
    expect(isOfferingClosed("", now)).toBe(false)
    expect(isOfferingClosed("not-a-date", now)).toBe(false)
  })

  it("accepts a Date as well as an ISO string", () => {
    expect(isOfferingClosed(new Date("2025-01-01T00:00:00.000Z"), now)).toBe(true)
  })
})
