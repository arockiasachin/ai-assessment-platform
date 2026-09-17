# Accessibility & Performance Audit — Phase 3

Scope: the interactive surfaces added in Phase 2 (teacher/student dashboards, review queue,
quiz runner, groups/peer evaluation, code tasks, LMS export, analytics) plus the shared
`components/ui/**` primitives and `app/globals.css` tokens.

Method: static review of every Phase 2 component and its server/API counterpart, plus computed
WCAG 2.1 contrast ratios from the `oklch()` tokens (sRGB conversion + relative-luminance
formula). No new tooling was added; the repo has no axe/Lighthouse dependency and none was
installed.

Legend — **severity**: High = blocks a core flow for keyboard/AT users or a clear AA failure on a
primary surface; Medium = real but narrower; Low = polish. **status**: fixed in this pass (merged
to `dev` in `ebeaa1a`), or deferred with rationale.

## Findings

| #   | Area                          | Severity | Evidence (file)                                                                                                                                                                                                                                                                                                                    | Why it is wrong                                                                                                                                                                                                       | Fix                                                                                                                                               | Status   |
| --- | ----------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| A1  | Charts / text alternative     | High     | `components/charts.tsx` (all three charts)                                                                                                                                                                                                                                                                                         | Charts rendered as bare recharts SVG with no `<title>`/`<desc>`, so AT announced an unnamed graphic.                                                                                                                  | Added `title` + a data-summarising `desc` to `ClassAverageChart`, `GradeDistributionChart`, `TrendChart`.                                         | fixed    |
| A2  | Grade badge contrast (light)  | High     | `components/grade-badge.tsx:15`                                                                                                                                                                                                                                                                                                    | `text-success` on `bg-success/15` = **2.87:1**; `text-warning` on `/18` = **2.23:1**; `text-destructive` on `/12` = **3.96:1** — all below 4.5:1 for 12px text. Also `opacity-60` dropped the letter grade to ~2.8:1. | Explicit darker shades for band text (`emerald-800` 5.7:1, `amber-800` 5.3:1, `red-700` 4.7:1) with a dark-mode shade; removed `opacity-60`.      | fixed    |
| A3  | Destructive text on tint      | Medium   | `app/globals.css` (`:root --destructive`), consumed by `components/ui/badge.tsx:15`, `components/ui/button.tsx:19`, every error banner                                                                                                                                                                                             | `text-destructive` on `bg-destructive/10` = **4.09:1** (light), below 4.5:1.                                                                                                                                          | Darkened the light token `oklch(0.58 0.22 25)` to `oklch(0.52 0.22 25)`: now 5.0:1 on `/10`, 4.54:1 on `/15`, 6.0:1 for white-on-solid.           | fixed    |
| A4  | Placeholder-only inputs       | High     | `components/teacher-submissions-manager.tsx:329/340`, `student-assessments-view.tsx:419`, `student-code-submissions.tsx:153`, `student-peer-evaluation.tsx:235`, `student-courses-view.tsx:325`, `teacher-groups-manager.tsx:375`, `teacher-quiz-generator.tsx:229/251`, `teacher-view.tsx:192`, `teacher-classes-manager.tsx:220` | Placeholder text is not an accessible name; screen readers announced unlabeled fields, and repeated rows (per-student score/feedback, per-teammate comment) were indistinguishable.                                   | Added contextual `aria-label`s (e.g. `Score for {student} on {assessment}`) or an associated `<Label>`.                                           | fixed    |
| A5  | Select triggers unlabeled     | High     | `add-assessment-dialog.tsx:88/103`, `student-assessments-view.tsx:291/302/321`, `teacher-submissions-manager.tsx:251`, `teacher-view.tsx:199`, `student-view.tsx:128/138`, `teacher-groups-manager.tsx:343`, `teacher-analytics-dashboard.tsx:170`, `student-adaptive-retake.tsx:90/106`, `teacher-assignments-manager.tsx:227`    | The trigger's accessible name fell back to the selected option ("All types", "All courses"), never the filter it controls.                                                                                            | Added `aria-label` / `id` + `<Label htmlFor>` on every select trigger.                                                                            | fixed    |
| A6  | Quiz answer selection state   | Medium   | `components/quiz-runner.tsx:253`                                                                                                                                                                                                                                                                                                   | Selected option was conveyed only by border/background colour; AT could not tell which option was chosen.                                                                                                             | Added `aria-pressed={active}` to each option button; `Progress` gained `aria-label="Quiz progress"`.                                              | fixed    |
| A7  | Calendar day buttons          | Medium   | `components/upcoming-events-panel.tsx:163`                                                                                                                                                                                                                                                                                         | Each day button's name was just the day number ("15"); month, event count and selected state were unavailable.                                                                                                        | Added a full-date + event-count `aria-label` and `aria-pressed={isSelected}`.                                                                     | fixed    |
| A8  | Collapsed nav accessible name | Medium   | `components/role-routes-menu.tsx:99`                                                                                                                                                                                                                                                                                               | When collapsed, route links rendered icon-only and relied on `title`; `title` is not a reliable accessible name.                                                                                                      | Added `aria-label={item.label}` and `aria-current="page"` on the active route.                                                                    | fixed    |
| A9  | Disclosure state not exposed  | Medium   | `components/student-assessments-view.tsx:341`                                                                                                                                                                                                                                                                                      | The expandable assessment row toggled content with no `aria-expanded`.                                                                                                                                                | Added `aria-expanded={isExpanded}`.                                                                                                               | fixed    |
| A10 | Heading order                 | Low      | `components/upcoming-events-panel.tsx:195`                                                                                                                                                                                                                                                                                         | Panel emitted an `<h4>` directly under the page `<h2>`, skipping a level (and appearing before the `<h3>` later in DOM order).                                                                                        | Changed to `<h3>`.                                                                                                                                | fixed    |
| A11 | Async state not announced     | Low      | review queue, quiz generator, submissions, rubric editor, assignments, groups, code tasks, peer evaluation                                                                                                                                                                                                                         | Success/error messages were plain `<p>`/`<div>`s, so dynamic updates were silent to AT.                                                                                                                               | Added `role="status"` for success and `role="alert"` for errors.                                                                                  | fixed    |
| A12 | Dark-mode chip contrast       | Medium   | `teacher-review-queue.tsx:30`, `student-assessments-view.tsx:70`, `teacher-submissions-manager.tsx:66`, `student-courses-view.tsx:29`                                                                                                                                                                                              | `text-emerald-700`/`amber-700`/`blue-700`/`slate-700` on a `/10` tint over the dark card = **2.4–3.3:1**. The app themes via `prefers-color-scheme`, so the `.dark`-scoped Tailwind `dark:` variant never activates.  | Added explicit `[@media(prefers-color-scheme:dark)]:text-*-400` shades (~5–8:1); verified the utilities are emitted in the built CSS.             | fixed    |
| A13 | Group options label           | Medium   | `components/teacher-quiz-generator.tsx:199`                                                                                                                                                                                                                                                                                        | The "Options — select the single correct answer" `<label>` had no control association, so the radio group was unnamed.                                                                                                | Made it `role="radiogroup"` + `aria-labelledby`; labelled option text/rationale inputs.                                                           | fixed    |
| P1  | Client fetch on mount         | High     | `components/gradebook-provider.tsx:95,115` (mounted in `app/layout.tsx:54`)                                                                                                                                                                                                                                                        | The `/teacher` and `/student` dashboards are Server Components but render "Loading gradebook…" until a client `useEffect` fetch resolves — a real request waterfall on the two highest-traffic pages.                 | Deferred. Requires threading server-fetched data into the root-layout provider (or moving it) — cross-cutting and merge-risky with parallel work. | deferred |
| P2  | Client fetch on mount         | Medium   | `student-assessments-view.tsx:120`, `teacher-submissions-manager.tsx:121`                                                                                                                                                                                                                                                          | Data is fetched after mount even though the wrapping pages are async Server Components that could pass `initialX` props.                                                                                              | Deferred. Same reason as P1: converting these large stateful views to server-seeded props is a non-trivial refactor.                              | deferred |
| P3  | Loading/error boundaries      | Medium   | `app/(dashboard)/` had no `loading.tsx` or `error.tsx`                                                                                                                                                                                                                                                                             | Navigating to a slow/erroring dashboard route blocked with no fallback and fell through to the framework error screen.                                                                                                | Added `app/(dashboard)/loading.tsx` (announced placeholder) and `app/(dashboard)/error.tsx` (retry button).                                       | fixed    |

