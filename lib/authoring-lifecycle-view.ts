import type { StatusKey } from "@/components/ui/status-pill"
import { formatDateTime } from "@/lib/format"

/**
 * One presentation vocabulary for "is this authored item live, and can the teacher still
 * change it?" (TL-1).
 *
 * The four authoring surfaces each own their publish machinery, and **none of them gets a new
 * status column here**. The native fact per surface is:
 *
 * | Surface          | Native fact                                                        |
 * | ---------------- | ------------------------------------------------------------------ |
 * | assignments      | `Assessment.releasedAt` — released to students (there is no unrelease route) |
 * | quiz-generation  | `Question.status` — `draft` / `published`                          |
 * | code-tasks       | `CodeTask.metadata.draftTestCaseIds` — `draft` / `active`          |
 * | rubrics          | no publish flag at all — a rubric is editable until a grade is published against it (the `TN-44` freeze) |
 *
 * Those facts are not interchangeable, so this module does **not** flatten them into one
 * boolean. It maps each onto a shared set of stages and the shared `StatusPill` tone, so the
 * same badge in the same place says the same kind of thing on every surface, while the label
 * keeps the engine's own word where that word is authoritative — "Released" is not
 * "Published" (the mislabelling `TN-68` fixed for the retention clock), and a rubric is
 * "Frozen", not "unpublished".
 *
 * The rubrics row is the honest answer to "what if the engine has no publish concept": it has
 * none, so the surface states the freeze instead of inventing a flag.
 *
 * This lives here rather than in the four client components because the repo has no jsdom, so
 * anything left inside a component has no test — and the stage mapping is exactly what needs
 * pinning.
 */

export type AuthoringLifecycleStage =
  /** Nothing has been authored yet. */
  | "empty"
  /** Authored, but nothing is live: students cannot see or use any of it. */
  | "draft"
  /** Some units are live and some are still drafts. */
  | "partly-live"
  /** Everything authored is live. */
  | "live"
  /** Live and immutable — a rubric a published grade was produced against. */
  | "frozen"

export type AuthoringLifecycleView = {
  stage: AuthoringLifecycleStage
  /** The shared `StatusPill` key, derived from the stage so tone cannot drift per surface. */
  status: StatusKey
  /** The pill text. Engine-native wording where the engine owns the word. */
  label: string
  /** One sentence saying what the stage means for students, and what the teacher can do. */
  detail: string
}

/**
 * The stage-to-tone mapping is the one thing every surface shares, so it is defined once.
 * `empty` uses the dashed `insufficient-data` tone rather than `draft`, so "nothing authored"
 * cannot be mistaken for "a draft is waiting".
 */
export const AUTHORING_STAGE_STATUS: Record<AuthoringLifecycleStage, StatusKey> = {
  empty: "insufficient-data",
  draft: "draft",
  "partly-live": "pending",
  live: "published",
  frozen: "archived",
}

function view(
  stage: AuthoringLifecycleStage,
  label: string,
  detail: string,
): AuthoringLifecycleView {
  return { stage, status: AUTHORING_STAGE_STATUS[stage], label, detail }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

/**
 * Assignments: the assessment's own publish fact is `releasedAt`.
 *
 * The strings are the ones `lib/assessment-release-view.ts` has always rendered, so the
 * release control's existing tests keep pinning the same rule; this module is now their one
 * definition.
 */
export function assessmentReleaseLifecycle(state: {
  released: boolean
  releasedAt: string | null
}): AuthoringLifecycleView {
  if (state.released) {
    return view(
      "live",
      "Released",
      state.releasedAt === null
        ? "Visible to students"
        : `Visible to students since ${formatDateTime(state.releasedAt)}`,
    )
  }
  return view("draft", "Not released", "Hidden from students")
}

/**
 * Quiz generation: the assessment's questions each carry `draft` / `published`.
 *
 * A quiz is deliverable once at least one question is published, but a set with drafts left
 * behind is neither "draft" nor "finished", so it gets its own stage rather than being
 * silently rounded to one of them.
 */
export function questionSetLifecycle(counts: {
  draftCount: number
  publishedCount: number
}): AuthoringLifecycleView {
  const total = counts.draftCount + counts.publishedCount
  if (total === 0) {
    return view(
      "empty",
      "Not authored",
      "No questions have been generated for this assessment yet.",
    )
  }
  if (counts.publishedCount === 0) {
    return view(
      "draft",
      "Draft",
      `${plural(counts.draftCount, "question")} drafted, none published — students cannot receive them yet.`,
    )
  }
  if (counts.draftCount === 0) {
    return view("live", "Published", `All ${plural(counts.publishedCount, "question")} published.`)
  }
  return view(
    "partly-live",
    "Partly published",
    `${counts.publishedCount} of ${total} published; ${plural(counts.draftCount, "draft")} still draft.`,
  )
}

/**
 * Code tasks: generated test cases are drafts until published; a hand-authored case is
 * active immediately.
 *
 * "Published" is the set-level word the engine's own route uses (`publish-tests`), while the
 * per-row pill keeps the engine's per-case word ("Active"). Drafts are never run and never
 * shown, so a set with only drafts is not deliverable.
 */
export function testCaseSetLifecycle(counts: {
  draftCount: number
  activeCount: number
}): AuthoringLifecycleView {
  const total = counts.draftCount + counts.activeCount
  if (total === 0) {
    return view("empty", "Not authored", "No test cases yet — students cannot submit this task.")
  }
  if (counts.activeCount === 0) {
    return view(
      "draft",
      "Draft",
      `${plural(counts.draftCount, "generated test case")} drafted, none published — drafts are never run or shown.`,
    )
  }
  if (counts.draftCount === 0) {
    return view("live", "Active", `All ${plural(counts.activeCount, "test case")} active.`)
  }
  return view(
    "partly-live",
    "Partly published",
    `${counts.activeCount} of ${total} active; ${plural(counts.draftCount, "draft")} still draft.`,
  )
}

/**
 * Rubrics: **no publish flag exists**, by design.
 *
 * A rubric is the binding grading contract the moment it is saved, and it stops being
 * editable once a grade has been published at or after its creation (`TN-44`). Inventing a
 * draft/published flag here would let a teacher "publish" a contract that grading does not
 * gate on, so the surface states the two real facts instead: authored-and-editable, or
 * frozen.
 */
export function rubricLifecycle(state: {
  hasRubric: boolean
  locked: boolean
}): AuthoringLifecycleView {
  if (!state.hasRubric) {
    return view(
      "empty",
      "Not authored",
      "No rubric yet — the model has no criteria to score against.",
    )
  }
  if (state.locked) {
    return view(
      "frozen",
      "Frozen",
      "A grade has been published against this rubric, so it can no longer be edited.",
    )
  }
  return view(
    "live",
    "Authored",
    "Saved and editable — it freezes once a grade is published against it.",
  )
}
