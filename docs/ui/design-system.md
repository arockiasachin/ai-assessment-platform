# Assessment platform — UI design system & mockup conventions

This document is the contract for the UI rebuild. It covers the shell anatomy, the
primitive inventory, the spacing/typography/density rules, the status vocabulary,
dark-mode requirements, and — most importantly — **the exact convention the three
page-agents must follow**.

**Phase status.** The design was built as a static mockup tree, and this document
began as the contract for that phase. The mockups are now being wired to the real
backend, which supersedes two of the rules below **for any page that has been
ported**: the "never fetch" rule and the "do not touch `app/(dashboard)/**`" rule.
The wiring strategy is [`docs/plans/mockup-to-backend.md`](../plans/mockup-to-backend.md),
and the rule that replaces them is [`§8.3.1`](#831-wiring-a-real-page).

The **design** rules — anatomy, primitives, spacing, density, status vocabulary,
dark mode — apply to both trees unchanged. Only the mockup _page_ rules below are
phase-specific.

---

## 1. Why the old shell felt clunky

The rebuild fixes structural problems, not just colours:

| Old problem                                                                   | New answer                                                            |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Navigation was a cramped card in a right-hand column                          | Persistent **left rail** (`SideNav`) with grouped sections            |
| A dashed "Extendable menu / Add new pages here" box shipped in the product UI | **No developer scaffolding anywhere** in the shell                    |
| The header fetched `/api/auth/me` in a `useEffect`, flashing "Loading…"       | Chrome renders from props/fixtures: **no fetch, no effect, no flash** |
| Title nested in a card, then content in more cards                            | `PageHeader` sits on the background; content lives in `SectionCard`s  |
| Header `max-w-6xl`, main `max-w-7xl`                                          | One content width: `max-w-7xl`, provided by `AppShell`                |
| "Gradebook / Assessment & marks tracker"                                      | **Rubrix — AI-assisted assessment & feedback**                        |
| Three placeholder stub pages                                                  | Thirty-eight mockup routes, each documenting its own build guide      |

---

## 2. Shell anatomy

```
app/mockup/layout.tsx            server: pre-paint theme script + <AppShell>{children}</AppShell>
└─ components/shell/app-shell.tsx          "use client"
   ├─ skip link  →  #mockup-main
   ├─ <aside>    → components/shell/side-nav.tsx        rail, `md:` and up
   └─ column
      ├─ components/shell/top-bar.tsx       <header>, sticky
      │  ├─ components/shell/mobile-nav.tsx drawer trigger + slide-over (< md)
      │  ├─ components/shell/theme-toggle.tsx
      │  ├─ notifications popover
      │  └─ account popover (role + preview-role switcher)
      └─ <main id="mockup-main">  → page content
```

Files:

| File                                | Exports                                                                                                | Purpose                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `components/shell/app-shell.tsx`    | `AppShell`                                                                                             | Grid: rail + topbar + scrollable main. Derives the role from `/mockup/<role>` unless `role` is passed. |
| `components/shell/side-nav.tsx`     | `SideNav`                                                                                              | Grouped nav with `aria-current="page"`, icon rail below `lg`, `variant: "rail" \| "drawer"`.           |
| `components/shell/top-bar.tsx`      | `TopBar`                                                                                               | Brand, inert search, notifications, theme toggle, account menu.                                        |
| `components/shell/mobile-nav.tsx`   | `MobileNav`                                                                                            | Hamburger + left slide-over. Built on the shared `Dialog` for focus trap + Escape.                     |
| `components/shell/theme-toggle.tsx` | `ThemeToggle`, `themeInitScript`, `THEME_STORAGE_KEY`                                                  | Light/dark toggle and the pre-paint bootstrap script.                                                  |
| `components/shell/page-header.tsx`  | `PageHeader`, `Breadcrumbs`                                                                            | Breadcrumbs, `h1`, description, actions, optional tab row.                                             |
| `components/shell/nav-config.ts`    | `NAV_SECTIONS`, `ROLE_META`, `BRAND`, `roleFromPathname`, `isActiveHref`, `findNavItem`, `allNavItems` | Single source of truth for navigation, the mockup index, and role detection.                           |

**Landmarks**: one `<header>` (banner), one `<nav aria-label="Primary">`, one
`<main>`. The outline starts at `<h1>` on every page (`PageHeader`), and the
first `<h2>` a screen reader meets is the page's own first `SectionCard` title.
The side rail therefore uses **`<p>` for its group labels, not headings**: the
rail is the first thing in the document, so an `<h2>` there would land _before_
the page `<h1>` on every route and break the outline. Each nav list is still
named for assistive tech via `aria-labelledby`, so nothing is lost. The outline
is `h1 → h2 → h3`.

**Responsive behaviour**

| Width     | Rail                                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------------- |
| `< md`    | Hidden. `MobileNav` slide-over from the top bar.                                                                |
| `md`–`lg` | Icon-only rail (`w-16`), led by the brand mark. Labels stay in the DOM as `sr-only`; `title` gives the tooltip. |
| `≥ lg`    | Full rail (`w-64`), with the role label in the header; collapsible to `w-16` with the toggle.                   |

Below `lg` the role label is `sr-only` and the collapse toggle does not render,
so the rail's 56px header carries the brand mark instead of an empty band. It is
`aria-hidden` — the label still names the workspace for assistive tech.

The rail is a `sticky top-0 h-screen` flex column with its own `overflow-y-auto`,
so the page scrolls without moving the chrome and there is no layout shift.

**No-fetch rule.** `AppShell`/`TopBar`/`SideNav` render only from props and
static config. They must never import `fetch`, `useEffect`, or a data hook. This
is what removes the "Loading…" flash and the request waterfall.

**Theming.** `globals.css` ships both a `.dark` block and a
`prefers-color-scheme` block, but the Tailwind `dark:` variant is
`&:is(.dark *)`, so utility variants need a real `.dark` class. `themeInitScript`
(rendered inline in `app/mockup/layout.tsx`) materialises the system preference
into `.dark`/`.light` before first paint. Toggle with `ThemeToggle`. Do not edit
the tokens.

**Brand.** `BRAND` in `nav-config.ts`: wordmark **Rubrix**, tagline
**AI-assisted assessment & feedback**. One place to change.

---

## 3. Page structure (what a finished page looks like)

```
<PageHeader … />                        ← never wrap this in a card
<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">   ← KPI row (StatCard)
<FilterBar … />                         ← list pages only
<SectionCard …> … </SectionCard>        ← the one content frame
```

Rules:

1. **One frame.** `PageHeader` on the background; content inside `SectionCard`.
   Never a card inside a card inside a card.
2. **Width.** All pages render inside `max-w-7xl` (the shell provides it). Do not
   set your own page width.
3. **Spacing.** Vertical rhythm between top-level blocks is `space-y-6`; inside a
   `SectionCard` use `space-y-4`; grid gaps are `gap-4` (`gap-6` for two-up
   analytical layouts). Card padding comes from `--card-spacing` — do not add
   padding to a `SectionCard`.
4. **Density.** Default density is comfortable: `text-sm` body, 32px controls.
   Use `className="text-xs"` only for metadata (timestamps, IDs, hints).
5. **Numerals.** Numeric columns and big values use `font-mono tabular-nums` so
   digits line up between rows.
6. **Empty collections.** Always render `EmptyState` (inside the table body via
   `empty`, or inside a `SectionCard`). Never leave blank space.
7. **Nulls.** `null` means "no value yet" and renders as `—` (via `formatPercent`
   / `formatPoints`). It never renders as `0`. `insufficient-data` gets a
   `StatusPill`, not an invented number.

### Typography scale

| Use              | Classes                                                                |
| ---------------- | ---------------------------------------------------------------------- |
| Page title       | `text-2xl font-semibold tracking-tight` (in `PageHeader`)              |
| Section title    | `text-base font-medium` (in `SectionCard`)                             |
| Body             | `text-sm`                                                              |
| Metadata / hint  | `text-xs text-muted-foreground`                                        |
| Section overline | `text-xs font-semibold tracking-wider uppercase text-muted-foreground` |
| Metric value     | `font-mono text-2xl font-semibold tabular-nums` (`StatCard`)           |

---

## 4. Primitive inventory

All new primitives live in `components/ui/`. All are prop-driven and pure — **no
primitive fetches data or reads a fixture**.

| Primitive                     | Import                           | Purpose                                                                                                                          |
| ----------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `StatCard`                    | `@/components/ui/stat-card`      | Metric tile: label, value, hint, delta, icon, sparkline slot.                                                                    |
| `SectionCard`                 | `@/components/ui/section-card`   | The one content frame: optional `h2` title, description, header action, footer.                                                  |
| `DataTable`                   | `@/components/ui/data-table`     | Column-driven `<table>` with `<caption>`, `<th scope>`, sticky header, hover rows, integrated empty state, optional row actions. |
| `EmptyState`                  | `@/components/ui/empty-state`    | Standard "nothing here": icon, title, description, action, hint.                                                                 |
| `StatusPill` / `StatusDot`    | `@/components/ui/status-pill`    | Semantic status chip / bare tone dot (`StatusKey` union).                                                                        |
| `Callout`                     | `@/components/ui/callout`        | Toned notice panel ("read this before you trust the numbers"). `tone`, optional `icon`/`title`/`action`, `titleAs`, `role`.      |
| `TONE_PANEL` / `SUCCESS_TEXT` | `@/components/ui/tone`           | The audited tone→classes map. The only place a tinted panel's foreground is decided — never `text-*-foreground` on a tint.       |
| `MetricRow` / `KeyValueList`  | `@/components/ui/metric-row`     | Label–value line for a detail panel / `<dl>` for record metadata.                                                                |
| `PageTabs` / `PageTabPanel`   | `@/components/ui/page-tabs`      | Accessible in-page tab row (+ panel wrapper), owns narrow-width horizontal scrolling.                                            |
| `FilterBar`                   | `@/components/ui/filter-bar`     | Search + labelled selects + result count for list pages. `resultNounPlural` for multi-word nouns.                                |
| `ProgressBar`                 | `@/components/ui/progress-bar`   | Labelled progress with a semantic tone.                                                                                          |
| `CodeBlock`                   | `@/components/ui/code-block`     | Monospaced block for code and captured `stderr`; `wrap`, `dense`, `maxHeight`.                                                   |
| `TruncatedText`               | `@/components/ui/truncated-text` | Single-line ellipsis with `title` (and `width` presets) for long names and IDs, so one row cannot stretch a whole column.        |
| `Timeline`                    | `@/components/ui/timeline`       | Vertical milestone/audit list (`<ol>`).                                                                                          |
| `Sparkline`                   | `@/components/ui/sparkline`      | Compact trend shape for a `StatCard` slot.                                                                                       |
| `GradeDonut`                  | `@/components/ui/grade-donut`    | Donut split with a centre figure and a readable legend.                                                                          |

Reuse these base primitives rather than rebuilding them: `card`, `badge`,
`button`, `dialog`, `input`, `label`, `select`, `separator`, `table`, `tabs`,
`progress`, `avatar` (all in `components/ui/`). `recharts` is available; the
project's chart wrappers in `components/charts.tsx` (`ClassAverageChart`,
`GradeDistributionChart`, `TrendChart`) already carry screen-reader descriptions —
prefer them for the bigger charts.

