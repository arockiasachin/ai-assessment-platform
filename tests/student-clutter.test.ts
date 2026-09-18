import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

/**
 * The student clutter pass, pinned.
 *
 * Phase 6 moved static guidance behind `InfoHint` rather than deleting it, and
 * deleted the true filler outright. These tests read the component sources and
 * assert the three things a later edit could silently regress:
 *
 *  1. the deleted filler is gone (it was marketing copy and a footer explaining
 *     what the page already does);
 *  2. the surviving guidance is inside an `<InfoHint>` element, not visible
 *     prose a reader has to scroll past;
 *  3. blocked-state and save/error copy is still always visible — hiding that
 *     would make a blocked student think the page is broken.
 */

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..")

function read(relative: string): string {
  // Strip comments first: prose may legitimately *name* the copy that was
  // deleted (e.g. a comment saying the "View course" link was removed), and
  // these assertions are about what renders, not what is written about it.
  return fs
    .readFileSync(path.join(repoRoot, relative), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
}

/** Collapse source whitespace so a wrapped JSX sentence still matches. */
function flatten(source: string): string {
  return source.replace(/\s+/g, " ")
}

/** Every `<InfoHint …>…</InfoHint>` block in a source file. */
function hintsIn(source: string): string[] {
  return [...source.matchAll(/<InfoHint[\s\S]*?<\/InfoHint>/g)].map((match) => match[0])
}

function expectGuidanceInHint(relative: string, label: string, guidance: string) {
  const hints = hintsIn(read(relative))
  expect(
    hints.some(
      (hint) => flatten(hint).includes(flatten(label)) && flatten(hint).includes(flatten(guidance)),
    ),
    `${relative}: expected ${JSON.stringify(guidance)} inside the InfoHint labelled ${JSON.stringify(
      label,
    )}`,
  ).toBe(true)
}

describe("assessments hub: deleted filler stays deleted", () => {
  const source = read("components/student-assessments-view.tsx")

  it("removes the hero marketing badge, headline and subline", () => {
    expect(source).not.toContain("Assessment hub")
    expect(source).not.toContain("Track every assessment with full detail")
    expect(source).not.toContain("Inspect scores, due windows, feedback, and course context")
  })

  it("removes the three-box footer that explained the page to itself", () => {
    expect(source).not.toContain("Grading detail")
    expect(source).not.toContain("Status tracking")
    expect(source).not.toContain("Deadline visibility")
  })

  it("removes the duplicated per-card 'View course' link", () => {
    expect(source).not.toContain("View course")
  })

  it("keeps the hero's course chips as the entry to each course hub", () => {
    expect(source).toContain("Course hubs")
    expect(source).toContain('pathname: "/student/course"')
  })
})

describe("student guidance moved behind info hints", () => {
  it("collapses the assessments hub's grading-regime callouts", () => {
    const source = read("components/student-assessments-view.tsx")
    expect(source).not.toContain("Callout")
    expect(
      hintsIn(source).some((hint) => hint.includes("How each of your courses is graded")),
    ).toBe(true)
    // The per-course detail is still rendered, inside the hint.
    expect(source).toContain("regime.note.detail")
  })

  it("collapses the marks methodology line", () => {
    expectGuidanceInHint(
      "components/student-marks-view.tsx",
      "How the term average is calculated",
      "the mean of released marks only",
    )
  })

  it("collapses the grades methodology and not-judged explanation", () => {
    expectGuidanceInHint(
      "components/student-grades-view.tsx",
      "How the grand total and the verdict are decided",
      "counts the published marks only",
    )
  })

  it("collapses the course hub's average methodology", () => {
    expectGuidanceInHint(
      "app/(dashboard)/student/course/page.tsx",
      "How this course average is calculated",
      "counts released marks only",
    )
  })

  it("collapses the code editor's hidden-case and starter/run prose", () => {
    expectGuidanceInHint(
      "components/student-code-submissions.tsx",
      "Why hidden cases show only pass or fail",
      "their input and expected output are not returned",
    )
    expectGuidanceInHint(
      "components/student-code-submissions.tsx",
      "About the starter code and the submission budget",
      "The starter code is shown until you type over it",
    )
  })

  it("collapses the courses page anonymity and section lines", () => {
    expectGuidanceInHint(
      "components/student-courses-view.tsx",
      "Why course ratings stay anonymous",
      "classmate&apos;s name and comment are never shown",
    )
  })

  it("collapses the peer evaluation anonymity and section lines", () => {
    expectGuidanceInHint(
      "components/student-peer-evaluation.tsx",
      "Why these ratings are anonymous",
      "carries no rater identity",
    )
  })

  it("collapses the resources and events section lines", () => {
    expectGuidanceInHint(
      "components/student-resources-view.tsx",
      "What happens to material that is not indexed",
      "cannot be searched or used by the practice generator",
    )
    expectGuidanceInHint(
      "components/student-events-view.tsx",
      "Which events the Upcoming list shows",
      "have not been released to students are not listed",
    )
  })

  it("advertises every hint with a name that says what it explains", () => {
    // An icon-only trigger has no visible text, so the label is the only
    // accessible name. A generic "More information" would be a regression.
    const files = [
      "components/student-assessments-view.tsx",
      "components/student-marks-view.tsx",
      "components/student-grades-view.tsx",
      "components/student-code-submissions.tsx",
      "components/student-courses-view.tsx",
      "components/student-peer-evaluation.tsx",
      "components/student-resources-view.tsx",
      "components/student-events-view.tsx",
      "app/(dashboard)/student/course/page.tsx",
    ]
    for (const file of files) {
      for (const hint of hintsIn(read(file))) {
        const label = /label="([^"]+)"/.exec(hint)?.[1]
        expect(label, `${file}: every InfoHint needs a label`).toBeTruthy()
        expect(label!.toLowerCase(), `${file}: label must describe the hint`).not.toContain(
          "more information",
        )
        expect(label!.length, `${file}: label too short`).toBeGreaterThan(10)
      }
    }
  })
})

describe("blocked-state and feedback copy stays visible", () => {
  it("keeps assessment submission locks and FAT-gate refusals in the DOM", () => {
    const source = read("components/student-assessments-view.tsx")
    expect(source).toContain("submissionLockReason(assessment.submissionState)")
    expect(source).toContain("lockReason")
    expect(source).toContain("assessment.submissionBlockedReason")
  })

  it("keeps the code editor's blocked reason and save/error roles", () => {
    const source = read("components/student-code-submissions.tsx")
    expect(source).toContain("task.blockedReason")
    expect(source).toContain('role="alert"')
    expect(source).toContain('role="status"')
  })

  it("keeps the courses save/error feedback and the arrear acknowledgement", () => {
    const source = read("components/student-courses-view.tsx")
    expect(source).toContain('role="status"')
    expect(source).toContain('role="alert"')
    expect(source).toContain("Acknowledge &amp; register")
    expect(source).toContain("arrearReasonLabel(arrearNotice.arrear.reason)")
  })

  it("keeps empty states as empty states, not as hints", () => {
    // `description=` is not clutter by pattern: this one explains an empty list.
    expect(read("components/student-marks-view.tsx")).toContain(
      "A mark appears here the moment it is released",
    )
    expect(read("components/student-grades-view.tsx")).toContain("No completed courses yet")
    expect(read("components/student-events-view.tsx")).toContain("Nothing scheduled")
  })
})
