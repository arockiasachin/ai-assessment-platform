/**
 * Self-test for the audit dashboard aggregator.
 *
 *   npm run audit:dashboard:selftest
 *
 * Everything runs against in-memory fixture text — no filesystem, no database,
 * no network — so the two checks that matter most (a malformed table fails
 * loudly, and the native-vs-LangChain comparison pairs what it should) are
 * repeatable without touching the real report files or corrupting them for the
 * concurrent audit groups. Exits non-zero on the first failed assertion set.
 */

import { Script } from "node:vm"

import { buildAggregate, normalizeLocation } from "./aggregate"
import { GROUPS, type GroupDefinition } from "./groups"
import {
  applyOutcome,
  createCoalescer,
  describeCoverage,
  initialLiveState,
  type Timer,
} from "./live"
import { AuditFormatError, parseGroupFile, validateDupOf, type ParsedGroup } from "./parse"
import { renderPage } from "./view"

let checks = 0
const failures: string[] = []

function check(condition: boolean, label: string): void {
  checks += 1
  if (!condition) failures.push(label)
}

function checkThrows(label: string, run: () => void, expected: string): void {
  checks += 1
  try {
    run()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!(error instanceof AuditFormatError)) {
      const name = error instanceof Error ? error.constructor.name : typeof error
      failures.push(`${label}: threw ${name}, not AuditFormatError`)
    } else if (!message.includes(expected)) {
      failures.push(`${label}: message "${message}" does not include "${expected}"`)
    }
    return
  }
  failures.push(`${label}: did not throw`)
}

function row(cells: string[]): string {
  return `| ${cells.join(" | ")} |`
}

function fileText(
  definition: GroupDefinition,
  options: { status: string; agentsReported: number; rows?: string[] },
): string {
  return [
    `# Audit group — ${definition.id}`,
    "",
    "## Group",
    "",
    "| field | value |",
    "| --- | --- |",
    row(["group", definition.id]),
    row(["domain", definition.domain]),
    row(["kind", definition.kind]),
    row(["status", options.status]),
    row(["agents", String(definition.agents)]),
    row(["agentsReported", String(options.agentsReported)]),
    "",
    "## Findings",
    "",
    row([
      "id",
      "agent",
      "severity",
      "category",
      "title",
      "evidence",
      "location",
      "status",
      "dupOf",
    ]),
    row(["---", "---", "---", "---", "---", "---", "---", "---", "---"]),
    ...(options.rows ?? []),
    "",
  ].join("\n")
}

function emptyTexts(): Record<string, string> {
  return Object.fromEntries(
    GROUPS.map((definition) => [
      definition.id,
      fileText(definition, { status: "not-started", agentsReported: 0 }),
    ]),
  )
}

function parseTexts(texts: Record<string, string>): ParsedGroup[] {
  return GROUPS.map((definition) =>
    parseGroupFile({
      filePath: `docs/audit/${definition.id}.md`,
      text: texts[definition.id],
      definition,
    }),
  )
}

function define(id: string): GroupDefinition {
  const definition = GROUPS.find((candidate) => candidate.id === id)
  if (!definition) throw new Error(`fixture references unknown group ${id}`)
  return definition
}

const GENERATED_AT = "2026-01-01T00:00:00.000Z"

// ---------------------------------------------------------------------------
// The empty state: four untouched files must aggregate without error and
// without implying a clean audit.
// ---------------------------------------------------------------------------

{
  const aggregate = buildAggregate(parseTexts(emptyTexts()), GENERATED_AT)
  check(aggregate.groups.length === 4, "empty: four groups")
  check(aggregate.totals.agents === 20, "empty: twenty agents")
  check(aggregate.totals.findings === 0, "empty: zero findings")
  check(aggregate.totals.groupsReported === 0, "empty: no group reported")
  check(
    aggregate.groups.every((group) => group.status === "not-started"),
    "empty: every group not-started",
  )
  check(aggregate.comparisons.length === 2, "empty: one comparison per domain")
  check(
    aggregate.comparisons.every(
      (comparison) =>
        comparison.uniqueToNative.length === 0 &&
        comparison.uniqueToLangchain.length === 0 &&
        comparison.shared.length === 0,
    ),
    "empty: empty comparison, not a clean result",
  )
}