> `components/stat-card.tsx` is the **legacy** tile used by the real pages. The
> mockups use `@/components/ui/stat-card`. Import path matters.

### `Select` needs its `items` prop to show a label

Base UI's `Select.Value` renders the **raw value** unless the `Select` root is
given the value→label map:

```tsx
<Select defaultValue={value} items={options}>
  <SelectTrigger>
    <SelectValue />
  </SelectTrigger>
  <SelectContent>{/* the same options */}</SelectContent>
</Select>
```

Without `items`, a filter trigger reads `below-floor` (or `asm_descriptive`)
instead of `Below 78%`. `FilterBar` passes `items` for every select it renders,
so list pages get this for free; hand-rolled selects on a page must do the same.

### Usage examples

```tsx
// StatCard — with a sparkline slot
<StatCard
  label="Cohort average"
  value="78%"
  hint="Published Quiz 1 only"
  delta={{ value: "+4 pts", direction: "up", sentiment: "positive" }}
  icon={BarChart3}
  sparkline={<Sparkline data={MOCK_SPARKLINES.cohort} label="Cohort average over 6 weeks" />}
/>
```

```tsx
// SectionCard — title + header action
<SectionCard
  title="Needs your attention"
  description="AI suggestions waiting on a human decision."
  action={<Link href="/mockup/teacher/reviews">Open queue</Link>}
>
  <DataTable … />
</SectionCard>
```

