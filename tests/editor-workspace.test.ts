import { describe, expect, it } from "vitest"

import { clampSplit, splitForKey, splitFromPointer } from "@/lib/editor-workspace"

const BOUNDS = { min: 22, max: 60 }

describe("clampSplit", () => {
  it("leaves an in-range value alone", () => {
    expect(clampSplit(38, BOUNDS)).toBe(38)
  })

  it("clamps to the bounds", () => {
    expect(clampSplit(5, BOUNDS)).toBe(22)
    expect(clampSplit(99, BOUNDS)).toBe(60)
  })

  it("clamps an infinite value to the nearest bound", () => {
    expect(clampSplit(Number.POSITIVE_INFINITY, BOUNDS)).toBe(60)
    expect(clampSplit(Number.NEGATIVE_INFINITY, BOUNDS)).toBe(22)
  })

  it("falls back to min for NaN", () => {
    expect(clampSplit(Number.NaN, BOUNDS)).toBe(22)
  })
})

describe("splitForKey", () => {
  it("steps by the step size on the arrow keys", () => {
    expect(splitForKey(38, "ArrowLeft", BOUNDS, 2)).toBe(36)
    expect(splitForKey(38, "ArrowRight", BOUNDS, 2)).toBe(40)
  })

  it("clamps an arrow step at the bounds", () => {
    expect(splitForKey(22, "ArrowLeft", BOUNDS, 2)).toBe(22)
    expect(splitForKey(60, "ArrowRight", BOUNDS, 2)).toBe(60)
  })

  it("jumps to the bounds on Home and End", () => {
    expect(splitForKey(38, "Home", BOUNDS, 2)).toBe(22)
    expect(splitForKey(38, "End", BOUNDS, 2)).toBe(60)
  })

  it("ignores any other key", () => {
    expect(splitForKey(38, "ArrowUp", BOUNDS, 2)).toBeNull()
    expect(splitForKey(38, "Tab", BOUNDS, 2)).toBeNull()
    expect(splitForKey(38, "Enter", BOUNDS, 2)).toBeNull()
  })
})

describe("splitFromPointer", () => {
  it("maps a pointer position to a container percentage", () => {
    // 380px of a 1000px container is 38%.
    expect(splitFromPointer(380, 0, 1000, BOUNDS)).toBe(38)
    // Offset container: 700px in a container starting at 100 → 60%.
    expect(splitFromPointer(700, 100, 1000, BOUNDS)).toBe(60)
  })

  it("clamps a drag beyond the bounds", () => {
    expect(splitFromPointer(-50, 0, 1000, BOUNDS)).toBe(22)
    expect(splitFromPointer(5000, 0, 1000, BOUNDS)).toBe(60)
  })

  it("returns null for a degenerate container or non-finite input", () => {
    expect(splitFromPointer(100, 0, 0, BOUNDS)).toBeNull()
    expect(splitFromPointer(Number.NaN, 0, 1000, BOUNDS)).toBeNull()
    expect(splitFromPointer(100, Number.NaN, 1000, BOUNDS)).toBeNull()
  })
})
