import { describe, expect, it } from "vitest"

import { milestoneCreatePayload } from "@/lib/groups/milestone-form"

/**
 * The milestone create form's payload rule (TN-49).
 *
 * The API accepted description, weight and due date from the start; the UI sent only a title,
 * so every milestone was title-only. The form now sends them through this helper, and an
 * empty optional value is omitted rather than sent as `null` so the schema default applies.
 */

describe("milestoneCreatePayload", () => {
  it("carries the description, weight and due date the API always accepted", () => {
    const built = milestoneCreatePayload({
      title: "  Proposal draft ",
      description: "Outline the method and the dataset",
      weight: "2",
      dueDate: "2026-10-01",
    })

    expect(built).toEqual({
      ok: true,
      body: {
        title: "Proposal draft",
        description: "Outline the method and the dataset",
        weight: 2,
        dueDate: "2026-10-01",
      },
    })
  })

  it("omits empty optional fields and defaults the weight", () => {
    const built = milestoneCreatePayload({
      title: "Draft",
      description: "   ",
      weight: "",
      dueDate: "",
    })

    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.body).toEqual({ title: "Draft", weight: 1 })
    expect("description" in built.body).toBe(false)
    expect("dueDate" in built.body).toBe(false)
  })

  it("refuses a blank title and a non-positive weight", () => {
    expect(
      milestoneCreatePayload({ title: "  ", description: "", weight: "1", dueDate: "" }).ok,
    ).toBe(false)
    expect(
      milestoneCreatePayload({ title: "Draft", description: "", weight: "0", dueDate: "" }).ok,
    ).toBe(false)
    expect(
      milestoneCreatePayload({ title: "Draft", description: "", weight: "abc", dueDate: "" }).ok,
    ).toBe(false)
  })
})