```tsx
// DataTable — columns + rows + empty state
const columns: Column<ReviewQueueItem>[] = [
  { id: "student", header: "Student", cell: (row) => row.studentName },
  { id: "state", header: "State", cell: (row) => <StatusPill status={reviewStateToStatus(row.state)} /> },
  { id: "confidence", header: "Confidence", align: "right", cell: (row) => formatConfidence(row.confidence) },
]

<DataTable
  caption="Review queue"
  columns={columns}
  rows={MOCK_REVIEW_QUEUE}
  getRowId={(row) => row.id}
  empty={<EmptyState title="Queue is clear" description="Every suggestion has been decided." />}
  rowActions={(row) => <Link href={`/mockup/teacher/reviews?student=${row.studentId}`}>Review</Link>}
/>
```

```tsx
// EmptyState
<EmptyState
  icon={Users}
  title="No peer evaluations yet"
  description="Nobody in this team has started the CATME round."
  action={<Button>Send reminder</Button>}
/>
```

---

## 5. Status vocabulary (`StatusPill`)

`StatusKey` is a string union in `components/ui/status-pill.tsx`. Colour never
carries meaning alone — the label is always rendered, and `dot` adds a second
cue.

The tint+foreground pairs those pills are built from live in
`components/ui/tone.ts` as `TONE_PANEL`, and `Callout` paints from the same map.
That file is the single place a toned panel's text colour is decided, and its
docblock records the two rules that keep the measured ratios true:

