import { describe, expect, it } from "vitest"

import { dropEmptyFinalGradeConfig } from "@/lib/lms-export/request"

/**
 * TN-54: an empty offering's export read model carries `{ categories: [] }`, and
 * the client round-trips it. The request schema needs a category for every real
 * configuration, so the routes treat an empty list as "no configuration".
 */
describe("dropEmptyFinalGradeConfig", () => {
  it("removes an empty categories array while keeping the rest of the body", () => {
    expect(
      dropEmptyFinalGradeConfig({
        offeringId: "offering-1",
        file: "lineItems",
        config: { categories: [] },
      }),
    ).toEqual({ offeringId: "offering-1", file: "lineItems" })
  })

  it("leaves a real configuration untouched", () => {
    const body = {
      offeringId: "offering-1",
      config: { categories: [{ id: "all", name: "All", weight: 100, assessmentIds: ["a1"] }] },
    }
    expect(dropEmptyFinalGradeConfig(body)).toBe(body)
  })

  it("leaves malformed bodies for the schema to reject", () => {
    expect(dropEmptyFinalGradeConfig(null)).toBeNull()
    expect(dropEmptyFinalGradeConfig("nope")).toBe("nope")
    const noCategories = { offeringId: "o", config: {} }
    expect(dropEmptyFinalGradeConfig(noCategories)).toBe(noCategories)
  })
})
