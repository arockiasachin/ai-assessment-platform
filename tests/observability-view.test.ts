import { describe, expect, it } from "vitest"

import type { GradeActivityItem } from "@/lib/observability/audit-view"
import type { GradingDecisionItem } from "@/lib/observability/grading-decisions"
import {
  activityActionOptions,
  actorKindOptions,
  filterActivity,
  isActivityFiltered,
  isAutomated,
  searchableText,
  withheldDecisionCount,
} from "@/lib/observability-view"

/**
 * Activity-log view logic.
 *
 * Pure, and here rather than in the component because this repo has no jsdom: logic
 * left inside a `useMemo` has no test, and the actor/action selects render in a portal
 * that snapshot tooling cannot drive.
 */

function staff(overrides: Partial<GradeActivityItem> = {}): GradeActivityItem {
  return {
    id: "audit_1",
    action: "grade_review.accept",
    entityType: "GradeReview",
    entityId: "rev_1",
    entityLabel: "Review",
    assessmentId: "asm_1",
    actorId: "usr_teacher_1",
    actorRole: "teacher",
    actorName: "Dr. Meera Raman",
    createdAt: "2026-09-16T09:00:00.000Z",
    summary: { decision: "accept", points: 8.5 },
    ...overrides,
  }
}

function automated(overrides: Partial<GradeActivityItem> = {}): GradeActivityItem {
  return staff({
    id: "audit_2",
    action: "retention.purged",
    entityType: "Grade",
    entityId: "grade_1",
    entityLabel: "Grade",
    actorId: null,
    actorRole: "system",
    actorName: null,
    summary: { purged: 3 },
    ...overrides,
  })
}

function decision(overrides: Partial<GradingDecisionItem> = {}): GradingDecisionItem {
  return {
    id: "grade_1",
    studentName: "Sam Student",
    assessmentTitle: "Linear Equations Check-in",
    points: 8,
    maxPoints: 10,
    percent: 80,
    source: "TEACHER_OVERRIDE",
    overrideReason: "Partial credit for method",
    approvedBy: "Dr. Meera Raman",
    publishedAt: "2026-09-15T09:00:00.000Z",
    ...overrides,
  }
}

describe("isAutomated", () => {
  it("classifies a null actor id as automated", () => {
    expect(isAutomated(automated())).toBe(true)
  })

  it("classifies a real actor id as staff", () => {
    expect(isAutomated(staff())).toBe(false)
  })

  it("uses the id, not the role string", () => {
    // A row with a real actor id is a staff action even if something labelled its
    // role oddly; the id is structurally absent or it is not, while the role is
    // free-form text a caller chooses.
    expect(isAutomated(staff({ actorRole: "system" }))).toBe(false)
    expect(isAutomated(automated({ actorRole: "teacher" }))).toBe(true)
  })
})

describe("searchableText", () => {
  it("flattens scalar summary fields to lowercase text", () => {
    const text = searchableText(staff())
    expect(text).toContain("decision accept")
    expect(text).toContain("points 8.5")
  })

  it("ignores nested objects and arrays", () => {
    const text = searchableText(staff({ summary: { keep: "yes", drop: { nested: true } } }))
    expect(text).toBe("keep yes")
  })

  it("returns empty for a null, array, or non-object summary", () => {
    expect(searchableText(staff({ summary: null }))).toBe("")
    expect(searchableText(staff({ summary: [1, 2] }))).toBe("")
    expect(searchableText(staff({ summary: "text" }))).toBe("")
  })
})

