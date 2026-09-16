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