| Key                                       | Label                   | Tone                                | Typical use                                        |
| ----------------------------------------- | ----------------------- | ----------------------------------- | -------------------------------------------------- |
| `draft`                                   | Draft                   | neutral                             | Unpublished assessment, draft question             |
| `pending`                                 | Pending                 | warning                             | Awaiting review                                    |
| `published`                               | Published               | info                                | Released to students                               |
| `graded`                                  | Graded                  | success                             | Mark finalised                                     |
| `late`                                    | Late                    | danger                              | Submitted after the deadline                       |
| `flagged`                                 | Flagged                 | danger                              | Similarity / integrity flag                        |
| `insufficient-data`                       | Insufficient data       | outline (dashed)                    | Too few responses to analyse                       |
| `active`                                  | Active                  | info                                | Live group, healthy item                           |
| `completed`                               | Completed               | success                             | Finished milestone, successful export              |
| `needs-review`                            | Needs review            | warning                             | Low-confidence suggestion, bad item discrimination |
| `overridden`                              | Overridden              | info                                | Teacher changed an AI score                        |
| `rejected`                                | Rejected                | danger                              | Suggestion dismissed                               |
| `in-progress`                             | In progress             | info                                | Running assessment                                 |
| `submitted` / `resubmitted`               | Submitted / Resubmitted | info                                | Submission states                                  |
| `missed`                                  | Missed                  | danger                              | Milestone missed                                   |
| `archived`                                | Archived                | neutral                             | Past term                                          |
| `passed` / `failed` / `error` / `timeout` | …                       | success / danger / danger / warning | Test runs                                          |
| `queued` / `running`                      | Queued / Running        | neutral / info                      | Test runs                                          |
| `forming`                                 | Forming                 | neutral                             | Group not yet populated                            |

Mapping a domain enum to a status key is the page-agent's job — keep it in a
small local helper (e.g. `reviewStateToStatus`) rather than in the primitive.

### Contrast (measured, WCAG AA ≥ 4.5:1 for small text)

