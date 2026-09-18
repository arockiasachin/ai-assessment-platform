import { describe, expect, it } from "vitest"

import { ancestorsFor, breadcrumbTrail, parentFor } from "@/lib/navigation"

/**
 * Back-navigation parent map.
 *
 * The map is the whole point of the back affordance: it is deterministic and
 * shareable *because* it is declared rather than inferred from history, so it
 * has to be pinned. These tests assert the two things a wrong map would get
 * wrong — a drilldown with no parent (no link, not a guessed one) and a trail
 * that walks up more than one level.
 */

describe("parentFor", () => {
  it("declares a parent for every shipped drilldown", () => {
    expect(parentFor("/student/code-submissions")).toEqual({
      label: "Assessments",
      href: "/student/assessments",
    })
    expect(parentFor("/student/write")).toEqual({
      label: "Assessments",
      href: "/student/assessments",
    })
    expect(parentFor("/student/retake")).toEqual({ label: "Dashboard", href: "/student" })
    expect(parentFor("/teacher/analytics")).toEqual({ label: "Dashboard", href: "/teacher" })
    expect(parentFor("/teacher/reviews")).toEqual({ label: "Dashboard", href: "/teacher" })
    expect(parentFor("/teacher/observability")).toEqual({ label: "Dashboard", href: "/teacher" })
    expect(parentFor("/teacher/groups")).toEqual({ label: "Dashboard", href: "/teacher" })
  })

  it("resolves a dynamic quiz attempt to its list", () => {
    expect(parentFor("/student/quizzes/attempt-123")).toEqual({
      label: "Quizzes",
      href: "/student/quizzes",
    })
    // And the list itself steps up to the hub.
    expect(parentFor("/student/quizzes")).toEqual({
      label: "Assessments",
      href: "/student/assessments",
    })
  })

  it("is not fooled by a query, a fragment or a trailing slash", () => {
    expect(parentFor("/student/code-submissions?assessmentId=abc")).toBe(
      parentFor("/student/code-submissions"),
    )
    expect(parentFor("/student/retake/")).toBe(parentFor("/student/retake"))
    expect(parentFor("/student/quizzes/abc#top")).toEqual({
      label: "Quizzes",
      href: "/student/quizzes",
    })
  })

  it("returns null for a top-level page, so no link is guessed", () => {
    expect(parentFor("/student")).toBeNull()
    expect(parentFor("/student/assessments")).toBeNull()
    expect(parentFor("/teacher")).toBeNull()
    expect(parentFor("/admin/users")).toBeNull()
  })

  it("does not treat a deeper path as its parent's child", () => {
    // The prefix rule must not apply: `/teacher/analytics/extra` is not a known
    // route, so it has no declared parent rather than silently inheriting one.
    expect(parentFor("/teacher/analytics/extra")).toBeNull()
  })
})

describe("ancestorsFor", () => {
  it("walks up every declared step, oldest first", () => {
    expect(ancestorsFor("/student/quizzes/attempt-123")).toEqual([
      { label: "Assessments", href: "/student/assessments" },
      { label: "Quizzes", href: "/student/quizzes" },
    ])
  })

  it("returns an empty trail when there is no parent", () => {
    expect(ancestorsFor("/student/assessments")).toEqual([])
  })
})

describe("breadcrumbTrail", () => {
  it("ends with the current page, which carries no href", () => {
    expect(breadcrumbTrail("/teacher/analytics", "Analytics")).toEqual([
      { label: "Dashboard", href: "/teacher" },
      { label: "Analytics" },
    ])
  })

  it("renders a lone current crumb on a top-level page", () => {
    expect(breadcrumbTrail("/student/assessments", "Assessments")).toEqual([
      { label: "Assessments" },
    ])
  })
})
