import { describe, expect, it } from "vitest"

import type { OfferingGradingResponse } from "@/lib/contracts/courses"
import {
  catPercentLabel,
  catStatusLabel,
  catStatusPill,
  DEFAULT_DRAFT_MINIMUM_CAT,
  gradingDraftToRequest,
  gradingPolicySummary,
  toGradingDraft,
  weightSum,
  weightsSumTo100,
  type GradingDraft,
} from "@/lib/grading/policy-view"

/**
 * The grading-policy editor's pure logic.
 *
 * This editor writes a value that changes **every student's final grade**, and it shipped without a
 * test because the repository has no DOM environment. Extracting the logic is what makes it
 * testable — and the two things most likely to be wrong in a form are exactly the two things that
 * are pure: payload → form state, and form state → request body.
 *
 * The tests concentrate on the `null` cases, because `minimumCatPercent: null` is *meaningful* here
 * ("this course has no CAT gate") and forms are where meanings get flattened. A round trip that
 * turned `null` into `0`, or a blank field into `0`, would pass every type check and quietly change
 * who is allowed to sit the final exam.
 */

const PAYLOAD: OfferingGradingResponse = {
  success: true,
  offeringId: "o1",
  courseCode: "DEMO-MATH-101",
  courseName: "Algebra Foundations",
  config: {
    catWeight: 40,
    fatWeight: 60,
    finalAssessmentId: null,
    minimumCatPercent: 30,
  },
  usingDefaults: false,
  assessments: [],
  derived: null,
  roster: [],
}

function draft(overrides: Partial<GradingDraft> = {}): GradingDraft {
  return {
    catWeight: "40",
    fatWeight: "60",
    finalAssessmentId: "",
    minimumCatPercent: "30",
    gateDisabled: false,
    ...overrides,
  }
}

describe("toGradingDraft", () => {
  it("carries a stored policy into the form", () => {
    expect(toGradingDraft(PAYLOAD)).toEqual({
      catWeight: "40",
      fatWeight: "60",
      finalAssessmentId: "",
      minimumCatPercent: "30",
      gateDisabled: false,
    })
  })

  it("represents a disabled gate as a checkbox, not as a zero", () => {
    // `null` means "no gate". Storing it as the string "0" would put the gate *at* zero, which
    // passes every student while reading as a configured rule — the distinction this field exists
    // to preserve.
    const result = toGradingDraft({
      ...PAYLOAD,
      config: { ...PAYLOAD.config, minimumCatPercent: null },
    })

    expect(result.gateDisabled).toBe(true)
    expect(result.minimumCatPercent).toBe(String(DEFAULT_DRAFT_MINIMUM_CAT))
    expect(result.minimumCatPercent).not.toBe("0")
  })

  it("keeps an explicit assessment id and blanks a derived one", () => {
    expect(
      toGradingDraft({ ...PAYLOAD, config: { ...PAYLOAD.config, finalAssessmentId: "a9" } })
        .finalAssessmentId,
    ).toBe("a9")
    expect(toGradingDraft(PAYLOAD).finalAssessmentId).toBe("")
  })

  it("keeps a zero weight, which is a legitimate configuration", () => {
    // A course with no continuous assessment (all FAT) is expressible; the form must not treat 0 as
    // "empty" and substitute a default.
    const result = toGradingDraft({
      ...PAYLOAD,
      config: { ...PAYLOAD.config, catWeight: 0, fatWeight: 100, minimumCatPercent: 0 },
    })

    expect(result.catWeight).toBe("0")
    expect(result.fatWeight).toBe("100")
    expect(result.gateDisabled).toBe(false)
    expect(result.minimumCatPercent).toBe("0")
  })
})