| Tone    | Light                                                    | Dark                                  |
| ------- | -------------------------------------------------------- | ------------------------------------- |
| neutral | `bg-muted` + `text-foreground` — 15.79:1                 | 13.44:1                               |
| info    | `bg-primary/10 text-primary` — 5.09:1                    | `bg-primary/12` — 5.01:1              |
| success | `bg-success/15` + `text-[oklch(0.45_0.12_155)]` — 5.86:1 | `bg-success/20 text-success` — 5.01:1 |
| warning | `bg-warning/15` + `text-warning-foreground` — 14.11:1    | `bg-warning/20 text-warning` — 5.87:1 |
| danger  | `bg-destructive/10 text-destructive` — 5.00:1            | `bg-destructive/12` — 4.88:1          |

The raw `--success` token only reaches **2.76:1** as small text on its own tint,
which is why the success pill uses a darker shade of the same hue. The tokens
themselves are unchanged.

---

## 6. Dark mode

- `.dark` is set on `<html>` before paint (see §2). Never read
  `matchMedia`/`localStorage` during render.
- Every tone above has a dark pair. When adding a colour, measure **both**
  themes; the previous audit failed a badge at 2.23:1, so do not eyeball it.
- Charts use `--chart-1..5`, which are redefined in `.dark`; use the variables,
  never literals.
- Focus rings: `focus-visible:ring-3 focus-visible:ring-ring/50`. They are
  visible in both themes — do not remove them.

---

## 7. Accessibility checklist

- Landmarks: one `<header>`, one `<nav aria-label="Primary">`, one `<main>`,
  plus `aria-label="Breadcrumb"` on the trail.
- `aria-current="page"` on the active nav item and the last breadcrumb.
- Every input has a `<Label>` (visually hidden is fine). Do not use placeholder
  text as the only label.
- Tables are `<table>` with `<caption>` and `<th scope="col">`.
- Icon-only buttons have an `aria-label`; decorative icons are `aria-hidden`.
- Charts are `aria-hidden` with a text alternative in the surrounding prose
  (`Sparkline` uses `role="img"` + `aria-label`; `GradeDonut` renders an
  `sr-only` summary).
- The active state is never colour-only (weight + left accent bar + label).
- Do not use `any`, `@ts-ignore`, or disable a lint rule.

---

## 8. The page-agent convention (follow literally)

### 8.1 File paths

| Role    | Route                    | File                                 |
| ------- | ------------------------ | ------------------------------------ |
| Teacher | `/mockup/teacher`        | `app/mockup/teacher/page.tsx`        |
| Teacher | `/mockup/teacher/<slug>` | `app/mockup/teacher/<slug>/page.tsx` |
| Student | `/mockup/student/<slug>` | `app/mockup/student/<slug>/page.tsx` |
| Admin   | `/mockup/admin/<slug>`   | `app/mockup/admin/<slug>/page.tsx`   |

Slugs are already created as stubs. **Replace the stub body**; keep the file
path, keep the `metadata` export, keep the `PageHeader`.

### 8.2 The stub you are replacing

```tsx
import type { Metadata } from "next"

import { StubPage } from "../../_components/stub-page"

export const metadata: Metadata = {
  title: "Reviews",
}

export default function TeacherReviewsPage() {
  return <StubPage href="/mockup/teacher/reviews" />
}
```

Open the page in the browser first: the stub renders its own **build guide**
(fixtures, primitives, section order, must-honour notes). That guide is the
authoritative brief for that page and is also in code at
`app/mockup/_lib/page-guide.ts`.

### 8.3 What a finished page looks like

```tsx
import type { Metadata } from "next"

import { PageHeader } from "@/components/shell/page-header"
import { DataTable, type Column } from "@/components/ui/data-table"
import { SectionCard } from "@/components/ui/section-card"
import { StatusPill } from "@/components/ui/status-pill"
import { MOCK_REVIEW_QUEUE, formatConfidence, type ReviewQueueItem } from "@/lib/mock"

export const metadata: Metadata = { title: "Reviews" }

export default function TeacherReviewsPage() {
  const columns: Column<ReviewQueueItem>[] = [/* … */]

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Mockup index", href: "/mockup" },
          { label: "Teacher workspace", href: "/mockup/teacher" },
          { label: "Reviews" },
        ]}
        title="Reviews"
        description={/* from the nav item description */ ""}
        actions={/* primary + secondary actions */}
      />
      <SectionCard title="Queue" description="…">
        <DataTable
          caption="Review queue"
          columns={columns}
          rows={MOCK_REVIEW_QUEUE}
          getRowId={(r) => r.id}
        />
      </SectionCard>
    </>
  )
}
```

