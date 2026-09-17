# Audit findings — report convention

This directory is the source of truth for the in-flight audit. Each audit group writes one
Markdown file here; `npm run audit:dashboard` parses all four and regenerates the
[progress dashboard](../../scripts/audit-dashboard/run.ts), so the owner has one live view of what
has been found and what is still outstanding.

The goal of the audit, from the owner, is **"make the application feel complete and working."**
Groups look for dead or dangling controls, missing write paths, broken flows, fabricated or missing
numbers, partial implementations, missing empty states, inconsistencies, unreachable UI, and
confidentiality leaks.

## Re-verification caveat — the harness wrote to the shared dev database

**Read the numbers below with this in mind.** The audit evidence in the four findings files was
collected by a harness that drove the **running app over real HTTP** against the shared **dev**
database (`assessment_ui`). Those runs _wrote_ fixtures: assessments, quiz attempts, test runs,
grades, submissions and calendar events. The database was then **re-seeded**
(`npm run prisma:seed:demo` plus `prisma:seed:courses`), which purges the audit's fixtures and
restores the seed's, and a seed bug was fixed at the same time: `TestRun.coverage` was seeded as
`100` where the contract is a `0..1` fraction, and both seeds now write `1`.

Consequences for reading the counts:

- **Reproducible.** Findings whose evidence rests on the seed itself — roster and enrollment counts,
  analytics aggregates, audit-log rows, the seeded quiz attempts, the seeded code task and run, the
  seeded group and peer evaluations, and the unscoped calendar holidays — were re-tested against the
  re-seeded database on 2026-09-17 and still reproduce. So were the analytics/grading-settings
  round-trips and a fresh Docker-less code submission (which still returned `200` with `success: true`
  and a `FAILED` run at `Coverage 0%` / `0ms`). Those rows carry a "Re-verified …" note in `evidence`.
- **Not reproducible (caveated).** Findings whose original evidence depended on rows the audit itself
  created — a draft submission, generated questions or test cases, a second team, a self-evaluation,
  a practice attempt, a similarity verdict, or review state the audit produced — cannot be reproduced
  on the repaired database. Those rows stay `status: open` and carry a factual "Caveat (re-verification
  …)" note naming the missing fixture and the unchanged code path. They are **not** downgraded or
  deleted: the absence of the fixture is not evidence the defect is gone.
- **Fixed.** The four coverage findings (`TN-10`, `TN-34`, `SN-14`, `SN-31`) were resolved by the seed
  repair and are marked `fixed`; the pages now render `100%`, not `5000%` / `10000%`.

The `AUDIT-` title namespace swept by `prisma/seed-demo.ts` (`AUDIT_PROBE_TITLE_PREFIXES`) exists
because the harness's probe assessments left orphaned, unscoped calendar events visible to every
student; the seed now removes them.

One convention note: the "a duplicate keeps `status: open`" rule below describes discovery, not
remediation. When a canonical row is fixed, its linked duplicate is fixed too (`TN-10` / `TN-34`,
`SN-14` / `SN-31`).

## Files

| File                   | Domain  | Kind      | Agents | Scope            |
| ---------------------- | ------- | --------- | ------ | ---------------- |
| `teacher-native.md`    | teacher | native    | 5      | all `/teacher/*` |
| `teacher-langchain.md` | teacher | langchain | 5      | all `/teacher/*` |
| `student-native.md`    | student | native    | 5      | all `/student/*` |
| `student-langchain.md` | student | langchain | 5      | all `/student/*` |

The dotted pair per domain exists so the two kinds can be compared: did the independently-driven
LangChain agents surface something the native agents missed, or the other way round.

**The four files are the only required ones.** Any other `.md` file here (this README, for example)
is ignored by the aggregator. A _missing_ one of the four is an error, never a skipped group.

## File format

Every group file has exactly two `##` sections, in this order: `## Group` then `## Findings`.
Each section contains exactly one Markdown table. Fixed columns are the whole point — the parser
reads positionally, so a reordered or renamed column is a hard failure, not a guess.

A file that has not been touched yet keeps `status: not-started`, `agentsReported: 0`, and the
findings table with its header row only. That empty table is deliberate: it is how the dashboard
can be verified before any group has run, and it is why "no findings" and "has not run" can be
told apart.

### `## Group`

| Field            | Required | Allowed values                                                         |
| ---------------- | -------- | ---------------------------------------------------------------------- |
| `group`          | yes      | The file's own group id (`teacher-native`, `student-langchain`, …)     |
| `domain`         | yes      | `teacher`, `student`                                                   |
| `kind`           | yes      | `native`, `langchain`                                                  |
| `status`         | yes      | `not-started`, `running`, `reported`, `failed`                         |
| `agents`         | yes      | Integer ≥ 0 (the group has 5)                                          |
| `agentsReported` | yes      | Integer ≥ 0, ≤ `agents` — how many of the 5 agents have filed findings |

The group updates `status` and `agentsReported` as it progresses. `status: reported` with
`agentsReported < agents` is legitimate and worth looking at: it means some agents produced
nothing, which is itself a coverage fact the dashboard surfaces. A contradiction is an error —
`not-started` with a non-zero `agentsReported`, or with any finding row, fails the run.

### `## Findings`