describe("gradingDraftToRequest", () => {
  it("builds the request body from a valid draft", () => {
    const result = gradingDraftToRequest(draft({ finalAssessmentId: "a2" }))

    expect(result).toEqual({
      ok: true,
      body: {
        catWeight: 40,
        fatWeight: 60,
        finalAssessmentId: "a2",
        minimumCatPercent: 30,
      },
    })
  })

  it("sends null for a derived FAT, not an empty string", () => {
    // `""` is the form's way of saying "derive it"; the API's schema rejects a non-empty string that
    // is not an id, so the conversion has to happen here.
    const result = gradingDraftToRequest(draft({ finalAssessmentId: "" }))

    expect(result.ok && result.body.finalAssessmentId).toBeNull()
  })

  it("sends null for a disabled gate and ignores the placeholder number", () => {
    const result = gradingDraftToRequest(draft({ gateDisabled: true, minimumCatPercent: "30" }))

    expect(result.ok && result.body.minimumCatPercent).toBeNull()
  })

  it("keeps a disabled gate distinct from a gate at zero", () => {
    const disabled = gradingDraftToRequest(draft({ gateDisabled: true }))
    const atZero = gradingDraftToRequest(draft({ gateDisabled: false, minimumCatPercent: "0" }))

    expect(disabled.ok && disabled.body.minimumCatPercent).toBeNull()
    expect(atZero.ok && atZero.body.minimumCatPercent).toBe(0)
  })

  it.each([
    ["weights that do not sum to 100", { catWeight: "40", fatWeight: "40" }, /sum to 100/],
    ["a blank required weight", { catWeight: "", fatWeight: "60" }, /required/],
    ["a non-numeric weight", { catWeight: "forty", fatWeight: "60" }, /must be numbers/],
    ["a negative weight", { catWeight: "-10", fatWeight: "110" }, /between 0 and 100/],
    ["a weight above 100", { catWeight: "40", fatWeight: "160" }, /between 0 and 100/],
    [
      "an enabled gate with a blank value",
      { gateDisabled: false, minimumCatPercent: "" },
      /no gate/,
    ],
    [
      "an out-of-range gate",
      { gateDisabled: false, minimumCatPercent: "140" },
      /between 0 and 100/,
    ],
  ])("refuses %s with a message", (_label, overrides, pattern) => {
    const result = gradingDraftToRequest(draft(overrides))
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toMatch(pattern)
  })

  it("accepts a non-integer split, which the schema permits", () => {
    // Percentages are floats in the contract (`finite()`, not `int()`), so 33.5 / 66.5 is valid and
    // must not be rejected by a stricter check here.
    const result = gradingDraftToRequest(draft({ catWeight: "33.5", fatWeight: "66.5" }))

    expect(result.ok).toBe(true)
    expect(result.ok && result.body.catWeight).toBe(33.5)
  })

  it("accepts the sum to within the schema's tolerance", () => {
    // 33.4 + 66.6 is 100.00000000000001 in binary floating point; the contract compares with a
    // 0.001 tolerance and this must agree, or the form would refuse a body the API would accept.
    expect(gradingDraftToRequest(draft({ catWeight: "33.4", fatWeight: "66.6" })).ok).toBe(true)
  })

  it("round-trips a stored policy without changing it", () => {
    // The property that matters for the payload the teacher did not touch: read → form → request
    // must be the identity, or opening and saving the panel would silently rewrite the policy.
    const stored = {
      catWeight: 25,
      fatWeight: 75,
      finalAssessmentId: "a3",
      minimumCatPercent: 45,
    }
    const result = gradingDraftToRequest(toGradingDraft({ ...PAYLOAD, config: stored }))

    expect(result).toEqual({ ok: true, body: stored })
  })

  it("round-trips a disabled gate without turning it into a number", () => {
    const stored = { ...PAYLOAD.config, minimumCatPercent: null }
    const result = gradingDraftToRequest(toGradingDraft({ ...PAYLOAD, config: stored }))

    expect(result.ok && result.body.minimumCatPercent).toBeNull()
  })
})

describe("weightsSumTo100 / weightSum", () => {
  it("agrees with the request builder", () => {
    // `weightsSumTo100` drives whether the Save button is enabled, and `gradingDraftToRequest`
    // decides whether the body is sent — if they disagreed, a button would look ready and then fail.
    for (const [cat, fat] of [
      ["40", "60"],
      ["0", "100"],
      ["100", "0"],
      ["50", "50"],
    ] as const) {
      const d = draft({ catWeight: cat, fatWeight: fat })
      expect(weightsSumTo100(d)).toBe(true)
      expect(gradingDraftToRequest(d).ok).toBe(true)
    }

    for (const [cat, fat] of [
      ["40", "40"],
      ["0", "0"],
      ["10", "100"],
    ] as const) {
      const d = draft({ catWeight: cat, fatWeight: fat })
      expect(weightsSumTo100(d)).toBe(false)
      expect(gradingDraftToRequest(d).ok).toBe(false)
    }
  })

  it("reports the raw sum so the UI can show it while the teacher types", () => {
    expect(weightSum(draft({ catWeight: "30", fatWeight: "55" }))).toBe(85)
  })
})

describe("gradingPolicySummary", () => {
  it("says plainly when nothing is stored", () => {
    // The line that stops a teacher assuming the displayed default is already in force.
    expect(gradingPolicySummary({ ...PAYLOAD, usingDefaults: true })).toMatch(/Not set/)
    expect(gradingPolicySummary({ ...PAYLOAD, usingDefaults: true })).toMatch(/equally/)
  })

  it("shows the stored split when there is one", () => {
    expect(gradingPolicySummary(PAYLOAD)).toBe("CAT 40% / FAT 60%")
  })

  it("describes itself before the payload has loaded", () => {
    expect(gradingPolicySummary(null)).toBe("CAT / FAT weights and the FAT gate.")
  })
})

describe("status labels and pills", () => {
  it("maps every verdict the API can return", () => {
    for (const status of [
      "eligible",
      "below-cat-minimum",
      "insufficient-cat-work",
      "no-cat-gate",
    ]) {
      expect(catStatusLabel(status)).not.toBe(status)
      expect(catStatusPill(status)).not.toBe("pending")
    }
  })

  it("does not colour insufficient marking as a failure", () => {
    // The verdict is about the marking, not the student. Colouring it like a failure would tell a
    // student they are failing when marking is simply unfinished.
    expect(catStatusPill("insufficient-cat-work")).toBe("insufficient-data")
    expect(catStatusPill("insufficient-cat-work")).not.toBe("failed")
  })

  it("distinguishes 'no gate' from 'passed the gate'", () => {
    expect(catStatusPill("no-cat-gate")).not.toBe(catStatusPill("eligible"))
    expect(catStatusLabel("no-cat-gate")).not.toBe(catStatusLabel("eligible"))
  })

  it("falls back visibly for an unknown status rather than rendering blank", () => {
    expect(catStatusLabel("something-new")).toBe("something-new")
    expect(catStatusPill("something-new")).toBe("pending")
  })
})

describe("catPercentLabel", () => {
  it("renders an em dash for an unmarked pool, never a zero", () => {
    // `null` means nothing is marked. A `0` would read as a student who scored nothing.
    expect(catPercentLabel(null)).toBe("—")
    expect(catPercentLabel(0)).toBe("0%")
    expect(catPercentLabel(72.5)).toBe("72.5%")
  })
})
