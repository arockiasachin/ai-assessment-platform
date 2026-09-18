import { describe, expect, it } from "vitest"

import {
  courseRunWindowLabel,
  formatCourseDate,
  registrationWindowLabel,
} from "@/lib/student-courses-view"

/**
 * Course-catalog view logic.
 *
 * Both ends of the registration window defaulted to null, so every row rendered
 * "— → —": a range-shaped placeholder for "there is no window" (SN-19). The label
 * now names the state, and the same handling covers the run dates.
 */

describe("formatCourseDate", () => {
  it("formats in UTC so the server and browser renders agree", () => {
    expect(formatCourseDate("2026-01-15T23:59:59.000Z")).toBe("15 Jan 2026")
  })

  it("renders null as an em dash", () => {
    expect(formatCourseDate(null)).toBe("—")
  })
})

describe("registrationWindowLabel", () => {
  it("says there is no window when both ends are null", () => {
    expect(registrationWindowLabel({ openAt: null, closeAt: null })).toBe("Not scheduled")
  })

  it("names the side that exists when only one does", () => {
    expect(registrationWindowLabel({ openAt: "2026-01-01T00:00:00.000Z", closeAt: null })).toBe(
      "Opens 1 Jan 2026",
    )
    expect(registrationWindowLabel({ openAt: null, closeAt: "2026-02-01T00:00:00.000Z" })).toBe(
      "Closes 1 Feb 2026",
    )
  })

  it("renders a real range as a range", () => {
    expect(
      registrationWindowLabel({
        openAt: "2026-01-01T00:00:00.000Z",
        closeAt: "2026-02-01T00:00:00.000Z",
      }),
    ).toBe("1 Jan 2026 → 1 Feb 2026")
  })

  it("never renders the double-dash placeholder", () => {
    expect(registrationWindowLabel({ openAt: null, closeAt: null })).not.toContain("→")
    expect(registrationWindowLabel({ openAt: null, closeAt: null })).not.toContain("—")
  })
})

describe("courseRunWindowLabel", () => {
  it("says not scheduled when the course has no run dates", () => {
    expect(courseRunWindowLabel({ startsOn: null, endsOn: null })).toBe("Not scheduled")
  })

  it("names one-sided run dates", () => {
    expect(courseRunWindowLabel({ startsOn: "2026-01-01T00:00:00.000Z", endsOn: null })).toBe(
      "From 1 Jan 2026",
    )
    expect(courseRunWindowLabel({ startsOn: null, endsOn: "2026-02-01T00:00:00.000Z" })).toBe(
      "Until 1 Feb 2026",
    )
  })

  it("renders a real range as a range", () => {
    expect(
      courseRunWindowLabel({
        startsOn: "2026-01-01T00:00:00.000Z",
        endsOn: "2026-02-01T00:00:00.000Z",
      }),
    ).toBe("1 Jan 2026 → 1 Feb 2026")
  })
})
