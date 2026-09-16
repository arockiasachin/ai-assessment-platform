import { describe, expect, it } from "vitest"

import {
  BAND_LOWER_OFFSETS,
  ceilGrandTotals,
  gradeBandRanges,
  RELATIVE_LETTERS,
  RELATIVE_PASS_FLOOR,
  relativeLetter,
  sBandNeedsRankRule,
} from "@/lib/analytics/grading-bands"

/**
 * VIT's relative-grading bands.
 *
 * The assertions focus on the things that are easy to get wrong and hard to notice:
 * the direction of the band bounds, the pass floor belonging to the `E`/`F` boundary
 * rather than to `F` itself, and the cases that must report `null` rather than a
 * fabricated letter.
 *
 * Inclusivity is asserted as the documented default (half-open `[min, max)`, so a
 * student exactly on a boundary gets the **upper** band). That detail is the one
 * thing not settled by the recorded regulation, and it is being verified against the
 * primary source — the tests are written so flipping the option is a visible change
 * rather than a silent one.
 */

describe("gradeBandRanges", () => {
  const ranges = gradeBandRanges(70, 10)

  it("emits all seven letters, best first", () => {
    expect(ranges?.map((range) => range.letter)).toEqual([...RELATIVE_LETTERS])
  })

  it("places the boundaries at the regulated σ offsets", () => {
    // mean 70, σ 10 → the offsets land on round numbers, which is the point of
    // choosing this cohort.
    const byLetter = Object.fromEntries((ranges ?? []).map((r) => [r.letter, r]))
    expect(byLetter.S.min).toBe(85) // mean + 1.5σ
    expect(byLetter.A.min).toBe(75) // mean + 0.5σ
    expect(byLetter.B.min).toBe(65) // mean − 0.5σ
    expect(byLetter.C.min).toBe(60) // mean − 1.0σ
    expect(byLetter.D.min).toBe(55) // mean − 1.5σ
    expect(byLetter.E.min).toBe(50) // mean − 2.0σ
    expect(byLetter.F.min).toBe(0)
  })

  it("gives every band except S a closed upper bound, and S an open one", () => {
    // `S` is open above. Every other band's ceiling is the boundary above it.
    const byLetter = Object.fromEntries((ranges ?? []).map((r) => [r.letter, r]))
    expect(byLetter.S.max).toBeNull()
    expect(byLetter.A.max).toBe(85)
    expect(byLetter.F.max).toBe(50)
  })

  it("never gives a band a minimum above its own maximum", () => {
    // The bug this guards: bands run best-first, so pairing each with the *next*
    // band's floor rather than the one above gives S a range of [85, 75) — empty —
    // and every student falls through to the fallback.
    for (const range of ranges ?? []) {
      if (range.max === null) continue
      expect(range.min).toBeLessThan(range.max)
    }
  })

  it("makes the bands contiguous, with no gap and no overlap", () => {
    for (let index = 1; index < (ranges ?? []).length; index += 1) {
      expect(ranges![index].max).toBe(ranges![index - 1].min)
    }
  })

  it("makes the pass floor the E/F boundary, so F is not an empty range", () => {
    // The floor belongs to E's *lower* bound. Applying it to F's lower bound as well
    // collapses F to [50, 50) and makes every failing mark unclassifiable — which
    // returns null, and a null letter renders as nothing rather than as a fail.
    const e = ranges!.find((range) => range.letter === "E")!
    const f = ranges!.find((range) => range.letter === "F")!
    expect(e.min).toBe(RELATIVE_PASS_FLOOR)
    expect(f.min).toBe(0)
    expect(f.max).toBe(RELATIVE_PASS_FLOOR)
  })

  it("uses the floor when mean − 2σ would fall below it", () => {
    // mean 60, σ 10 → mean − 2σ = 40, below the floor, so the floor is used. The S
    // boundary is 75, comfortably under 100, so this cohort is otherwise valid — a
    // stronger cohort would trip the rank rule instead and return null.
    const low = gradeBandRanges(60, 10)!
    expect(low.find((range) => range.letter === "E")!.min).toBe(RELATIVE_PASS_FLOOR)
    expect(low.find((range) => range.letter === "S")!.min).toBe(75)
  })

  it("does not use the floor when the band sits above it", () => {
    // mean 90, σ 5 → 80, well above 50, so the band does the work.
    const tight = gradeBandRanges(90, 5)!
    expect(tight.find((range) => range.letter === "E")!.min).toBe(80)
  })

  it("returns null without a mean or σ rather than inventing boundaries", () => {
    expect(gradeBandRanges(null, 10)).toBeNull()
    expect(gradeBandRanges(70, null)).toBeNull()
    expect(gradeBandRanges(null, null)).toBeNull()
  })

  it("returns null for a flat cohort, where σ is zero", () => {
    // Every student identical: the bands are arithmetically defined but useless, and
    // seven identical boundaries would be worse than saying nothing.
    expect(gradeBandRanges(70, 0)).toBeNull()
  })

  it("returns null when the computed S boundary exceeds 100", () => {
    // mean 95, σ 10 → the S floor is 110. The regulation switches to a rank rule
    // (the top few of the class), which needs a roster this module does not have.
    expect(gradeBandRanges(95, 10)).toBeNull()
    expect(sBandNeedsRankRule(95, 10)).toBe(true)
  })

  it("does not report the rank rule for an ordinary cohort", () => {
    expect(sBandNeedsRankRule(70, 10)).toBe(false)
    expect(sBandNeedsRankRule(null, 10)).toBe(false)
    expect(sBandNeedsRankRule(70, 0)).toBe(false)
  })
})

