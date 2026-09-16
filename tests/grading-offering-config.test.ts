import { describe, expect, it } from "vitest"

import {
  defaultOfferingGradingConfig,
  derivedGradingMembership,
  parseStoredGradingConfig,
  resolveFinalGradeConfig,
  resolveGradingPolicy,
} from "@/lib/grading/offering-config"
import { DEFAULT_CATEGORY_WEIGHTS, DEFAULT_FAT_MINIMUM_CAT_PERCENT } from "@/lib/grading/policy"
import type { AssessmentType } from "@/lib/generated/prisma/client"

/**
 * Resolving an offering's stored policy into a weighted configuration.
 *
 * This is the seam that made the CAT/FAT policy real. Before it, `lib/grading/policy.ts` was a
 * tested library that nothing called and the export weighted every assessment equally, so none
 * of these behaviours existed in the product at all.
 *
 * The load-bearing property is that **a stored policy changes the export's numbers** — so most
 * of these tests assert on the resolved configuration's weights and membership rather than on
 * the resolver's own return shape.
 */

const ASSESSMENTS: { id: string; type: AssessmentType; dueDate: Date }[] = [
  { id: "a1", type: "QUIZ", dueDate: new Date("2026-09-01") },
  { id: "a2", type: "QUIZ", dueDate: new Date("2026-09-15") },
  { id: "a3", type: "ASSIGNMENT", dueDate: new Date("2026-12-01") },
]

const STORED = {
  catWeight: 40,
  fatWeight: 60,
  finalAssessmentId: null,
  minimumCatPercent: 30,
}

describe("defaults", () => {
  it("is the documented CAT 40 / FAT 60 split with the gate at 30", () => {
    const config = defaultOfferingGradingConfig()

    expect(config.catWeight).toBe(DEFAULT_CATEGORY_WEIGHTS.CAT)
    expect(config.fatWeight).toBe(DEFAULT_CATEGORY_WEIGHTS.FAT)
    expect(config.minimumCatPercent).toBe(DEFAULT_FAT_MINIMUM_CAT_PERCENT)
    expect(config.finalAssessmentId).toBeNull()
  })

  it("treats an unconfigured offering as defaulted, not as an error", () => {
    // The normal case for every offering that predates the column.
    for (const absent of [null, undefined]) {
      const resolved = resolveGradingPolicy(absent)
      expect(resolved.source).toBe("defaults")
      expect(resolved.config).toEqual(defaultOfferingGradingConfig())
    }
  })
})

describe("resolveGradingPolicy", () => {
  it("uses a valid stored policy and says so", () => {
    const resolved = resolveGradingPolicy({ ...STORED, catWeight: 50, fatWeight: 50 })

    expect(resolved.source).toBe("stored")
    expect(resolved.config.catWeight).toBe(50)
  })

  it.each([
    ["weights that do not sum to 100", { ...STORED, catWeight: 40, fatWeight: 40 }],
    ["a missing field", { catWeight: 40, fatWeight: 60 }],
    ["an out-of-range weight", { ...STORED, catWeight: -1 }],
    ["a string where a number belongs", { ...STORED, catWeight: "40" }],
    ["not an object", "CAT 40"],
  ])("falls back to the defaults for %s", (_label, stored) => {
    // Deliberate tolerance rather than throwing: this column is read on the export path, and a
    // malformed policy must not stop a teacher exporting grades. The source is reported so the
    // editor can distinguish "never configured" from "configured and unusable".
    const resolved = resolveGradingPolicy(stored)

    expect(resolved.source).toBe("stored-invalid")
    expect(resolved.config).toEqual(defaultOfferingGradingConfig())
  })

  it("reports absence and malformedness differently even though both default", () => {
    expect(resolveGradingPolicy(null).source).toBe("defaults")
    expect(resolveGradingPolicy({ nope: true }).source).toBe("stored-invalid")
  })
})

describe("parseStoredGradingConfig", () => {
  it("returns the parsed policy for a valid value and null otherwise", () => {
    expect(parseStoredGradingConfig(STORED)).toEqual(STORED)
    expect(parseStoredGradingConfig(null)).toBeNull()
    expect(parseStoredGradingConfig({ catWeight: 10 })).toBeNull()
  })
})

