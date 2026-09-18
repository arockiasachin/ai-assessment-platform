import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

/**
 * Phase 3 wiring, pinned at the source.
 *
 * These are the things a pure module cannot carry: that a reader's number reaches a
 * rendered chart, that the section is gated on its floor, and that the select is given
 * its items. This repo has no DOM environment, so the alternative is nothing at all.
 * The assertions are deliberately narrow — presence and the named gate, not layout.
 */

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..")

function read(relative: string): string {
  // Strip comments so prose naming a deleted symbol cannot satisfy (or trip) an
  // assertion about what actually renders.
  return fs
    .readFileSync(path.join(repoRoot, relative), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
}

const analytics = read("components/student-analytics.tsx")

describe("chart components live in the client chart module", () => {
  const charts = read("components/charts.tsx")

  it.each(["YouVsClassChart", "TopicMasteryRadar", "RadialGauge", "DivergingBarChart"])(
    "exports %s",
    (name) => {
      expect(charts).toContain(`export function ${name}`)
    },
  )

  it("leaves a gap in the personal line rather than interpolating across it", () => {
    expect(charts).toContain("connectNulls={false}")
  })
})

describe("section heading outline", () => {
  it("gives SectionCard a titleAs prop, mirroring Callout", () => {
    expect(read("components/ui/section-card.tsx")).toContain("titleAs")
  })

  it("passes h3 for every per-course section", () => {
    // `h2` is the course heading, so its sections are `h3`. Counted rather than matched once
    // so a newly added card that forgets the prop fails here.
    expect((analytics.match(/titleAs="h3"/g) ?? []).length).toBeGreaterThanOrEqual(9)
  })
})

describe("course selection", () => {
  it("defaults to All, supplies items, and offers one option per course", () => {
    expect(analytics).toContain("useState<string>(ALL_COURSES_VALUE)")
    expect(analytics).toContain("items={options}")
    expect(analytics).toContain("courseFilterOptions(analytics.courses)")
    expect(analytics).toContain("coursesForFilter(analytics.courses, selectedCourse)")
  })
})

describe("each new chart is present and gated on its own floor", () => {
  it.each([
    ["YouVsClassChart", "MIN_COMPARISON_POINTS"],
    ["TopicMasteryRadar", "MIN_RADAR_TOPICS"],
    ["DivergingBarChart", "differences.length > 0"],
    ["RadialGauge", "courseTotal !== null"],
    ["GradeDonut", "course.distribution !== null"],
  ])("%s with %s", (chart, gate) => {
    expect(analytics).toContain(chart)
    expect(analytics).toContain(gate)
  })

  it("uses the two-point trend floor, not the any-point helper", () => {
    expect(analytics).toContain("hasEnoughTrendPoints(course.trend.series)")
    expect(analytics).not.toContain("hasTrendData")
  })

  it("surfaces the snapshot timestamp", () => {
    expect(analytics).toContain("formatDateTime(analytics.generatedAt)")
  })
})

describe("shared vocabularies are imported, not redeclared", () => {
  it("keeps the shared label maps", () => {
    expect(analytics).toContain('from "@/lib/student-outcome-view"')
    expect(analytics).toContain("OUTCOME_LABEL")
    expect(analytics).toContain("ARREAR_REASON_LABEL")
    expect(analytics).toContain('from "@/lib/grading/policy-view"')
    expect(analytics).toContain("catStatusLabel")
    expect(analytics).not.toMatch(/const\s+CAT_STATUS_LABEL/)
    expect(analytics).not.toMatch(/const\s+VERDICT_LABEL/)
  })
})
