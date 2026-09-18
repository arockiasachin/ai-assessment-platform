import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * Source-level wiring for the student marks/grades/arrears surfaces.
 *
 * The repo has no jsdom (see `vitest.config.mts`), so a rendered-DOM assertion is
 * not available for a page — `tests/assessment-release-wiring.test.ts` and
 * `tests/nav-scope.test.ts` set the precedent of asserting the wiring in source.
 * These tests exist for the defects a rendered page would hide anyway:
 *
 * - both pages reading `Grade` themselves instead of reusing a reader, which would
 *   let them disagree about which marks exist;
 * - the current-term content reappearing on the repurposed grades page, which the
 *   split exists to prevent;
 * - a course hub becoming an id-segment route (`[courseCode]`), which this app
 *   deliberately does not use for selection state;
 * - any page opting out of the shell's default width, which the plan forbids
 *   because these are reading pages, not full-width editor workspaces.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8")
}

const MARKS_PAGE = "app/(dashboard)/student/marks/page.tsx"
const MARKS_VIEW = "components/student-marks-view.tsx"
const GRADES_PAGE = "app/(dashboard)/student/grades/page.tsx"
const GRADES_VIEW = "components/student-grades-view.tsx"
const ARREARS_PAGE = "app/(dashboard)/student/arrears/page.tsx"
const ARREARS_VIEW = "components/student-arrears-view.tsx"
const COURSE_PAGE = "app/(dashboard)/student/course/page.tsx"

describe("the marks page", () => {
  it("exists and renders inside the app shell with the default width", () => {
    const page = source(MARKS_PAGE)
    expect(page).toContain('scope="app"')
    // The shell default is `mx-auto max-w-7xl`; `width="full"` drops it and is for
    // the two-pane editors only.
    expect(page).not.toContain('width="full"')
  })

  it("reads through listStudentAssessments rather than querying Grade itself", () => {
    const page = source(MARKS_PAGE)
    expect(page).toContain("listStudentAssessments")
    // The guard that matters: a second `Grade` query would be a second answer to
    // "which marks does this student have, and which are released?".
    expect(page).not.toContain("prisma")
    expect(page).not.toContain("grade.findMany")
  })

  it("groups with the pure current-term module instead of recomputing averages inline", () => {
    // The module is the one place that decides which marks count into an average, so
    // neither page recomputes it.
    expect(source(MARKS_PAGE)).toContain("buildCurrentTermMarks")
    expect(source(MARKS_PAGE)).toContain("buildStudentGrades")
    expect(source(MARKS_VIEW)).not.toContain("buildStudentGrades")
  })

  it("surfaces outstanding arrears and links each subject to the course hub", () => {
    expect(source(MARKS_VIEW)).toContain("StudentArrearsNotice")
    expect(source(MARKS_VIEW)).toContain('pathname: "/student/course"')
    expect(source(MARKS_VIEW)).toContain("courseCode")
  })
})

describe("the grades page", () => {
  it("exists and renders inside the app shell with the default width", () => {
    const page = source(GRADES_PAGE)
    expect(page).toContain('scope="app"')
    expect(page).not.toContain('width="full"')
  })

  it("reads the outcome reader rather than querying marks itself", () => {
    const page = source(GRADES_PAGE)
    expect(page).toContain("listStudentCourseOutcomes")
    expect(page).not.toContain("prisma")
  })

  it("shows completed courses only, so the current term lives on Marks alone", () => {
    expect(source(GRADES_PAGE)).toContain("completedCourses")
    // The current-term grouping must not reappear here — that would give the same
    // rows two homes, which is what the marks/grades split removes.
    expect(source(GRADES_PAGE)).not.toContain("buildStudentGrades")
    expect(source(GRADES_PAGE)).not.toContain("listStudentAssessments")
  })

  it("keeps 'not judged' visually distinct from 'failed'", () => {
    const view = source(GRADES_VIEW)
    expect(view).toContain('"not-judged": "insufficient-data"')
    expect(view).toContain('fail: "failed"')
  })
})

describe("the arrears page", () => {
  it("exists and renders inside the app shell with the default width", () => {
    const page = source(ARREARS_PAGE)
    expect(page).toContain('scope="app"')
    expect(page).not.toContain('width="full"')
  })

  it("reads the arrear field rather than inferring one from a not-judged verdict", () => {
    const page = source(ARREARS_PAGE)
    expect(page).toContain("arrearEntries")
    expect(page).toContain("listStudentCourseOutcomes")
    expect(page).not.toContain("prisma")
  })

  it("explains what an arrear is, including when the list is empty", () => {
    const view = source(ARREARS_VIEW)
    expect(view).toContain("No outstanding arrears")
    expect(view).toContain("WHAT_AN_ARREAR_IS")
    expect(view).toContain("ARREAR_REASON_LABEL")
  })
})

describe("the course hub", () => {
  it("exists and renders inside the app shell with the default width", () => {
    const page = source(COURSE_PAGE)
    expect(page).toContain('scope="app"')
    expect(page).not.toContain('width="full"')
  })

  it("selects the course with a query param, not an id segment", () => {
    const page = source(COURSE_PAGE)
    expect(page).toContain("searchParams")
    expect(page).toContain("courseCode")
    // The route is `/student/course?courseCode=…`. An id-segment page would put
    // the selection in the path, which this app deliberately avoids.
    expect(
      fs.existsSync(path.join(repoRoot, "app/(dashboard)/student/course/[courseCode]")),
      "the course hub must not be an id-segment route",
    ).toBe(false)
  })

  it("combines the existing readers rather than adding a query model", () => {
    const page = source(COURSE_PAGE)
    expect(page).toContain("listStudentAssessments")
    expect(page).toContain("listMaterialsForStudent")
    expect(page).toContain("buildStudentGrades")
    expect(page).not.toContain("prisma")
  })
})

describe("the link from the assessments hub", () => {
  it("offers a way into the course hub from an assessment card", () => {
    const view = source("components/student-assessments-view.tsx")
    expect(view).toContain("/student/course")
    expect(view).toContain("courseCode")
  })
})
