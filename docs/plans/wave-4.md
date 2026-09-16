# Wave 4 — admin

The last wave before the decision list. Follows [Wave 3](./wave-3.md).

Admin is **structurally different** from the other three waves, and the difference changes the work:
there are no admin API routes, and the real admin pages read Prisma **directly in Server Components**
through `lib/admin-db.ts`. So a port here needs no routes, no contracts and no clients — it needs
readers and the shared shell.

---

## 1. Scope, and a third shell to retire

Five real admin pages exist and all five render through **`AdminPageShell`** — a bespoke third shell
that predates the design system:

| Real page         | `lib/admin-db.ts` reader       | State                       |
| ----------------- | ------------------------------ | --------------------------- |
| `admin` (index)   | `getAdminOverview`             | renders, with inline tables |
| `admin/data`      | `toPlainRows` + inline queries | renders                     |
| `admin/offerings` | `getAdminOfferingsList`        | renders                     |
| `admin/tools`     | `AdminToolsPanel`              | renders                     |
| `admin/users`     | `getAdminUsersList`            | renders                     |

`AdminPageShell` renders its own `<main>`, its own heading block and its own `AdminRoutesMenu`
sidebar. `AppShell` already supports `role="admin"` (`MockupRole` includes it), so replacing it is a
**deletion**, not a rewrite — one shell instead of three, and the admin nav comes from
`nav-config.ts` like every other role.

## 2. A real defect to fix on the way

Two admin pages format dates with an implicit locale, which is the hydration hazard this codebase
has already fixed three times (`chart.tsx`, `student-quiz-attempts`, `teacher/observability`):

- `app/(dashboard)/admin/users/page.tsx:35` — `new Date(user.createdAt).toLocaleString()`
- `app/(dashboard)/admin/page.tsx:144` — `new Date(assessment.dueDate).toLocaleDateString()`

Both read the _runtime's_ locale and time zone, so the server and the browser can disagree about the
same row. `lib/format.ts` already provides explicit-locale helpers; the fix is to use them. This is
the same class of bug as the one fixed in S9, and it is worth doing regardless of the shell work —
which is why it is its own slice rather than a footnote.

## 3. What the mockups ask for that has no model

`docs/plans/mockup-to-backend.md` §4 named these, and Wave 4 is where they come due. Each is a
**decision**, not a port:

| Mockup surface                               | Reality                                       | Verdict                                                                                                                                 |
| -------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `AdminDataset` (retention, rowCount, source) | no model                                      | **Read-only view over real tables**, not a new entity — the data explorer already does this                                             |
| `AdminTool` run history                      | no model                                      | **Drop the history**, keep the actions. A run log needs a model, and "which maintenance actions ran" is not a question anyone has asked |
| `FeatureFlag`                                | no model, and no settings surface exists      | **Drop**                                                                                                                                |
| Institution settings (`admin/settings`)      | no model, and `navHref` returns `null` for it | **Drop** — no real page, by the plan's own mapping                                                                                      |
| `admin/profile`                              | no model, `navHref` returns `null`            | **Drop**                                                                                                                                |

So Wave 4's mockup ports are **narrower than the mockups suggest**: three of the seven admin mockup
routes have no real page by design, and two of the remaining surfaces need a model that nothing has
asked for. What is left is real and worth doing — the shell, the readers, and the locale fix.

## 4. Slices

| Slice  | Content                                                                                                       | Depends on |
| ------ | ------------------------------------------------------------------------------------------------------------- | ---------- |
| **A1** | The two implicit-locale fixes, as a standalone defect fix                                                     | —          |
| **A2** | Retire `AdminPageShell`; the five pages onto `AppShell` + `PageHeader`                                        | —          |
| **A3** | `admin/users` and `admin/offerings` through the shared `DataTable` primitive, so they match every other table | A2         |
| **A4** | **No work needed — recorded, not forced.** See below                                                          | —          |
| **A5** | Record the four dropped mockup surfaces with their reasons                                                    | —          |

A1 comes first because it is a defect rather than a port, and it is small. A2 is the bulk of the
value: it removes a shell, which is the kind of duplication that produced the drift Wave 1 spent its
time fixing.

### A4: why two pages keep their own markup

`admin/page` renders **zero** tables — it is a card-and-list dashboard, so `DataTable` has nothing
to replace.

`AdminDatasetsView` does render a `<table>`, and it **should keep it.** Its columns are derived
from the data (`Record<string, unknown>` rows, headers taken from the keys), because a
schema-agnostic browser cannot know its columns at compile time. `DataTable` takes `Column<T>[]`
with fixed ids by design — that is what gives every other table a stable `getRowId` and responsive
column hiding — so it cannot express a dynamic column set. Converting would mean loosening
`DataTable` for one caller, which is the wrong direction: the constraint is load-bearing for nine
other pages.

