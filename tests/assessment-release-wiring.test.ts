import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * TN-1 / TN-31 was an **uncalled** write path, not a broken one: the release API returned
 * 200 and wrote an audit row, but nothing in the product invoked it, so no assessment could
 * reach a student. No service or route test can see that — the service was already covered
 * and correct. This is a source-level wiring check in the same spirit as `nav-scope.test.ts`
 * and `mock-layer-scope.test.ts`: it fails if the caller is ever removed again.
 *
 * The repo has no jsdom, so a rendered-DOM assertion is not available; asserting the
 * request contract in source is the closest honest proof that the UI reaches the API.
 */
const repoRoot = fileURLToPath(new URL("..", import.meta.url))

function source(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8")
}

describe("assessment release wiring", () => {
  it("the control posts to the release route", () => {
    const control = source("components/assessment-release-control.tsx")
    expect(control).toContain("/api/teacher/assessments/${assessmentId}/release")
    expect(control).toContain('method: "POST"')
  })

  it("the planner renders the release control where the deadline pill used to be", () => {
    expect(source("components/teacher-planner-view.tsx")).toContain("AssessmentReleaseControl")
  })

  it("the dashboard renders the release control beside its release state", () => {
    expect(source("components/teacher-dashboard.tsx")).toContain("AssessmentReleaseControl")
  })
})
