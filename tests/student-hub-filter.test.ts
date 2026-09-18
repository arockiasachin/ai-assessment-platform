import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import {
  activeAssessmentFilters,
  ASSESSMENT_COURSE_FILTER_ALL,
  ASSESSMENT_STATUS_FILTER_LABEL,
  ASSESSMENT_TYPE_FILTER_LABEL,
  assessmentStatusFilterOptions,
  assessmentTypeFilterOptions,
  matchesCourseFilter,
} from "@/lib/student-assessments-view"

/**
 * The hub's compact, course-driven filter.
 *
 * The filter *interaction* has no test for this repo's usual reason — no jsdom,
 * and the Select popup lives in a portal. What is testable is the pure rule
 * behind it (the course scope), the vocabulary it renders (so a trigger can
 * never show a raw enum), and the source shape that keeps the defects from
 * returning (FilterBar with a value→label map, and no second count of "due").
 */

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..")

function read(relative: string): string {
  return fs.readFileSync(path.join(repoRoot, relative), "utf8")
}

/** Strip comments so docblocks naming a deleted pattern do not satisfy a scan. */
function readCode(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
}

describe("matchesCourseFilter", () => {
  const item = { courseId: "course_math" }

  it("matches every course for All", () => {
    expect(matchesCourseFilter(item, ASSESSMENT_COURSE_FILTER_ALL)).toBe(true)
  })

  it("treats a missing scope as All rather than as an empty course", () => {
    // An unset/empty value must not turn into "match nothing", which renders an
    // empty list that looks like data loss.
    expect(matchesCourseFilter(item, "")).toBe(true)
  })

  it("scopes to exactly one course", () => {
    expect(matchesCourseFilter(item, "course_math")).toBe(true)
    expect(matchesCourseFilter(item, "course_physics")).toBe(false)
  })
})

describe("filter label vocabulary", () => {
  it("never labels a filter with its raw stored value", () => {
    // The defect being pinned: a trigger rendering `QUIZ` / `graded` because the
    // Select root had no value→label map. Every non-All option must read as prose.
    for (const option of [...assessmentTypeFilterOptions(), ...assessmentStatusFilterOptions()]) {
      if (option.value === "all") continue
      expect(option.label, `${option.value} renders raw`).not.toBe(option.value)
    }
  })

  it("uses the shared maps as the one source of each word", () => {
    for (const option of assessmentTypeFilterOptions()) {
      expect(option.label).toBe(ASSESSMENT_TYPE_FILTER_LABEL[option.value])
    }
    for (const option of assessmentStatusFilterOptions()) {
      expect(option.label).toBe(ASSESSMENT_STATUS_FILTER_LABEL[option.value])
    }
  })

  it("offers All first, and groups written work as one entry", () => {
    expect(assessmentTypeFilterOptions().map((option) => option.value)).toEqual([
      "all",
      "QUIZ",
      "WRITTEN",
      "CODE",
      "GROUP_PROJECT",
    ])
    // Descriptive and assignment are one "Written" grouping, matching the sidebar,
    // rather than two entries the menu never links to.
    expect(assessmentTypeFilterOptions().map((option) => option.value)).not.toContain("DESCRIPTIVE")
    expect(assessmentTypeFilterOptions().map((option) => option.value)).not.toContain("ASSIGNMENT")
  })

  it("names all four statuses", () => {
    expect(assessmentStatusFilterOptions().map((option) => option.value)).toEqual([
      "all",
      "graded",
      "pending",
      "overdue",
    ])
  })
})

describe("activeAssessmentFilters", () => {
  it("is empty when nothing narrows the list", () => {
    expect(
      activeAssessmentFilters({ courseLabel: null, typeFilter: "all", statusFilter: "all" }),
    ).toEqual([])
  })

  it("names what is applied in words, not in raw values", () => {
    expect(
      activeAssessmentFilters({
        courseLabel: "DEMO-MATH-101",
        typeFilter: "WRITTEN",
        statusFilter: "overdue",
      }),
    ).toEqual(["Course: DEMO-MATH-101", "Type: Written and assignments", "Status: Overdue"])
  })

  it("omits the course line when no course is scoped", () => {
    expect(
      activeAssessmentFilters({ courseLabel: null, typeFilter: "QUIZ", statusFilter: "all" }),
    ).toEqual(["Type: Quiz"])
  })
})

describe("the hub uses the shared FilterBar instead of a hand-rolled card", () => {
  const source = readCode("components/student-assessments-view.tsx")

  it("renders the FilterBar", () => {
    expect(source).toContain("<FilterBar")
  })

  it("has no hand-rolled Select left, which is where the unlabelled raw boxes came from", () => {
    expect(source).not.toMatch(/<Select[\s>]/)
    expect(source).not.toContain("SelectTrigger")
  })

  it("keeps the course scope, one course at a time with All as the default", () => {
    expect(source).toContain("ASSESSMENT_COURSE_FILTER_ALL")
    expect(source).toContain("aria-pressed={courseScope === course.id}")
    expect(source).toContain("setCourseScope")
    // The course dropdown is gone, but the hub link for the scoped course stays.
    expect(source).toContain('pathname: "/student/course"')
  })

  it("collapses the type/status controls to icon toggles when a course is chosen", () => {
    expect(source).toContain("IconToggleGroup")
    expect(source).toContain("compact")
  })

  it("shows what is applied without opening a select", () => {
    expect(source).toContain("activeAssessmentFilters")
    expect(source).toContain("appliedFilters")
  })

  it("keeps the sidebar's ?type= contract wired to the URL", () => {
    expect(source).toContain('parseAssessmentTypeFilter(searchParams.get("type"))')
    expect(source).toContain('params.set("type", value)')
    expect(source).toContain("matchesTypeFilter")
  })

  it("counts Due in 7d through the shared outstanding rule, not locally", () => {
    // The old inline count included already-submitted work, so this tile and the
    // dashboard's "Due this week" disagreed. `dueThisWeek` is built on
    // `outstandingAssessments`, so the two now agree by construction.
    expect(source).toContain("dueThisWeek(allAssessments)")
    expect(source).not.toContain("summary.upcoming")
  })
})