// ---------------------------------------------------------------------------
// The comparison: a shared defect, and one unique finding on each side.
// ---------------------------------------------------------------------------

function teacherTexts(options: { withDupOf: boolean }): Record<string, string> {
  const texts = emptyTexts()
  const nativeRows = [
    row([
      "TN-1",
      "teacher-structure",
      "blocker",
      "dead-control",
      "Classes export button does nothing",
      "GET /teacher/classes: Export has no form action and no handler",
      "app/(dashboard)/teacher/classes/page.tsx:12",
      "open",
      "",
    ]),
    row([
      "TN-2",
      "teacher-overview",
      "minor",
      "inconsistency",
      "Dashboard count disagrees with the list",
      "tile says 12, list renders 9 rows",
      "/teacher",
      "fixed",
      "",
    ]),
  ]
  const langchainRows = [
    row([
      "TL-1",
      "langchain-structure",
      "major",
      "dead-control",
      "Export button on classes is inert",
      "fetched /teacher/classes, clicked Export, no request observed",
      "/teacher/classes",
      "open",
      "",
    ]),
    row([
      "TL-2",
      "langchain-overview",
      "blocker",
      "dead-control",
      "Analytics filter never applies",
      "changed the offering filter, the chart did not change",
      "/teacher/analytics",
      "open",
      "",
    ]),
  ]
  if (options.withDupOf) {
    nativeRows.push(
      row([
        "TN-3",
        "teacher-overview",
        "blocker",
        "dead-control",
        "Analytics filter is dead (same as TL-2)",
        "confirmed by hand after reading TL-2",
        "/teacher/analytics",
        "open",
        "TL-2",
      ]),
    )
  }
  texts["teacher-native"] = fileText(define("teacher-native"), {
    status: "reported",
    agentsReported: 5,
    rows: nativeRows,
  })
  texts["teacher-langchain"] = fileText(define("teacher-langchain"), {
    status: "reported",
    agentsReported: 4,
    rows: langchainRows,
  })
  return texts
}

{
  const aggregate = buildAggregate(parseTexts(teacherTexts({ withDupOf: false })), GENERATED_AT)
  const teacher = aggregate.comparisons.find((comparison) => comparison.domain === "teacher")
  check(teacher !== undefined, "compare: teacher comparison exists")
  if (teacher) {
    check(teacher.shared.length === 1, "compare: one shared defect paired on category+location")
    check(
      teacher.shared[0]?.native[0]?.id === "TN-1" && teacher.shared[0]?.langchain[0]?.id === "TL-1",
      "compare: shared pair is TN-1 with TL-1",
    )
    check(
      teacher.uniqueToNative.length === 1 && teacher.uniqueToNative[0]?.id === "TN-2",
      "compare: TN-2 is unique to native",
    )
    check(
      teacher.uniqueToLangchain.length === 1 && teacher.uniqueToLangchain[0]?.id === "TL-2",
      "compare: TL-2 is unique to LangChain",
    )
    check(
      teacher.delta.blocker === 0 && teacher.delta.major === -1 && teacher.delta.minor === 1,
      "compare: delta is native minus LangChain",
    )
    check(
      aggregate.totals.byStatus.open === 3 && aggregate.totals.byStatus.fixed === 1,
      "compare: status totals",
    )
    check(
      aggregate.totals.bySeverity.minor === 1 &&
        aggregate.totals.bySeverityOpen.minor === 0 &&
        aggregate.totals.bySeverityOpen.blocker === 2,
      "compare: severity keeps fixed rows, severity-open drops them (TN-2 is a fixed minor)",
    )
  }

  const student = aggregate.comparisons.find((comparison) => comparison.domain === "student")
  check(
    student !== undefined && student.native.total === 0 && student.langchain.total === 0,
    "compare: student is empty",
  )
}