| Column     | Required | Notes                                                                                                |
| ---------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `id`       | yes      | Unique within the file, e.g. `TN-1`. Used for `dupOf` and for talking about a finding                |
| `agent`    | yes      | Which of the group's five agents filed it, e.g. `teacher-grading`                                    |
| `severity` | yes      | `blocker`, `major`, `minor`                                                                          |
| `category` | yes      | One of the nine categories below — no free text                                                      |
| `title`    | yes      | One line, specific, names the surface                                                                |
| `evidence` | yes      | What was observed: URL, request, status, text                                                        |
| `location` | yes      | Route (`/teacher/classes`) or `file:line`                                                            |
| `status`   | yes      | `open`, `fixed`, `wontfix` — so remediation is tracked, not just discovery                           |
| `dupOf`    | no       | The `id` of another finding this one duplicates: same group, or the sibling group of the same domain |

Two independent groups can file the same defect twice, so a row may point at another row in
**the same file** when a reviewer has read both and judged them the same. It may also point at a row
in the **sibling group** of the same domain (the `native`/`langchain` pair), which forces that pair
in the comparison regardless of the match key. Either way the row with the lower `id` is canonical
and leaves `dupOf` empty; every later duplicate points at it and keeps `status: open`. A `dupOf` that
names no finding in either file, or that names the row itself, is a parse error.

Raw and distinct counts are both reported. A group's `findings` count is every row filed; its
`distinct` count removes rows that `dupOf` links to another row in the same group. The dashboard, the
aggregator JSON and the CLI all show both, so "69 rows (65 distinct, 4 linked duplicates)" is never
flattened into one number.

Severity follows this project's existing scale (`docs/quality/a11y-perf-audit.md`): a **blocker**
means the surface cannot be used at all (error, crash, data loss, unreachable page); **major** means
usable but visibly broken or misleading; **minor** is polish. Categories are the owner's list,
made controlled so that per-category counts mean the same thing in every group:

| Category                 | What it covers                                                         |
| ------------------------ | ---------------------------------------------------------------------- |
| `broken-flow`            | Error page, submit that does nothing, state lost on refresh, 500       |
| `dead-control`           | A control that looks functional and is not                             |
| `missing-write-path`     | State that should be editable and has no way to be written             |
| `fabricated-number`      | A rendered figure nothing derives, or `0` where the truth is "no data" |
| `partial-implementation` | A feature that stops half-way and says nothing about it                |
| `missing-empty-state`    | Blank region or unresolving spinner where absence needs explaining     |
| `inconsistency`          | Two surfaces disagree about the same value or label                    |
| `unreachable-ui`         | A screen or action with no route to it                                 |
| `confidentiality-leak`   | Data disclosed to the wrong role (answer keys, other students' work)   |

### Escaping

Cell text is Markdown. A literal pipe inside a cell must be written `\|` (for example a shell
`a \| b`, or `Draft \| Published`). Backticks around code are fine and are preserved as written.
A cell cannot contain a line break: keep evidence on one line and use `\|` where needed. Prettier
pads table columns freely — padding is stripped by the parser.

## What the aggregator does with it

`npm run audit:dashboard` reads the four files, validates every table, then writes:

- `docs/audit/aggregate.json` — the consolidated, machine-readable result (per-group raw and
  distinct finding counts, counts by severity, category and status; totals; the native-vs-LangChain
  comparison), and
- the data block inside `audit-dashboard.canvas.tsx`, the dashboard the owner opens beside chat.

**It fails loudly.** A missing file, a renamed column, a row with the wrong number of cells, an
unknown category or severity, a duplicate `id`, a `dupOf` that points at nothing, or a
`not-started` group that already has findings all stop the run with the file, the table and the
line number. All four files are validated before the run aborts, so every problem is reported in
one pass. The dashboard never drops a row it cannot read: under-reporting silently would be worse
than the error.

### How "unique to one kind" is computed

The comparison is the reason two kinds were run, so the rule is explicit rather than implied.

Each finding gets a match key of `category + location`, normalized as far as is mechanically
defensible: line numbers are stripped, a leading route and the `app/(dashboard)/…/page.tsx` file
that serves it are folded onto the same route (`/teacher/classes` and
`app/(dashboard)/teacher/classes/page.tsx:12` are the same key), and case, backticks and whitespace
are ignored. A component or `lib/` path is left as a file, because mapping it to the route(s) that
render it needs a router and an import graph, and guessing wrong would merge unrelated findings.
Within a domain, findings whose key appears in **both** the native and the LangChain file are
reported as found by both; the rest are reported as unique to their kind. Rows linked as same-group
duplicates do not participate: only the canonical row can be paired or counted unique.

This key is deliberately coarse and it is a heuristic, not identity:

- two genuinely different defects on the same route in the same category will be paired as one, and
- the same defect described with a different location or category will be counted as two.

`dupOf` is the escape hatch: when a reviewer can see that two findings are the same defect, setting
`dupOf` on one forces the pair regardless of the key — an explicit link naming a row in the sibling
group becomes a declared pairing, and a link naming a row in the same group removes the duplicate
from the comparison. Read the paired titles rather than trusting the counts alone — the dashboard
shows both.

That is not a theoretical caveat. On the first populated data (39 findings, three of four groups
reported) the key paired **nothing**: the native groups mostly cite `file:line` and the LangChain
groups mostly cite a route, so the same defect landed on two different keys, and every finding was
reported as unique to its kind. The route/page-file folding above closes the part of that gap that
can be closed mechanically; a defect cited only by component file on one side and only by route on
the other still cannot be paired without naming the component's routes, and that is left unpaired
rather than guessed. The dashboard says so explicitly rather than presenting "30 unique
native vs 6 unique LangChain" as agreement or disagreement it cannot establish. Reviewers who can
see a genuine duplicate should link it with `dupOf`.