describe("filterActivity", () => {
  const none = { search: "", action: "all", actorKind: "all" as const }
  const fixtures = [
    staff({ id: "a", action: "grade_review.accept" }),
    staff({ id: "b", action: "grade_review.override", actorId: "usr_teacher_2" }),
    automated({ id: "c" }),
  ]

  it("returns everything when nothing is filtered", () => {
    expect(filterActivity(fixtures, none)).toHaveLength(3)
  })

  it("matches the action string", () => {
    expect(filterActivity(fixtures, { ...none, search: "override" }).map((i) => i.id)).toEqual([
      "b",
    ])
  })

  it("matches the entity label", () => {
    expect(filterActivity(fixtures, { ...none, search: "review" }).map((i) => i.id)).toEqual([
      "a",
      "b",
    ])
  })

  it("matches inside the summary, which is where a teacher's own note appears", () => {
    expect(filterActivity(fixtures, { ...none, search: "8.5" }).map((i) => i.id)).toEqual([
      "a",
      "b",
    ])
  })

  it("filters to staff only", () => {
    expect(filterActivity(fixtures, { ...none, actorKind: "staff" }).map((i) => i.id)).toEqual([
      "a",
      "b",
    ])
  })

  it("filters to automated workers only", () => {
    // The filter that matters: it is how a teacher separates a retention purge from
    // a human decision.
    expect(filterActivity(fixtures, { ...none, actorKind: "automated" }).map((i) => i.id)).toEqual([
      "c",
    ])
  })

  it("narrows by exact action, not substring", () => {
    // A menu selection is an exact match, so choosing "grade_review.accept" must not
    // also return "grade_review.accepted_by_someone_else".
    const withSimilar = [...fixtures, staff({ id: "d", action: "grade_review.accept_extra" })]
    expect(
      filterActivity(withSimilar, { ...none, action: "grade_review.accept" }).map((i) => i.id),
    ).toEqual(["a"])
  })

  it("applies the action, actor and search filters together", () => {
    expect(
      filterActivity(fixtures, {
        search: "review",
        action: "grade_review.override",
        actorKind: "staff",
      }).map((i) => i.id),
    ).toEqual(["b"])
    // The same search with an actor kind that cannot match must return nothing.
    expect(
      filterActivity(fixtures, { search: "review", action: "all", actorKind: "automated" }),
    ).toEqual([])
  })

  it("returns an empty list, not everything, when nothing matches", () => {
    expect(filterActivity(fixtures, { ...none, search: "zzz" })).toEqual([])
  })

  it("treats a whitespace-only search as no search", () => {
    expect(filterActivity(fixtures, { ...none, search: "   " })).toHaveLength(3)
  })

  it("does not mutate the list it is given", () => {
    const input = [...fixtures]
    const before = input.map((item) => item.id)
    filterActivity(input, { ...none, search: "override" })
    expect(input.map((item) => item.id)).toEqual(before)
  })
})

describe("isActivityFiltered", () => {
  it("is false only at the defaults", () => {
    expect(isActivityFiltered({ search: "", action: "all", actorKind: "all" })).toBe(false)
    expect(isActivityFiltered({ search: "  ", action: "all", actorKind: "all" })).toBe(false)
  })

  it("is true when any control is set", () => {
    expect(isActivityFiltered({ search: "x", action: "all", actorKind: "all" })).toBe(true)
    expect(isActivityFiltered({ search: "", action: "grade.published", actorKind: "all" })).toBe(
      true,
    )
    expect(isActivityFiltered({ search: "", action: "all", actorKind: "automated" })).toBe(true)
  })
})

describe("activityActionOptions", () => {
  const labelFor = (action: string) => `label:${action}`

  it("offers only the actions present, with All first", () => {
    const options = activityActionOptions(
      [staff({ action: "b" }), staff({ action: "a" }), staff({ action: "a" })],
      labelFor,
    )
    expect(options.map((o) => o.value)).toEqual(["all", "a", "b"])
  })

  it("labels options through the supplied mapper, so wording has one home", () => {
    expect(activityActionOptions([staff({ action: "x" })], labelFor)[1]).toEqual({
      value: "x",
      label: "label:x",
    })
  })

  it("offers only All when there is no activity", () => {
    expect(activityActionOptions([], labelFor)).toEqual([{ value: "all", label: "All actions" }])
  })
})

describe("actorKindOptions", () => {
  it("offers both kinds when both are present", () => {
    expect(actorKindOptions([staff(), automated()]).map((o) => o.value)).toEqual([
      "all",
      "staff",
      "automated",
    ])
  })

  it("omits a kind that cannot match anything", () => {
    // A menu entry that guarantees an empty table is worse than a shorter menu.
    expect(actorKindOptions([staff()]).map((o) => o.value)).toEqual(["all", "staff"])
    expect(actorKindOptions([automated()]).map((o) => o.value)).toEqual(["all", "automated"])
  })

  it("offers only All when there is no activity", () => {
    expect(actorKindOptions([]).map((o) => o.value)).toEqual(["all"])
  })
})

describe("withheldDecisionCount", () => {
  it("counts decisions whose mark is not published", () => {
    expect(
      withheldDecisionCount([
        decision({ id: "a", publishedAt: null }),
        decision({ id: "b", publishedAt: "2026-09-15T09:00:00.000Z" }),
        decision({ id: "c", publishedAt: null }),
      ]),
    ).toBe(2)
  })

  it("is zero when every decision is published", () => {
    expect(withheldDecisionCount([decision()])).toBe(0)
    expect(withheldDecisionCount([])).toBe(0)
  })
})