{
  // The escape hatch: an explicit dupOf overrides the key, so a defect described
  // differently in each file still counts as found-by-both.
  const aggregate = buildAggregate(parseTexts(teacherTexts({ withDupOf: true })), GENERATED_AT)
  const teacher = aggregate.comparisons.find((comparison) => comparison.domain === "teacher")
  check(teacher?.shared.length === 2, "dupOf: adds a declared pair")
  check(
    teacher?.uniqueToLangchain.length === 0,
    "dupOf: TL-2 is no longer unique once TN-3 declares it",
  )
  check(
    teacher !== undefined && teacher.shared.some((entry) => entry.key === "declared TN-3 = TL-2"),
    "dupOf: shared key names the declared link",
  )
}

// ---------------------------------------------------------------------------
// Location normalization: a route and the page file that serves it are the
// same place, so a native `page.tsx` citation can pair with a LangChain route.
// ---------------------------------------------------------------------------

{
  check(
    normalizeLocation("app/(dashboard)/teacher/classes/page.tsx:12") === "/teacher/classes",
    "location: a page.tsx under app/(dashboard) folds onto its route",
  )
  check(
    normalizeLocation("/teacher/classes:12") === "/teacher/classes",
    "location: a route keeps its leading slash and loses the line suffix",
  )
  check(
    normalizeLocation("/teacher/analytics (offeringId x), components/a.tsx:2") ===
      "/teacher/analytics",
    "location: a leading route wins over a later component file",
  )
  check(
    normalizeLocation("components/teacher-dashboard.tsx:166-179") ===
      "components/teacher-dashboard.tsx",
    "location: a component file stays a file, line suffix stripped",
  )
  check(
    normalizeLocation("app/(dashboard)/page.tsx") === "/",
    "location: the dashboard root maps to /",
  )
  check(
    normalizeLocation("app/quiz/page.tsx") === "/quiz",
    "location: any app page.tsx maps to a route",
  )
}

// ---------------------------------------------------------------------------
// Malformed tables. Each of these must fail with a message that locates it.
// ---------------------------------------------------------------------------

const nativeDefinition = define("teacher-native")
const goodRow = row([
  "TN-1",
  "teacher-structure",
  "major",
  "dead-control",
  "Export is inert",
  "clicked it, nothing happened",
  "/teacher/classes",
  "open",
  "",
])
const goodNative = fileText(nativeDefinition, {
  status: "reported",
  agentsReported: 1,
  rows: [goodRow],
})

function parseNative(text: string): void {
  parseGroupFile({ filePath: "docs/audit/teacher-native.md", text, definition: nativeDefinition })
}

// `dupOf` is the only optional column, so an eight-cell row must parse.
try {
  parseNative(
    fileText(nativeDefinition, {
      status: "reported",
      agentsReported: 1,
      rows: [
        row([
          "TN-1",
          "teacher-structure",
          "major",
          "dead-control",
          "Export is inert",
          "clicked it",
          "/teacher/classes",
          "open",
        ]),
      ],
    }),
  )
  check(true, "well-formed: an eight-cell row omits dupOf and is accepted")
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  check(false, `well-formed: eight-cell row should be accepted, threw: ${message}`)
}