## Resolved: token-level text contrast

**Fixed** by splitting the fill role from the text role, which is what made this a design decision
rather than a mechanical one. `--success` and `--warning` remain the vivid fills that charts, progress
bars and badges depend on; two new tokens carry text. See the table below for what was measured.

| Token                         | Usage                                                               | Light contrast               | Verdict |
| ----------------------------- | ------------------------------------------------------------------- | ---------------------------- | ------- |
| `--success` (`0.62 0.15 155`) | `text-success` on card (quiz-runner results), `bg-success/12` chips | 3.40:1 (white), 2.9:1 (tint) | fail    |
| `--warning` (`0.72 0.15 75`)  | `text-warning` on `bg-warning/15` (stat icons)                      | 2.54:1 (white), 2.2:1 (tint) | fail    |

**Why not simply darken the tokens.** Dropping `--success` to the lightness that clears AA as text
would re-tint every chart and progress bar in the app — the two roles genuinely pull in opposite
directions, so one token cannot serve both.

**The fix.** `--success-text` / `--warning-text` are declared in `app/globals.css` alongside the fills,
with the measurements recorded inline, and mapped through `@theme inline` so `text-success-text` is a
real utility. On the light theme they are the same hue and chroma at lower lightness; on the dark theme
they alias the fills, which are already legible there.

