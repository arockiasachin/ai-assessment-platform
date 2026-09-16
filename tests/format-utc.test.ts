import { describe, expect, it } from "vitest"

import { formatDate, formatDateTime } from "@/lib/format"

/**
 * `lib/format.ts` exists to enforce one rule: **every date is formatted in UTC with an explicit
 * `timeZone`**, so a Server Component and the browser cannot disagree about the rendered string.
 *
 * That rule had been violated by hand-rolled duplicates in two modules (`lib/gradebook.ts` and
 * `components/teacher-submissions-manager.tsx`, both since removed). These tests exist so the shared
 * helpers cannot quietly regress to local-time formatting.
 *
 * ## Why the instants are chosen the way they are
 *
 * A local-time formatter only differs from a UTC one near a day boundary, and **which** boundary
 * exposes it depends on the machine's offset sign:
 *
 * - on a machine *behind* UTC (the Americas), the day before `T00:00:00Z` is the previous day, so a
 *   midnight-UTC instant is the one that shifts;
 * - on a machine *ahead* of UTC (Europe, Asia), an instant late in the UTC day is the one that
 *   shifts forward.
 *
 * Asserting both directions means the test has teeth wherever it runs, rather than only passing
 * because CI happens to be UTC.
 */

/** "1 Sept 2026" — `en-GB` short month, which is what `formatDate` renders. */
const FIRST_OF_SEPT = "1 Sept 2026"

describe("date formatting is UTC-anchored", () => {
  it("does not shift a midnight-UTC instant backwards", () => {
    // Shifts to "31 Aug 2026" if the formatter uses local time on a machine behind UTC.
    expect(formatDate("2026-09-01T00:00:00.000Z")).toBe(FIRST_OF_SEPT)
  })

  it("does not shift a late-UTC-day instant forwards", () => {
    // Shifts to "2 Sep 2026" if the formatter uses local time on a machine ahead of UTC.
    expect(formatDate("2026-09-01T23:00:00.000Z")).toBe(FIRST_OF_SEPT)
  })

  it("pins the wall clock too, not just the day", () => {
    // `formatDateTime` appends the time, so the same offset sign problem applies to the hour.
    expect(formatDateTime("2026-09-01T23:30:00.000Z")).toContain("23:30")
    expect(formatDateTime("2026-09-01T00:30:00.000Z")).toContain("00:30")
  })

  it("returns an em dash for a missing value, never an empty string or a zero", () => {
    // The module's second documented property: "no value" must not look like a real one.
    expect(formatDate(null)).toBe("—")
    expect(formatDate(undefined)).toBe("—")
    expect(formatDateTime(null)).toBe("—")
  })

  it("renders a date-only string as that same calendar day", () => {
    // Due dates and class dates arrive as `YYYY-MM-DD`, which `new Date()` parses as UTC midnight —
    // exactly the instant that shifts on a machine behind UTC.
    expect(formatDate("2026-12-01")).toBe("1 Dec 2026")
  })
})