checkThrows(
  "malformed: bad severity",
  () => parseNative(goodNative.replace("| major |", "| critical |")),
  '`severity` is "critical"',
)
checkThrows(
  "malformed: bad category",
  () => parseNative(goodNative.replace("| dead-control |", "| vibes |")),
  '`category` is "vibes"',
)
checkThrows(
  "malformed: row with too many cells",
  () =>
    parseNative(
      goodNative.replace(
        goodRow,
        row(["TN-1", "a", "major", "dead-control", "t", "e", "/x", "open", "", "extra"]),
      ),
    ),
  "findings row has 10 cells",
)
checkThrows(
  "malformed: row with too few cells",
  () =>
    parseNative(
      goodNative.replace(goodRow, row(["TN-1", "a", "major", "dead-control", "t", "e", "/x"])),
    ),
  "findings row has 7 cells",
)
checkThrows(
  "malformed: duplicate id",
  () =>
    parseNative(
      fileText(nativeDefinition, {
        status: "reported",
        agentsReported: 1,
        rows: [
          row(["TN-1", "a", "minor", "inconsistency", "t", "e", "/x", "open", ""]),
          row(["TN-1", "a", "minor", "inconsistency", "t", "e", "/x", "open", ""]),
        ],
      }),
    ),
  'duplicate finding id "TN-1"',
)
checkThrows(
  "malformed: renamed column",
  () => parseNative(goodNative.replace("| location | status |", "| where | status |")),
  '"## Findings" columns must be exactly',
)
checkThrows(
  "malformed: unknown group field",
  () => parseNative(goodNative.replace("| agentsReported | 1 |", "| agentsReportd | 1 |")),
  "unknown group field",
)
checkThrows(
  "malformed: separator row replaced by data",
  () =>
    parseNative(
      goodNative.replace(
        row(["---", "---", "---", "---", "---", "---", "---", "---", "---"]),
        row(["a", "b", "c", "d", "e", "f", "g", "h", "i"]),
      ),
    ),
  "missing its separator row",
)
checkThrows(
  "malformed: separator row removed",
  () =>
    parseNative(
      goodNative.replace(row(["---", "---", "---", "---", "---", "---", "---", "---", "---"]), ""),
    ),
  "needs a header row and a separator row",
)
checkThrows(
  "malformed: not-started with findings",
  () => parseNative(goodNative.replace("| status | reported |", "| status | not-started |")),
  'status is "not-started"',
)
checkThrows(
  "malformed: agentsReported above agents",
  () => parseNative(goodNative.replace("| agentsReported | 1 |", "| agentsReported | 6 |")),
  "exceeds agents",
)
checkThrows(
  "malformed: missing file section",
  () => parseNative(goodNative.replace("## Findings", "## Notes")),
  'no "## Findings" section',
)
checkThrows(
  "malformed: dangling dupOf",
  () => {
    const texts = emptyTexts()
    texts["teacher-native"] = fileText(nativeDefinition, {
      status: "reported",
      agentsReported: 1,
      rows: [row(["TN-1", "a", "minor", "inconsistency", "t", "e", "/x", "open", "TL-99"])],
    })
    texts["teacher-langchain"] = fileText(define("teacher-langchain"), {
      status: "reported",
      agentsReported: 1,
      rows: [row(["TL-1", "a", "minor", "inconsistency", "t", "e", "/y", "open", ""])],
    })
    validateDupOf(parseTexts(texts))
  },
  "no such id exists in teacher-native or teacher-langchain",
)

checkThrows(
  "malformed: self-referential dupOf",
  () => {
    const texts = emptyTexts()
    texts["teacher-native"] = fileText(nativeDefinition, {
      status: "reported",
      agentsReported: 1,
      rows: [row(["TN-1", "a", "minor", "inconsistency", "t", "e", "/x", "open", "TN-1"])],
    })
    validateDupOf(parseTexts(texts))
  },
  "names itself",
)