describe("finalAssessmentId", () => {
  it("derives the FAT as the last to fall due when none is chosen", () => {
    const config = resolveFinalGradeConfig({ ...STORED, finalAssessmentId: null }, ASSESSMENTS)

    expect(config?.categories.find((c) => c.id === "fat")?.assessmentIds).toEqual(["a3"])
    expect(config?.categories.find((c) => c.id === "cat")?.assessmentIds).toEqual(["a1", "a2"])
  })

  it("honours an explicit choice over the due-date order", () => {
    // The override the persisted policy exists to provide: the heuristic above is only a
    // default, and a course whose last-due assessment is not its final exam must be correctable.
    const config = resolveFinalGradeConfig({ ...STORED, finalAssessmentId: "a1" }, ASSESSMENTS)

    expect(config?.categories.find((c) => c.id === "fat")?.assessmentIds).toEqual(["a1"])
    expect(config?.categories.find((c) => c.id === "cat")?.assessmentIds).toEqual(["a2", "a3"])
  })

  it("falls back to the heuristic when the chosen id is not in the pool", () => {
    // The read path must tolerate a stale id: a stored policy can outlive the assessment it
    // names, and that must not take a teacher's export down.
    const config = resolveFinalGradeConfig(
      { ...STORED, finalAssessmentId: "deleted-assessment" },
      ASSESSMENTS,
    )

    expect(config?.categories.find((c) => c.id === "fat")?.assessmentIds).toEqual(["a3"])
  })

  it("puts the policy's weights on the categories, not an equal split", () => {
    const config = resolveFinalGradeConfig({ ...STORED, catWeight: 25, fatWeight: 75 }, ASSESSMENTS)

    expect(config?.categories.find((c) => c.id === "cat")?.weight).toBe(25)
    expect(config?.categories.find((c) => c.id === "fat")?.weight).toBe(75)
  })
})

describe("resolveFinalGradeConfig", () => {
  it("returns null below two assessments, so the caller keeps equal weighting", () => {
    // With one assessment there is no CAT/FAT shape to express, and inventing one would put
    // 60% of a course's weight on a single assessment the teacher never designated as the FAT.
    expect(resolveFinalGradeConfig(STORED, [])).toBeNull()
    expect(resolveFinalGradeConfig(STORED, [ASSESSMENTS[0]])).toBeNull()
  })

  it("produces a configuration the export's validator accepts", async () => {
    // The export calls `validateFinalGradeConfig` on whatever this returns and throws on
    // failure, so a policy with a bad sum would break the export rather than degrade. The
    // contract enforces the sum, and this asserts the resolver's output is genuinely usable.
    const { validateFinalGradeConfig } = await import("@/lib/lms-export/weights")
    const config = resolveFinalGradeConfig(STORED, ASSESSMENTS)
    expect(config).not.toBeNull()
    expect(() =>
      validateFinalGradeConfig(config!, { knownAssessmentIds: ASSESSMENTS.map((a) => a.id) }),
    ).not.toThrow()
  })
})

describe("derivedGradingMembership", () => {
  it("reports the derived FAT as derived", () => {
    const membership = derivedGradingMembership({ ...STORED, finalAssessmentId: null }, ASSESSMENTS)

    expect(membership).toEqual({
      catAssessmentIds: ["a1", "a2"],
      fatAssessmentId: "a3",
      fatDerived: true,
    })
  })

  it("reports a chosen FAT as not derived", () => {
    const membership = derivedGradingMembership({ ...STORED, finalAssessmentId: "a2" }, ASSESSMENTS)

    expect(membership?.fatAssessmentId).toBe("a2")
    expect(membership?.fatDerived).toBe(false)
  })

  it("reports a stale choice as derived, since the heuristic is what applied", () => {
    // The distinction the editor renders. Claiming the teacher chose `a3` when they chose a
    // deleted assessment would be a lie with a plausible-looking shape.
    const membership = derivedGradingMembership(
      { ...STORED, finalAssessmentId: "gone" },
      ASSESSMENTS,
    )

    expect(membership?.fatAssessmentId).toBe("a3")
    expect(membership?.fatDerived).toBe(true)
  })

  it("returns null below two assessments", () => {
    expect(derivedGradingMembership(STORED, [ASSESSMENTS[0]])).toBeNull()
  })
})