Non-negotiable rules:

1. **Default to a Server Component.** Add `"use client"` only if the page has
   real local interaction that the primitives do not already provide (the
   primitives that need it — tabs, select, dialog — are already client).
2. **Never fetch** _(mockup pages; superseded once ported — see §8.3.1)_. No
   `fetch`, no `useEffect`, no route handlers, no Prisma. Import from `@/lib/mock`
   only.
3. **Name components `PascalCase` ending in `Page`**, derived from the route
   (`TeacherCodeTasksPage`). Local sub-components are `PascalCase` without the
   suffix and stay in the same file unless reused.
4. **Import primitives from `@/components/ui/<file>`** and shell pieces from
   `@/components/shell/<file>`. Do not import from `@/components/shell/index`
   in a Client Component.
5. **No new dependencies**, no `package.json` edits, no `prisma/**` edits.
6. **Do not touch** `app/(dashboard)/**`, `app/(auth)/**`, `components/role-*.tsx`,
   `components/dashboard-header.tsx`, `components/gradebook-*`, or any existing
   primitive in `components/ui/` _(mockup-page rule; superseded once ported — see
   §8.3.1)_.
7. **Delete the "Build guide" card** once the page is real. Keep the page header,
   breadcrumbs and description.
8. **Handle every fixture edge case** listed in the stub's "Must honour" block —
   `null` → `—`, empty list → `EmptyState`, unpublished vs published, long names,
   insufficient data.
9. **Dates**: use `formatDate`/`formatDateTime`/`formatDueLabel` from
   `@/lib/mock` (UTC, fixed `MOCK_NOW`). Never call `new Date()` in render.
10. **Verify**: `npm run verify` must stay at exit 0.

### 8.3.1 Wiring a real page

A page that has been ported to the real tree replaces rules 2 and 6 above with this
one rule:

> **Keep the data layer; adopt the presentation.** The page keeps its Server
> Component shape, its `requireRole`/`getSessionUser` guard, its existing query or
> `lib/*` service call, and its place under the `proxy.ts` matcher. It adopts the
> shell and the primitives, and maps real rows into the view models in
> `lib/mock/types.ts`.

Two invariants are load-bearing:

- **`null` means "no value yet" and renders as `—`, never `0`.** `Grade.percentage`
  is `Float?`, `QuizAttempt.score` is `Decimal?`, and item analysis deliberately
  withholds `difficultyIndex` below threshold. Defaulting nulls to zero breaks
  documented behaviour.
- **Do not add a client fetch for data the server already has.** The known P1
  finding is `GradebookProvider` fetching in a `useEffect`; a port is the moment to
  pass server-fetched props, not to add more client fetching.

**Shell scope.** `AppShell` takes a `scope`. `"mockup"` (the default) links to the
static routes and keeps the mockup-only chrome — preview-role switcher, mockup
index, notifications. `"app"` links to the authenticated routes, takes the signed-in
user from the server, and offers a real sign-out. The nav stays one definition
(`components/shell/nav-config.ts`), resolved per scope by `navHref`; items with no
real page carry a `null` target and are dropped from the app nav rather than
rendered as broken links. `tests/nav-scope.test.ts` asserts that every app-scope
href has a page on disk.

**Roles are advertised from `PREVIEW_ROLES`, not `MOCKUP_ROLES`.** `admin` is
deliberately excluded from `PREVIEW_ROLES`, so the preview-role switcher and the
mockup index never offer an admin workspace. Administrators are provisioned by
invitation — the register screen says so — and the real app already behaves that
way (`proxy.ts` redirects non-admins away from `/admin`, and the nav is
role-scoped, so a teacher never sees an admin link). The admin workspace stays
**reachable** rather than removed: by URL, and from a low-emphasis footer link on
the mockup index. That is the intended "hidden link" — findable by someone who
knows it is there, invisible to a casual reader. `MOCKUP_ROLES` keeps all three
roles because nav iteration and the active-href home set must know admin exists.
The distinction is asserted in `tests/nav-scope.test.ts`.