// `dupOf` widened to same-group links: the same defect filed twice is legal,
// and both counts must move together (raw stays, distinct drops).
{
  const texts = emptyTexts()
  texts["teacher-native"] = fileText(nativeDefinition, {
    status: "reported",
    agentsReported: 1,
    rows: [
      row(["TN-1", "a", "major", "broken-flow", "first", "e", "/x", "open", ""]),
      row(["TN-2", "b", "major", "broken-flow", "duplicate", "e", "/x", "open", "TN-1"]),
      row(["TN-3", "c", "minor", "inconsistency", "distinct", "e", "/y", "open", ""]),
    ],
  })
  const parsed = parseTexts(texts)
  let threw = ""
  try {
    validateDupOf(parsed)
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error)
  }
  check(threw === "", `dupOf: a same-group link is accepted (threw: ${threw})`)

  const aggregate = buildAggregate(parsed, GENERATED_AT)
  const group = aggregate.groups.find((candidate) => candidate.id === "teacher-native")
  check(group?.total === 3, "dupOf: raw group total keeps every row")
  check(group?.duplicates === 1, "dupOf: one same-group duplicate is counted")
  check(group?.distinct === 2, "dupOf: distinct is raw minus linked duplicates")
  check(aggregate.totals.findings === 3, "dupOf: totals keep the raw count")
  check(aggregate.totals.duplicates === 1, "dupOf: totals count linked duplicates")
  check(aggregate.totals.distinct === 2, "dupOf: totals carry the distinct count")
}

// ---------------------------------------------------------------------------
// Live refresh: the debounce, and the keep-last-good rule.
//
// `server.ts` cannot be tested without a real filesystem and real timers, so the
// decisions it depends on live in `live.ts` and are driven here with a manual
// timer. These are the two behaviours the live view is only as good as: a burst
// of writes must not become a burst of re-reads, and a mid-write parse failure
// must not blank the page.
// ---------------------------------------------------------------------------

function manualTimer(): {
  timer: Timer
  fire(): void
  pending(): number
  durations: number[]
} {
  type Handle = { fn: () => void; cancelled: boolean }
  const handles: Handle[] = []
  const durations: number[] = []
  return {
    timer: {
      set(fn: () => void, ms: number) {
        durations.push(ms)
        const handle: Handle = { fn, cancelled: false }
        handles.push(handle)
        return handle
      },
      clear(handle: unknown) {
        const found = handles.find((candidate) => candidate === handle)
        if (found) found.cancelled = true
      },
    },
    fire() {
      let handle = handles.shift()
      while (handle && handle.cancelled) handle = handles.shift()
      if (!handle) throw new Error("manual timer: nothing pending to fire")
      handle.fn()
    },
    pending() {
      return handles.filter((handle) => !handle.cancelled).length
    },
    durations,
  }
}

{
  const clock = manualTimer()
  let flushes = 0
  const coalescer = createCoalescer({
    delayMs: 250,
    onFlush: () => {
      flushes += 1
    },
    timer: clock.timer,
  })

  coalescer.schedule()
  coalescer.schedule()
  coalescer.schedule()
  check(clock.pending() === 1, "coalesce: three events in one burst schedule a single flush")
  check(
    clock.durations.every((ms) => ms === 250),
    "coalesce: the timer uses the configured 250ms window",
  )
  check(flushes === 0, "coalesce: nothing runs before the window elapses")
  clock.fire()
  check(flushes === 1, "coalesce: the burst produces exactly one re-read")
  check(!coalescer.pending(), "coalesce: no timer is left after firing")

  coalescer.schedule()
  check(coalescer.pending(), "coalesce: schedules again after a flush")
  coalescer.flush()
  check(flushes === 2, "coalesce: flush() runs the pending read immediately")
  check(!coalescer.pending(), "coalesce: flush() clears the timer")

  coalescer.schedule()
  coalescer.cancel()
  check(!coalescer.pending(), "coalesce: cancel() drops the pending read")
  coalescer.flush()
  check(flushes === 2, "coalesce: a cancelled read never fires")
}

