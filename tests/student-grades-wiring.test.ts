import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * Source-level wiring for the Phase 2 grades surfaces.
 *
 * The repo has no jsdom (see `vitest.config.mts`), so a rendered-DOM assertion is
 * not available for a page — `tests/assessment-release-wiring.test.ts` and
 * `tests/nav-scope.test.ts` set the precedent of asserting the wiring in source.
 * These tests exist for the defects a rendered page would hide anyway:
 *
 * - the grades page reading `Grade` itself instead of reusing the assessments
 *   reader, which would let the two disagree about which marks exist;
 * - the course hub becoming an id-segment route (`[courseCode]`), which this app
 *   deliberately does not use for selection state;
 * - either page opting out of the shell's default width, which the plan forbids
 *   because these are reading pages, not full-width editor workspaces.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url))

function source(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8")
}

const GRADES_PAGE = "app/(dashboard)/student/grades/page.tsx"
const COURSE_PAGE = "app/(dashboard)/student/course/page.tsx"

describe("the grades page", () => {
  it("exists and renders inside the app shell with the default width", () => {
    const page = source(GRADES_PAGE)
    expect(page).toContain('scope="app"')
    // The shell default is `mx-auto max-w-7xl`; `width="full"` drops it and is for
    // the two-pane editors only.
    expect(page).not.toContain('width="full"')
  })

  it("reads through listStudentAssessments rather than querying Grade itself", () => {
    const page = source(GRADES_PAGE)
    expect(page).toContain("listStudentAssessments")
    // The guard that matters: a second `Grade` query would be a second answer to
    // "which marks does this student have, and which are released?".
    expect(page).not.toContain("prisma")
    expect(page).not.toContain("grade.findMany")
  })

  it("groups with the pure module instead of recomputing averages inline", () => {
    expect(source(GRADES_PAGE)).toContain("buildStudentGrades")
  })

  it("links each subject to the course hub by course code", () => {
    const page = source(GRADES_PAGE)
    expect(page).toContain('pathname: "/student/course"')
    expect(page).toContain("courseCode")
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