Contrast was **computed** (OKLCH → sRGB → WCAG relative luminance) rather than estimated, and checked
against the `/12`–`/15` tint the copy actually sits inside, since the tint is the harder case:

| Token                        | On card | On its tint | AA  |
| ---------------------------- | ------- | ----------- | --- |
| `--success-text` `0.50 …155` | 5.43:1  | 4.74:1      | ✅  |
| `--warning-text` `0.52 …75`  | 5.62:1  | 4.92:1      | ✅  |
| `--success` (dark theme)     | 7.05:1  | 5.01:1      | ✅  |
| `--warning` (dark theme)     | 8.70:1  | 5.87:1      | ✅  |

Re-measured from the **compiled** hex values as a cross-check (`#007840`, `#8e5e00`): 5.58:1 / 4.86:1
and 5.60:1 / 4.94:1. Both methods agree with margin.

## Checked and found acceptable

- **`Dialog` / `Select` / `Tabs` primitives** (`components/ui/dialog.tsx`, `select.tsx`,
  `tabs.tsx`): built on `@base-ui/react`, which provides focus trapping, `aria-modal`, Escape/arrow
  key handling and roving tabindex. `Dialog`'s close button carries `<span class="sr-only">Close</span>`.
  No custom focus management was added or needed.
- **`focus-visible` styling**: interactive primitives (`Button`, `SelectTrigger`, `TabsTrigger`,
  inputs, nav links) all declare `focus-visible:ring-*` / `focus-visible:border-*`. Keyboard focus is
  visible.
- **Table semantics**: `gradebook-table.tsx`, `teacher-analytics-dashboard.tsx`,
  `teacher-groups-manager.tsx` and `teacher-lms-export.tsx` use real `<table>/<thead>/<tbody>/<th>`;
  the gradebook's editable cell is a `<button>` with an accessible name from its badge text plus a
  labelled numeric input in edit mode.
- **ARIA validity**: no contradictory or invalid `aria-*` roles/states found; the `aria-label`s
  added above are on elements whose role permits them. `dashboard-header.tsx`'s
  `role="status" aria-label="Current view"` is valid.
- **Empty / loading states**: review queue, evaluation candidates, groups, milestones, peer
  evaluation, code tasks/runs, analytics and LMS export all render explicit empty copy. `QuizRunner`
  and both gradebook dashboards render a text loading state.