{
  const aggregate = buildAggregate(parseTexts(emptyTexts()), GENERATED_AT)
  const start = initialLiveState("2026-01-01T00:00:00.000Z")
  check(start.aggregate === null && start.revision === 0, "live: starts with no aggregate")

  const good = applyOutcome(start, { ok: true, aggregate }, "2026-01-01T00:01:00.000Z")
  check(good.aggregate === aggregate, "live: a successful read installs the aggregate")
  check(good.aggregateAt === GENERATED_AT, "live: aggregateAt is the aggregate's own generatedAt")
  check(good.errors.length === 0, "live: a successful read clears errors")
  check(good.revision === 1, "live: revision advances on success")
  check(start.aggregate === null, "live: applyOutcome does not mutate the previous state")

  const failed = applyOutcome(
    good,
    { ok: false, errors: ["docs/audit/teacher-native.md:9: bad severity"] },
    "2026-01-01T00:02:00.000Z",
  )
  check(failed.aggregate === aggregate, "live: a failed read keeps the last good aggregate")
  check(failed.aggregateAt === GENERATED_AT, "live: a failed read keeps the original aggregateAt")
  check(failed.errors.length === 1, "live: a failed read surfaces the error")
  check(failed.readAt === "2026-01-01T00:02:00.000Z", "live: a failed read still moves readAt")
  check(failed.revision === 2, "live: revision advances on failure too")
  check(good.errors.length === 0, "live: a failed read does not mutate the previous state")
  check(failed.aggregate !== null, "live: the page still has something to render after a failure")

  const recovered = applyOutcome(failed, { ok: true, aggregate }, "2026-01-01T00:03:00.000Z")
  check(recovered.errors.length === 0, "live: recovery clears the error")

  const beforeAny = applyOutcome(start, { ok: false, errors: ["boom"] }, "2026-01-01T00:04:00.000Z")
  check(
    beforeAny.aggregate === null,
    "live: a failure before any success leaves no aggregate, so the page can say it is blank",
  )
}

{
  const untouched = describeCoverage(buildAggregate(parseTexts(emptyTexts()), GENERATED_AT))
  check(untouched.empty, "coverage: four untouched files are an empty result")
  check(!untouched.complete, "coverage: untouched files are not a complete audit")
  check(
    untouched.headline.includes("not a clean result"),
    "coverage: an empty, incomplete run says it is not a clean result",
  )
  check(
    untouched.notes.join(" ").includes("Not started"),
    "coverage: not-started groups are named as such",
  )

  // All four reported with zero findings: the one shape of zero that is a real
  // result, and it must not read the same as "has not run".
  const reportedTexts = emptyTexts()
  for (const definition of GROUPS) {
    reportedTexts[definition.id] = fileText(definition, {
      status: "reported",
      agentsReported: definition.agents,
    })
  }
  const reported = describeCoverage(buildAggregate(parseTexts(reportedTexts), GENERATED_AT))
  check(reported.empty, "coverage: a reported zero still has no findings")
  check(reported.complete, "coverage: four reported groups are complete")
  check(
    reported.notes.join(" ").includes("ran and found nothing"),
    "coverage: a reported zero is described as having run",
  )
  check(
    reported.headline !== untouched.headline,
    "coverage: 'has not run' and 'ran, found nothing' do not read alike",
  )

  const withFindings = describeCoverage(
    buildAggregate(parseTexts(teacherTexts({ withDupOf: false })), GENERATED_AT),
  )
  check(!withFindings.empty, "coverage: findings are not an empty result")
  check(
    withFindings.headline.includes("finding"),
    "coverage: the headline states the finding count",
  )
}

// ---------------------------------------------------------------------------
// The page the server serves. The server-side checks all pass while the browser
// shows nothing if the embedded script has a syntax error, so compile it here —
// a one-line regression test for a failure mode that is otherwise invisible
// until someone opens the page.
// ---------------------------------------------------------------------------

{
  const page = renderPage()
  const script = page.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? ""
  check(script.length > 0, "view: the page contains a client script")
  try {
    new Script(script)
    check(true, "view: the embedded client script compiles")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    check(false, `view: the embedded client script does not compile: ${message}`)
  }
  check(page.includes("Nothing has been filed"), "view: the honest empty-state copy is present")
  check(page.includes('id="error-banner"'), "view: the error banner container exists")
}

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  process.stderr.write(`Audit dashboard selftest FAILED (${failures.length} of ${checks}):\n`)
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`Audit dashboard selftest passed: ${checks} checks.\n`)
}
