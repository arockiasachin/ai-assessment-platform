import { describe, expect, it } from "vitest"

import {
  assessmentsEmptyDescription,
  dueLabel,
  isHandedIn,
  matchesStatusFilter,
} from "@/lib/student-assessments-view"

/**
 * Assessments-list view logic.
 *
 * Pure and here rather than in the component for the repo's usual reason: no jsdom,
 * so a rule left inside the `useMemo` has no test. Three rules that had two renderings
 * each are pinned here — the due label (SN-25), the Overdue filter (SN-25) and the
 * empty state (SN-18/SN-46).
 */

describe("dueLabel", () => {
  it("says today and tomorrow rather than 'in 0 days'", () => {
    expect(dueLabel({ isPastDue: false, daysUntilDue: 0 })).toBe("Due today")
    expect(dueLabel({ isPastDue: false, daysUntilDue: 1 })).toBe("Due tomorrow")
    expect(dueLabel({ isPastDue: false, daysUntilDue: 4 })).toBe("Due in 4 days")
  })

  it("reads isPastDue before the day count, so the first day overdue is not 'Due today'", () => {
    // `daysUntilDue` is a ceiling, so it is 0 for anything up to a day past the
    // deadline. The old order returned "Due today" while the badge beside it was the
    // destructive overdue tone (SN-25).
    expect(dueLabel({ isPastDue: true, daysUntilDue: 0 })).toBe("Overdue")
    expect(dueLabel({ isPastDue: true, daysUntilDue: -1 })).toBe("1 day overdue")
    expect(dueLabel({ isPastDue: true, daysUntilDue: -3 })).toBe("3 days overdue")
  })

  it("never says '0 days overdue'", () => {
    expect(dueLabel({ isPastDue: true, daysUntilDue: 0 })).not.toContain("0 days")
  })
})

describe("matchesStatusFilter", () => {
  it("matches everything for the All filter", () => {
    expect(matchesStatusFilter({ isPastDue: true, submissionState: "late" }, "all")).toBe(true)
  })

  it("keys Graded and Pending off the same submissionState the badge renders", () => {
    expect(matchesStatusFilter({ isPastDue: false, submissionState: "graded" }, "graded")).toBe(
      true,
    )
    expect(matchesStatusFilter({ isPastDue: false, submissionState: "submitted" }, "graded")).toBe(
      false,
    )
    expect(matchesStatusFilter({ isPastDue: false, submissionState: "submitted" }, "pending")).toBe(
      true,
    )
    expect(matchesStatusFilter({ isPastDue: false, submissionState: "graded" }, "pending")).toBe(
      false,
    )
  })

  it("does not count handed-in work as overdue", () => {
    // A past-due submission is done, not overdue. The old filter keyed on
    // `isPastDue` alone, so a late submission stayed under Overdue forever (SN-25).
    for (const submissionState of ["submitted", "resubmitted", "graded", "late"] as const) {
      expect(matchesStatusFilter({ isPastDue: true, submissionState }, "overdue")).toBe(false)
    }
  })

  it("counts an unhanded-in past-due item as overdue", () => {
    expect(
      matchesStatusFilter({ isPastDue: true, submissionState: "not_submitted" }, "overdue"),
    ).toBe(true)
    expect(matchesStatusFilter({ isPastDue: true, submissionState: "draft" }, "overdue")).toBe(true)
    expect(matchesStatusFilter({ isPastDue: false, submissionState: "draft" }, "overdue")).toBe(
      false,
    )
  })
})

describe("isHandedIn", () => {
  it("treats late as handed in but a draft as not", () => {
    expect(isHandedIn("late")).toBe(true)
    expect(isHandedIn("draft")).toBe(false)
    expect(isHandedIn("not_submitted")).toBe(false)
  })
})

describe("assessmentsEmptyDescription", () => {
  it("blames the filters only when there is something to filter", () => {
    expect(assessmentsEmptyDescription(4)).toBe("No assessments match the current filters.")
  })

  it("names the real state when the student has no assessments at all", () => {
    // The empty state told a student with zero assessments to adjust filters that
    // could not exist (SN-18/SN-46).
    const copy = assessmentsEmptyDescription(0)
    expect(copy).not.toContain("filters")
    expect(copy).toContain("no assessments yet")
  })
})