- **DB access patterns**: analytics, review queue, groups and LMS export batch related reads with
  `Promise.all` + `{ in: [...] }` filters and hydrate maps in memory; the review queue is
  `take: 200` and evaluation candidates `take: 300`. No N+1 query was found. Unbounded `findMany`s
  (gradebook, student assessments) are naturally bounded by a class/offering roster and were judged
  acceptable.
- **Charts keyboard access**: recharts 3.8 `accessibilityLayer` defaults to `true`
  (`node_modules/recharts/es6/context/accessibilityContext.js`), so the chart SVG is focusable and
  keyboard-navigable; the new `<title>`/`<desc>` supply the missing accessible name/description.
- **Reduced motion**: no custom animations beyond Tailwind `animate-spin` on loaders; no
  parallax/auto-playing motion to guard.

## Could not verify

- **Real assistive-technology behaviour** (VoiceOver/NVDA/JAWS) — no browser+AT available in this
  environment; findings are from code and computed contrast.
- **Full keyboard walkthrough of every flow** — base-ui primitives are trusted for focus behaviour;
  the app's own handlers were reviewed but not exercised end-to-end.
- **Rendered dark-mode pixels** — dark contrast was verified by computing WCAG ratios and by
  confirming the emitted `@media (prefers-color-scheme:dark)` utilities in the production CSS, not by
  screenshotting.
- **Bundle size / render profiling** — no analyzer is installed and no new dependency was permitted;
  the performance findings are structural (where data is fetched), not measured milliseconds.
- **Docker production smoke test** — the Docker socket is not reachable from the sandbox, so the app
  was not run in production mode; the Next.js production **build** was used instead.

## Needs a human decision

1. **Retune `--success` / `--warning` for text use** (see table above). Either darken the tokens
   (re-tints charts/progress) or migrate the handful of `text-success`/`text-warning` call sites to
   darker shades. This is a visual-design call.
2. **Server-render the dashboard gradebook** (P1/P2) — **resolved for the `(dashboard)` subtree.**
   `app/(dashboard)/layout.tsx` fetches the payload once and mounts a seeded `GradebookProvider`
   (`initialPayload` / `initialRole`), so the first render is already populated and the role is
   correct server-side. A nested provider was used rather than changing the root one, because
   `app/layout.tsx` cannot receive props from a page and `/quiz` plus the whole `/mockup` tree
   should keep their existing behaviour.

   Verified in the server HTML: `/student` now renders `Student view` (it rendered `Teacher view`
   before, since `role` defaulted to `"teacher"`) and carries the student's register number before
   hydration.

   **Resolved.** `TeacherSubmissionsManager` no longer fetches: it takes `listSubmissionsForTeacher`'s
   rows as a prop, threaded through `TeacherAssignmentsManager` from
   `app/(dashboard)/teacher/assignments/page.tsx`. It renders _inside_ another component rather than at
   a page root, which is why it needed a prop through two levels instead of the page-level
   `initialPayload` the other views took — and why it was deferred while its sibling was converted.

   Verified in the server HTML: the page previously contained "Loading submissions…" and now contains
   the rows (`DEMO-0001` appears in the markup). The `react-hooks/set-state-in-effect` warning that
   effect produced is gone too, so the lint baseline dropped from 4 warnings to 3.

   Two things went with it, both recorded rather than silent: the rows are read from **props** rather
   than copied into state, so a `router.refresh()` after a save updates the view without an effect
   syncing props into state; and the `GET` handler on `/api/teacher/assessments/submissions` is
   **deleted** — it was the only other projection of these rows, and having two was the defect. The
   editor's behaviour is unchanged: a score still shows only when it has been released.

   **This paragraph previously also named `StudentAssessmentsView`, and that was stale.** It was
   converted during the Wave 1 port: `app/(dashboard)/student/assessments/page.tsx` server-fetches and
   passes `initialPayload`. Corrected here because a "still outstanding" list that overstates its
   remainder is how a fixed item stays fixed in the reader's mind and never gets re-checked.