Recorded rather than forced.

## 5. What this wave must not do

- **Invent a model to fill a mockup.** `FeatureFlag` and `AdminTool` history are dropped rather than
  built, for the same reason `completionPercent` was dropped in Wave 3: a table nothing writes is a
  table that lies.
- **Add admin API routes.** Admin reads Prisma in Server Components here, and that is deliberate —
  it is why this wave needs no contracts. Introducing routes for consistency would add a layer whose
  only purpose is symmetry.
- **Touch the two dev-tool route handlers** (`retention/purge`, offering rebalance). They work and
  are tested; a port must not replace them.

## 6. The close-out: the mock layer, the docs, and the last underived number

`A1`–`A4` finished the admin ports and `§3` recorded the dropped surfaces. What remained was the
**endgame** in `docs/plans/mockup-to-backend.md` §8 — the conditions under which the port is actually
finished. Landed in `e1a69ab`.

### The tree is kept, so the dependency had to be severed

§8 allowed deleting `/mockup` **or** keeping it as a tagged design reference. It is **kept**: its 38
routes each document their own build guide, which is design-process evidence worth retaining, and the
tree is operationally inert (outside `proxy.ts`, outside the real navigation).

That choice created the wave's last real problem. `lib/mock` was **load-bearing for the app**, so the
reference tree and the product were not separable:

| Dependency                                                    | What it actually was                                                                 | Resolution                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------ |
| 9 unions into `lib/labels.ts`                                 | value-identical duplicates of Prisma enums (`AssessmentType`, `SubmissionStatus`, …) | use the generated enums              |
| 2 unions into `lib/teacher-submissions.ts`                    | the same                                                                             | use the generated enums              |
| `MockupRole` into `components/shell/nav-config.ts`            | a navigation concept — it decides which nav sections exist                           | define it there                      |
| `MOCK_NOTIFICATIONS` / `MOCK_CURRENT_USER` into `top-bar.tsx` | fixture **values** in a shell component the real app renders                         | pass as props from the mockup layout |

The value-identity of all eleven unions was verified before the swap, because a mismatch would make a
label-map lookup return `undefined` and render a raw enum. The timestamp formatting moved to
`app/mockup/layout.tsx` too: `formatRelativeTime` is anchored to the mockup's fixed `MOCK_NOW`, so the
mock clock is the mockup's to apply and app scope must not inherit one.

`tests/mock-layer-scope.test.ts` enforces the result **at the source level**, since a helper test
cannot catch an import. It matches every way a module can reach another (static, `export … from`,
side-effect, dynamic `import()`, `require()`) and normalises alias and relative specifiers, so
`../../lib/mock` and `~/lib/mock` are caught while `@/lib/mockup-*` and `some-lib/mock` are not. It was
mutation-tested against all twelve forms: ten caught, two correctly ignored. It deliberately does
**not** strip comments — a line-based `//` strip truncates at the first `//` inside a string literal
(a URL), which would hide an import sharing that line.

### Five more components were already dead

Completing the shell migration left the pre-design-system shell unreferenced: `role-page-shell`,
`dashboard`, `dashboard-header`, `role-routes-menu`, `future-page-placeholder`. `dashboard-header` was
the source of the stale "Teacher view" label that `/teacher` no longer renders. All five deleted, and
the guard asserts they stay gone.

### The last underived number

An audit of all 29 app-scope routes found exactly one violation of §8's "no page renders a number
that nothing derives": `components/teacher-view.tsx` coerced a null assessment average to `0`
(`assessmentAverage(...) ?? 0`), so an assessment with **no published marks** drew a `0%` bar
indistinguishable from a cohort that genuinely averaged zero — and the chart's screen-reader
description announced it as "0%". `assessmentAverage` returns `null` deliberately (the null-vs-zero
rule documented in `lib/teacher-roster.ts`), and both sibling charts preserve that null, so this was
an outlier. Unmarked assessments are now omitted from the series.

### Paths not taken

- **Deleting `/mockup` outright.** Allowed by §8, and rejected by the owner — the per-route build
  guides are the design-process record.
- **Having `gradeBandRanges` accept `BandOptions`.** The parameter was read into an unused local, so
  it could not change the output: boundary inclusivity is a property of the _comparison_, not of the
  boundary list. Removed rather than implemented; `relativeLetter` / `absoluteLetter` keep it.
- **A stricter `timeZone` sweep.** Three app-scope formatters still call `toLocaleDateString` /
  `toLocaleString` with an explicit locale but no `timeZone`, which can render a different day west of
  UTC. Flagged by the audit as an adjacent hazard in the same family as the implicit-locale defects
  A1 fixed, **not** fixed here — it is a separate behaviour change and belongs with its own tests.