**Identity.** The `User` model (the signed-in account) has no name column, so an app-scope shell
shows the email and derives initials from it (`lib/user-identity.ts`). Do not invent a name for the
current user.

This limit applies **only to the signed-in account**. `StudentProfile.fullName` and
`StaffProfile.fullName` both exist, so rosters, submission lists and rating tables can render real
people's names. Do not assume a person's name is unavailable just because the shell shows an email.

### 8.4 Fixture modules

| Module                    | Covers                                                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/mock/types.ts`       | Every view model (`MockupRole`, `Student`, `Assessment`, `ReviewQueueItem`, `Group`, `TestRun`, `Kpi`, …)                                                                                                     |
| `lib/mock/format.ts`      | `formatPercent`, `formatPoints`, `formatConfidence`, `formatDate`, `formatDateTime`, `formatShortDate`, `formatRelativeTime`, `daysUntil`, `formatDueLabel`, `formatDuration`, `initialsFromName`, `MOCK_NOW` |
| `lib/mock/session.ts`     | `MOCK_CURRENT_USER` (per role), `MOCK_NOTIFICATIONS`                                                                                                                                                          |
| `lib/mock/course.ts`      | `MOCK_COURSE`, `MOCK_STUDENTS`, `MOCK_STUDENT_BY_ID`, `MOCK_MARKS`, `MOCK_ASSESSMENTS`, `MOCK_ASSESSMENT_BY_ID`, `MOCK_RUBRIC`, `MOCK_COHORT_AVERAGE`, `MOCK_DEMO_STUDENT`                                    |
| `lib/mock/quizzes.ts`     | `MOCK_QUIZ_QUESTIONS`, `MOCK_QUIZ_QUESTION_BY_ID`, `MOCK_DRAFT_QUESTIONS`, `MOCK_QUIZ_ATTEMPTS`, `MOCK_MY_QUIZ_ATTEMPTS`, `MOCK_MY_QUIZ_RESPONSES`, `MOCK_MY_QUIZ_RESPONSE_TOTAL`, `MOCK_ITEM_ANALYSIS`       |
| `lib/mock/submissions.ts` | `MOCK_SUBMISSIONS`, `MOCK_STUDENT_ASSESSMENTS`                                                                                                                                                                |
| `lib/mock/reviews.ts`     | `MOCK_GRADE_SUGGESTIONS`, `MOCK_REVIEW_QUEUE`, `MOCK_PENDING_REVIEWS`, `MOCK_REVIEW_SUMMARY`, `MOCK_GRADES`                                                                                                   |
| `lib/mock/groups.ts`      | `MOCK_GROUPS`, `MOCK_GROUP_BY_ID`, `MOCK_MY_PEER_EVALUATIONS`, `MOCK_UNASSIGNED_STUDENTS`                                                                                                                     |
| `lib/mock/code-tasks.ts`  | `MOCK_CODE_TASK`, `MOCK_TEST_CASES`, `MOCK_TEST_RUNS`, `MOCK_ACTIVE_RUNS`, `MOCK_FAILED_RUNS`, `MOCK_SIMILARITY`, `MOCK_CODE_TASK_SKELETON`                                                                   |
| `lib/mock/analytics.ts`   | `MOCK_GRADE_DISTRIBUTION`, `MOCK_SCORE_TREND`, `MOCK_TOPIC_MASTERY`, `MOCK_COURSE_RATINGS`, `MOCK_COURSE_RATING_AVERAGE`, `MOCK_AT_RISK_STUDENTS`, `MOCK_ANALYTICS_SUMMARY`                                   |
| `lib/mock/resources.ts`   | `MOCK_MATERIALS`, `MOCK_MATERIALS_SUMMARY`, `MOCK_RETAKE_RECOMMENDATIONS`                                                                                                                                     |
| `lib/mock/lms.ts`         | `MOCK_EXPORT_ROWS`, `MOCK_EXPORT_SUMMARY`, `MOCK_AUDIT_EVENTS`                                                                                                                                                |
| `lib/mock/admin.ts`       | `MOCK_ADMIN_USERS`, `MOCK_ADMIN_OFFERINGS`, `MOCK_ADMIN_DATASETS`, `MOCK_ADMIN_TOOLS`, `MOCK_FEATURE_FLAGS`, `MOCK_ADMIN_SUMMARY`                                                                             |
| `lib/mock/dashboards.ts`  | `MOCK_TEACHER_KPIS`, `MOCK_STUDENT_KPIS`, `MOCK_ADMIN_KPIS`, `MOCK_SPARKLINES`, `MOCK_CALENDAR_EVENTS`, `MOCK_UPCOMING_EVENTS`                                                                                |

Import everything from the barrel: `import { MOCK_REVIEW_QUEUE } from "@/lib/mock"`.

**Consistency guarantees already in the fixtures** (do not work around them):

- `MOCK_MARKS` is the single marks table; student averages, assessment means and
  the cohort average are derived from it. It holds **final** marks, so a grade a
  teacher changed is recorded as `source: "TEACHER_OVERRIDE"` with its reason
  rather than as arithmetic the marks table does not reflect.
- Every `GradeSuggestion.suggestedPoints` is ≤ its criterion's `maxPoints`.
- Weights in `MOCK_ASSESSMENTS` sum to 100%; rubric weights sum to 1.
- A dashboard tile is derived from the same list it summarises — e.g. the
  "Awaiting review" KPI counts `MOCK_PENDING_REVIEWS` and splits that same array
  for its hint, so the number and the words cannot describe different queues.
- A KPI whose unit is not obvious says which unit it is: the reviews tile counts
  **auto-accepted criteria**, because an item whose criteria all clear the floor
  stays in the queue and an item-level count would always be zero.
- Aggregates are `formatPercent`-ready: ratios stay 0..1 in the fixtures and are
  scaled once, in one place (`meanPercent` in `code-tasks.ts`), never twice.

### 8.5 Edge cases the mockups must exercise

| Case                     | Where it lives                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Empty list               | `Team Graphs.peerEvaluations: []`, `Team Scalars` (no members), `ABANDONED_ITEM.criteria: []`                        |
| Very long name           | `Alexandria Catherine Montgomery-Worthington` (`stu_alexandria`) — rendered through `TruncatedText`                  |
| Missing / absent value   | `stu_ravi` (`avgPercent: null`, `lastActiveAt: null`), `MOCK_ADMIN_USERS` "never signed in"                          |
| Unpublished vs published | `MOCK_GRADES` (`published: false` for descriptive + assignment)                                                      |
| Insufficient data        | `MOCK_ITEM_ANALYSIS` questions 5–6, `MOCK_TOPIC_MASTERY` "Inequalities", `MOCK_RETAKE_RECOMMENDATIONS`               |
| Failed / errored work    | `MOCK_TEST_RUNS` TIMEOUT + ERROR (with `stderr`)                                                                     |
| Never administered       | `MOCK_DRAFT_QUESTIONS` — a draft question has 0 responses and must not appear in a sitting or in any released result |

---

## 9. Adding a new mockup page

1. Add a `NavItem` to `NAV_SECTIONS[role]` in `components/shell/nav-config.ts`
   (label, href, icon, description).
2. Add a `PageGuide` for the href in `app/mockup/_lib/page-guide.ts`.
3. Create the stub page file that renders `<StubPage href="…" />`.
4. The mockup index picks it up automatically (`allNavItems()`), and the shell
   navigation does too — no other wiring.

## 10. Verifying

```bash
npm run verify                       # typecheck + lint + format:check
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:59999/ci" \
  SESSION_SECRET=x LLM_PROVIDER=mock npm run build
npm run dev                          # then browse http://localhost:3000/mockup
```

Browse with `localhost`, not `127.0.0.1` — Next blocks cross-origin dev chunks on
`127.0.0.1`, which would leave you looking at a non-interactive shell.