describe("relativeLetter", () => {
  const ranges = gradeBandRanges(70, 10)

  it("classifies a comfortably-high mark as S", () => {
    expect(relativeLetter(95, ranges)).toBe("S")
  })

  it("classifies the top mark and above as S", () => {
    expect(relativeLetter(100, ranges)).toBe("S")
    expect(relativeLetter(85, ranges)).toBe("S")
  })

  it("puts a boundary mark in the upper band by default", () => {
    // Half-open `[min, max)`: exactly 75 is the bottom of A, not the top of B.
    expect(relativeLetter(75, ranges)).toBe("A")
    expect(relativeLetter(65, ranges)).toBe("B")
  })

  it("can be asked for the lower band instead", () => {
    // The option exists so this detail is a visible switch rather than a silent
    // assumption; flipping it changes every boundary mark.
    expect(relativeLetter(75, ranges, { upperInclusive: false })).toBe("B")
    expect(relativeLetter(65, ranges, { upperInclusive: false })).toBe("C")
  })

  it("treats the pass floor as a pass", () => {
    // Exactly 50 is E, not F — the regulation passes a student at the floor.
    expect(relativeLetter(50, ranges)).toBe("E")
  })

  it("fails a mark below the floor", () => {
    expect(relativeLetter(49, ranges)).toBe("F")
    expect(relativeLetter(0, ranges)).toBe("F")
  })

  it("returns null when there are no bands, rather than defaulting to a letter", () => {
    // The worst outcome here would be a defaulted letter, because it would look like
    // a grade.
    expect(relativeLetter(70, null)).toBeNull()
    expect(relativeLetter(70, [])).toBeNull()
  })

  it("returns null rather than a letter when the cohort cannot produce bands", () => {
    const noBands = gradeBandRanges(95, 10)
    expect(relativeLetter(90, noBands)).toBeNull()
  })

  it("classifies every letter in a normal distribution", () => {
    const cases: [number, string][] = [
      [95, "S"],
      [80, "A"],
      [70, "B"],
      [62, "C"],
      [57, "D"],
      [52, "E"],
      [40, "F"],
    ]
    for (const [mark, expected] of cases) {
      expect(relativeLetter(mark, ranges), `mark ${mark}`).toBe(expected)
    }
  })
})

describe("ceilGrandTotals", () => {
  it("rounds every total up to the next integer", () => {
    // The regulation's rule, and it changes the cohort statistics if applied after
    // rather than before them.
    expect(ceilGrandTotals([72.1, 72.9, 68])).toEqual([73, 73, 68])
  })

  it("leaves an already-integer total alone", () => {
    expect(ceilGrandTotals([70, 80])).toEqual([70, 80])
  })

  it("rounds a zero up to zero", () => {
    expect(ceilGrandTotals([0])).toEqual([0])
  })

  it("does not mutate the array it is given", () => {
    const input = [72.1, 68.4]
    const before = [...input]
    ceilGrandTotals(input)
    expect(input).toEqual(before)
  })

  it("changes the mean and σ when applied first, which is why the order matters", () => {
    // Demonstrates the rule's consequence rather than just its output.
    const raw = [72.9, 72.9, 72.9]
    const rounded = ceilGrandTotals(raw)
    const rawMean = raw.reduce((a, b) => a + b, 0) / raw.length
    const roundedMean = rounded.reduce((a, b) => a + b, 0) / rounded.length
    expect(rawMean).not.toBe(roundedMean)
    expect(roundedMean).toBe(73)
  })
})

describe("BAND_LOWER_OFFSETS", () => {
  it("records the offsets the regulation specifies", () => {
    expect(BAND_LOWER_OFFSETS.S).toBe(1.5)
    expect(BAND_LOWER_OFFSETS.A).toBe(0.5)
    expect(BAND_LOWER_OFFSETS.B).toBe(-0.5)
    expect(BAND_LOWER_OFFSETS.C).toBe(-1.0)
    expect(BAND_LOWER_OFFSETS.D).toBe(-1.5)
    expect(BAND_LOWER_OFFSETS.E).toBe(-2.0)
  })

  it("gives F no offset, because its ceiling is E's floor", () => {
    expect(BAND_LOWER_OFFSETS.F).toBe(Number.NEGATIVE_INFINITY)
  })

  it("descends monotonically from S to E", () => {
    // A non-monotonic table would make the bands cross.
    const ordered = ["S", "A", "B", "C", "D", "E"] as const
    for (let index = 1; index < ordered.length; index += 1) {
      expect(BAND_LOWER_OFFSETS[ordered[index]]).toBeLessThan(
        BAND_LOWER_OFFSETS[ordered[index - 1]],
      )
    }
  })
})
