/**
 * The dashboard page: markup, CSS and client JS as one self-contained string.
 *
 * It is one string rather than a `.html` asset plus a `.js` file so the server
 * has no build step, no static-file route and no chance of serving a stale
 * script; `npm run build` never sees it. The trade-off is that the client JS is
 * written without template literals (they would collide with this file's own
 * template literal), hence the string concatenation below.
 *
 * The client renders with `textContent` and DOM nodes, never `innerHTML`, so
 * finding titles and evidence — which quote shell commands, pipes and routes
 * from the audited app — cannot break the page.
 */

export function renderPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="icon" href="data:," />
<title>Audit dashboard — live</title>
<style>
:root {
  --bg: #f7f7f8;
  --panel: #ffffff;
  --ink: #1c1d21;
  --muted: #6b6f76;
  --line: #e2e3e6;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --blocker: #b3261e;
  --major: #9a5b00;
  --minor: #4a5568;
  --ok: #1b6e3c;
  --info: #1f5fa9;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 24px 20px 64px;
  background: var(--bg);
  color: var(--ink);
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
main, header, footer { max-width: 1180px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 16px; margin: 0 0 10px; }
h3 { font-size: 14px; margin: 0; }
p { margin: 0 0 8px; }
section { margin: 26px 0 0; }
a { color: var(--info); }
.muted { color: var(--muted); }
.small { font-size: 12.5px; }
.mono { font-family: var(--mono); font-size: 12.5px; }
.sub { color: var(--muted); margin: 0 0 12px; max-width: 900px; }
.status { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.pill {
  display: inline-block; padding: 3px 9px; border-radius: 999px;
  border: 1px solid var(--line); background: var(--panel); font-size: 12.5px;
}
.pill-ok { border-color: #b7ddc4; background: #eef8f1; color: var(--ok); }
.pill-warn { border-color: #f0d9a8; background: #fdf6e6; color: var(--major); }
.pill-err { border-color: #f0bdb8; background: #fdeeed; color: var(--blocker); }
.banner { border: 1px solid var(--line); border-left-width: 4px; background: var(--panel); border-radius: 6px; padding: 12px 14px; margin: 18px 0 0; }
.banner-warn { border-left-color: var(--major); }
.banner-error { border-left-color: var(--blocker); }
.banner-info { border-left-color: var(--info); }
.banner strong { display: block; margin-bottom: 6px; }
.banner ul { margin: 6px 0 0; padding-left: 20px; }
.banner li { margin: 2px 0; }
.stats { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; }
.stat { min-width: 108px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); }
.stat-value { font-size: 22px; font-weight: 600; line-height: 1.1; }
.stat-label { font-size: 12px; color: var(--muted); margin-top: 2px; }
table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { background: #f0f1f3; font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--muted); }
tbody tr:last-child td { border-bottom: 0; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.sev { font-weight: 600; }
.sev-blocker { color: var(--blocker); }
.sev-major { color: var(--major); }
.sev-minor { color: var(--minor); }
.sev-ok { color: var(--ok); }
tr.row-blocker td:first-child { box-shadow: inset 3px 0 0 var(--blocker); }
tr.row-major td:first-child { box-shadow: inset 3px 0 0 var(--major); }
tr.row-minor td:first-child { box-shadow: inset 3px 0 0 var(--minor); }
.status-not-started { color: var(--muted); }
.status-running { color: var(--info); font-weight: 600; }
.status-reported { color: var(--ok); font-weight: 600; }
.status-failed { color: var(--blocker); font-weight: 600; }
.evidence { font-family: var(--mono); font-size: 12.5px; white-space: pre-wrap; word-break: break-word; max-width: 380px; }
.controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 10px; }
select { font: inherit; padding: 4px 6px; border: 1px solid var(--line); border-radius: 5px; background: var(--panel); }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
@media (max-width: 900px) { .grid2 { grid-template-columns: 1fr; } }
.card { border: 1px solid var(--line); border-radius: 6px; background: var(--panel); padding: 12px 14px; margin-bottom: 14px; }
.card-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 10px; }
ul.findings { list-style: none; margin: 0; padding: 0; }
ul.findings li { padding: 6px 0; border-bottom: 1px dashed var(--line); }
ul.findings li:last-child { border-bottom: 0; }
/* A resolved finding is struck through so the list reads as a record of what was
   found and what was done about it, rather than a list of open work. Fixed rows are
   struck; wontfix rows are dimmed but not struck, because the finding is still true —
   we chose not to act on it, which is a different statement. */
ul.findings li.is-fixed { text-decoration: line-through; text-decoration-thickness: 1px; opacity: 0.55; }
ul.findings li.is-fixed code { text-decoration: line-through; }
ul.findings li.is-wontfix { opacity: 0.6; font-style: italic; }
footer { margin-top: 32px; color: var(--muted); font-size: 12.5px; }
code { font-family: var(--mono); font-size: 12.5px; background: #f0f1f3; padding: 1px 4px; border-radius: 4px; }
</style>
</head>
<body>
<header>
  <h1>Code audit — live progress</h1>
  <p class="sub">
    Teacher and student surfaces, each audited twice and independently — once by native Cursor
    agents, once by LangChain agents. Reads <code>docs/audit/*.md</code> directly; refreshes without
    a page reload as groups report. The comparison is what the two kinds are for.
  </p>
  <div class="status">
    <span id="connection" class="pill">connecting…</span>
    <span id="watcher" class="pill">watcher: unknown</span>
    <span id="last-read" class="pill">files read: —</span>
  </div>
</header>

<div id="error-banner" class="banner banner-error" hidden></div>
<div id="coverage-banner"></div>

<main>
  <section id="overall"></section>
  <section id="comparison"></section>
  <section id="groups"></section>
  <section id="findings"></section>
</main>

<footer>
  <p>
    Severity: <strong class="sev-blocker">blocker</strong> = surface unusable ·
    <strong class="sev-major">major</strong> = usable but visibly broken or misleading ·
    <strong class="sev-minor">minor</strong> = polish. Categories are the audit's controlled
    vocabulary; schema and the pairing rule are in <code>docs/audit/README.md</code>.
  </p>
  <p id="boot">Waiting for the first state from the server…</p>
</footer>

<script>
(function () {
  "use strict"

  var SEVERITIES = ["blocker", "major", "minor"]
  var STATUSES = ["open", "fixed", "wontfix"]
  var CATEGORIES = [
    "broken-flow", "dead-control", "missing-write-path", "fabricated-number",
    "partial-implementation", "missing-empty-state", "inconsistency",
    "unreachable-ui", "confidentiality-leak"
  ]

  var state = null
  var connection = "connecting"
  var filters = { group: "all", severity: "all", category: "all" }

  function byId(id) { return document.getElementById(id) }

  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild)
  }

  function fmtTime(iso) {
    if (!iso) return "—"
    var date = new Date(iso)
    if (isNaN(date.getTime())) return String(iso)
    return date.toLocaleTimeString()
  }

  function fmtAgo(iso) {
    if (!iso) return ""
    var ms = Date.now() - new Date(iso).getTime()
    if (isNaN(ms)) return ""
    var seconds = Math.max(0, Math.round(ms / 1000))
    if (seconds < 5) return "just now"
    if (seconds < 60) return seconds + "s ago"
    var minutes = Math.round(seconds / 60)
    if (minutes < 60) return minutes + "m ago"
    return Math.round(minutes / 60) + "h ago"
  }

  function sevClass(severity) { return "sev sev-" + severity }

  function callout(tone, headline, notes) {
    var box = el("div", "banner banner-" + tone)
    box.appendChild(el("strong", null, headline))
    if (notes && notes.length > 0) {
      var list = el("ul")
      notes.forEach(function (note) { list.appendChild(el("li", null, note)) })
      box.appendChild(list)
    }
    return box
  }

  // Cells are strings or DOM nodes; nodes are used where text needs its own
  // class, so nothing user-supplied is ever parsed as HTML.
  function table(headers, rows, options) {
    var node = el("table")
    var head = el("thead")
    var headRow = el("tr")
    headers.forEach(function (header, index) {
      var th = el("th", null, header)
      if (options && options.align && options.align[index] === "right") th.className = "num"
      headRow.appendChild(th)
    })
    head.appendChild(headRow)
    node.appendChild(head)

    var body = el("tbody")
    rows.forEach(function (cells, rowIndex) {
      var row = el("tr")
      if (options && options.rowClass) row.className = options.rowClass(rowIndex) || ""
      cells.forEach(function (cell, colIndex) {
        var td = el("td")
        if (cell && cell.nodeType) td.appendChild(cell)
        else td.textContent = cell === null || cell === undefined ? "—" : String(cell)
        if (options && options.align && options.align[colIndex] === "right") td.className = "num"
        if (options && options.cellClass) {
          var extra = options.cellClass(rowIndex, colIndex)
          if (extra) td.className = td.className ? td.className + " " + extra : extra
        }
        row.appendChild(td)
      })
      body.appendChild(row)
    })
    node.appendChild(body)
    return node
  }

  function renderStatus() {
    var label = connection === "live"
      ? "live — SSE connected"
      : connection === "polling"
        ? "polling (SSE unavailable)"
        : connection === "reconnecting"
          ? "reconnecting…"
          : "connecting…"
    var pill = byId("connection")
    pill.textContent = label
    pill.className = "pill " + (connection === "live" ? "pill-ok" : "pill-warn")

    var watcher = byId("watcher")
    if (state && state.watcher && state.watcher.watching) {
      watcher.textContent = "watching " + state.watcher.dir
      watcher.className = "pill pill-ok"
    } else if (state && state.watcher) {
      watcher.textContent = "watcher off — " + (state.watcher.note || "polling")
      watcher.className = "pill pill-warn"
    }

    byId("last-read").textContent = state
      ? "files read " + fmtTime(state.readAt) + " (" + fmtAgo(state.readAt) + ")"
      : "files read: —"
  }

  function renderErrors() {
    var box = byId("error-banner")
    clear(box)
    if (!state || !state.errors || state.errors.length === 0) {
      box.hidden = true
      return
    }
    box.hidden = false
    box.appendChild(el("strong", null, state.aggregate
      ? "Last read failed — showing the last good data from " + fmtTime(state.aggregateAt) +
        ". The files on disk do not parse right now."
      : "No valid data yet — the files do not parse. Expected if a writer is mid-save; it clears on the next read."
    ))
    var list = el("ul")
    state.errors.forEach(function (message) { list.appendChild(el("li", "mono", message)) })
    box.appendChild(list)
    box.appendChild(el("p", "muted small", "The page keeps the previous state on purpose: a " +
      "partially written table is normal while a group is editing, and blanking the dashboard " +
      "would hide everything else that is still readable."))
  }

  function renderCoverage() {
    var box = byId("coverage-banner")
    clear(box)
    if (state && !state.aggregate) {
      box.appendChild(callout("warn", "Waiting for the first successful read", [
        "The page is connected. Nothing in docs/audit/*.md has parsed yet, so there is nothing to report either way — this is not a zero, it is a blank."
      ]))
      return
    }
    if (!state || !state.coverage) return
    var coverage = state.coverage
    if (coverage.empty) {
      var notes = coverage.notes.slice()
      notes.unshift("Nothing has been filed. That is not the same as a clean audit: a group whose " +
        "status is not-started or running has not looked yet, and its surfaces are unknown.")
      box.appendChild(callout("warn", coverage.headline, notes))
    } else {
      box.appendChild(callout(coverage.complete ? "info" : "info", coverage.headline, coverage.notes))
    }
  }

  function renderOverall() {
    var box = byId("overall")
    clear(box)
    if (!state || !state.aggregate) return
    var totals = state.aggregate.totals
    box.appendChild(el("h2", null, "Overall"))

    var stats = el("div", "stats")
    var cards = [
      ["finding rows", totals.findings, ""],
      ["distinct findings", totals.distinct, ""],
      ["linked duplicates", totals.duplicates, "muted"],
      ["blockers left", totals.bySeverityOpen.blocker + " of " + totals.bySeverity.blocker, "sev-blocker"],
      ["majors left", totals.bySeverityOpen.major + " of " + totals.bySeverity.major, "sev-major"],
      ["minors left", totals.bySeverityOpen.minor + " of " + totals.bySeverity.minor, "sev-minor"],
      ["groups reported", totals.groupsReported + " / " + totals.groups, ""],
      ["agents reported", totals.agentsReported + " / " + totals.agents, ""],
      ["still open", totals.byStatus.open, "sev-blocker"],
      ["fixed", totals.byStatus.fixed, "sev-ok"],
      ["wontfix", totals.byStatus.wontfix, ""]
    ]
    cards.forEach(function (card) {
      var node = el("div", "stat " + card[2])
      node.appendChild(el("div", "stat-value", card[1]))
      node.appendChild(el("div", "stat-label", card[0]))
      stats.appendChild(node)
    })
    box.appendChild(stats)

    box.appendChild(el("p", "muted small",
      "Group status: " + totals.groupsReported + " reported · " + totals.groupsRunning +
      " running · " + totals.groupsNotStarted + " not-started · " + totals.groupsFailed + " failed."))
    box.appendChild(el("p", "muted small",
      "Finding rows count every row filed. Distinct findings collapse rows linked as duplicates of " +
      "another row in the same group through dupOf (" + totals.duplicates + " linked so far), which " +
      "is the count to use when asking how many defects were found."))
    box.appendChild(el("p", "muted small",
      "Severity is split deliberately. A card reading 'N of M' is what is LEFT: N still open out " +
      "of M ever filed. The total never falls — a fixed blocker is still a defect that was found — " +
      "so a card showing only the total beside 'still open' would read as outstanding work when " +
      "there is none. Group-table severity columns are open-scoped for the same reason."))

    var used = CATEGORIES.filter(function (category) { return totals.byCategory[category] > 0 })
    if (used.length > 0) {
      var line = el("p", "small")
      line.appendChild(el("span", "muted", "Categories: "))
      used.forEach(function (category, index) {
        if (index > 0) line.appendChild(document.createTextNode(" · "))
        line.appendChild(el("code", null, category + " " + totals.byCategory[category]))
      })
      box.appendChild(line)
    }
  }

  function findingList(findings, emptyText) {
    if (findings.length === 0) return el("p", "muted small", emptyText)
    var list = el("ul", "findings")
    findings.forEach(function (finding) {
      var cls = finding.status === "fixed" ? "is-fixed" : finding.status === "wontfix" ? "is-wontfix" : ""
      var item = el("li", cls)
      item.appendChild(el("span", sevClass(finding.severity), finding.severity))
      item.appendChild(document.createTextNode(" "))
      item.appendChild(el("code", null, finding.id))
      item.appendChild(document.createTextNode(" " + finding.title))
      item.appendChild(el("div", "muted small mono",
        finding.location + " · " + finding.status + (finding.dupOf ? " · dupOf " + finding.dupOf : "")))
      list.appendChild(item)
    })
    return list
  }

  function renderComparison() {
    var box = byId("comparison")
    clear(box)
    if (!state || !state.aggregate) return
    box.appendChild(el("h2", null, "Native vs LangChain"))
    box.appendChild(el("p", "muted small",
      "Findings are paired on category plus location, with line numbers stripped and a route folded " +
      "together with the app/(dashboard)/…/page.tsx file that serves it; a declared dupOf link " +
      "overrides that. 'Unique to' means the other kind's file has no finding with the same key. " +
      "Read the paired titles, not just the counts — the key is coarse by construction, and " +
      "same-group duplicates are not paired twice."))

    state.aggregate.comparisons.forEach(function (comparison) {
      var card = el("div", "card")
      var head = el("div", "card-head")
      head.appendChild(el("h3", null, comparison.domain === "teacher" ? "Teacher domain" : "Student domain"))
      head.appendChild(el("span", "pill", comparison.native.group + " · " + comparison.native.status))
      head.appendChild(el("span", "pill", comparison.langchain.group + " · " + comparison.langchain.status))
      card.appendChild(head)

      var rows = SEVERITIES.map(function (severity) {
        return [severity, comparison.native.bySeverity[severity], comparison.langchain.bySeverity[severity], comparison.delta[severity]]
      })
      rows.push(["total rows", comparison.native.total, comparison.langchain.total, comparison.native.total - comparison.langchain.total])
      rows.push(["distinct", comparison.native.distinct, comparison.langchain.distinct, comparison.native.distinct - comparison.langchain.distinct])
      card.appendChild(table(
        ["Severity", "Native", "LangChain", "Δ native − LangChain"],
        rows,
        { align: ["left", "right", "right", "right"], rowClass: function (index) { return index < 3 ? "row-" + SEVERITIES[index] : "" } }
      ))

      var bothEmpty = comparison.native.total === 0 && comparison.langchain.total === 0
      var note = el("p", "muted small")
      note.textContent = bothEmpty
        ? "Neither kind has filed a finding in this domain yet, so there is nothing to compare. This does not mean the domain is clean — check the group statuses below."
        : "Found by both: " + comparison.shared.length + " pairing(s), " + comparison.uniqueToNative.length +
          " unique to native, " + comparison.uniqueToLangchain.length + " unique to LangChain. " +
          "Native reported " + comparison.native.total + " rows (" + comparison.native.distinct +
          " distinct); LangChain reported " + comparison.langchain.total + " rows (" +
          comparison.langchain.distinct + " distinct). Duplicates are not paired twice."
      card.appendChild(note)

      var grid = el("div", "grid2")
      var nativeCol = el("div")
      nativeCol.appendChild(el("p", "small muted", "Unique to native (" + comparison.uniqueToNative.length + ")"))
      nativeCol.appendChild(findingList(comparison.uniqueToNative, bothEmpty
        ? "Nothing filed by either kind yet."
        : "Nothing unique — every native finding also has a LangChain counterpart."))
      var langchainCol = el("div")
      langchainCol.appendChild(el("p", "small muted", "Unique to LangChain (" + comparison.uniqueToLangchain.length + ")"))
      langchainCol.appendChild(findingList(comparison.uniqueToLangchain, bothEmpty
        ? "Nothing filed by either kind yet."
        : "Nothing unique — every LangChain finding also has a native counterpart."))
      grid.appendChild(nativeCol)
      grid.appendChild(langchainCol)
      card.appendChild(grid)

      if (comparison.shared.length > 0) {
        var shared = el("p", "muted small")
        shared.textContent = "Paired: " + comparison.shared.map(function (entry) { return entry.key }).join(" · ")
        card.appendChild(shared)
      }
      box.appendChild(card)
    })
  }

  function renderGroups() {
    var box = byId("groups")
    clear(box)
    if (!state || !state.aggregate) return
    box.appendChild(el("h2", null, "Groups"))
    var groups = state.aggregate.groups
    var rows = groups.map(function (group) {
      return [
        group.id, group.domain, group.kind,
        group.status,
        group.agentsReported + " / " + group.agents,
        group.total,
        group.distinct,
        group.duplicates,
        group.bySeverityOpen.blocker, group.bySeverityOpen.major, group.bySeverityOpen.minor,
        group.byStatus.open, group.byStatus.fixed
      ]
    })
    box.appendChild(table(
      ["Group", "Domain", "Kind", "Status", "Agents", "Findings", "Distinct", "Dupes", "Open blk", "Open maj", "Open min", "Open", "Fixed"],
      rows,
      {
        align: ["left", "left", "left", "left", "right", "right", "right", "right", "right", "right", "right", "right", "right"],
        cellClass: function (rowIndex, colIndex) {
          if (colIndex === 3) return "status-" + groups[rowIndex].status
          if (colIndex === 5 && groups[rowIndex].status === "reported" && groups[rowIndex].total === 0) return "muted"
          if (colIndex === 7 && groups[rowIndex].duplicates === 0) return "muted"
          return ""
        }
      }
    ))
    var scopes = groups.map(function (group) { return group.id + " → " + group.scope }).join(" · ")
    box.appendChild(el("p", "muted small", "Scope: " + scopes + "."))
    box.appendChild(el("p", "muted small",
      "A group with status reported and zero findings ran and found nothing. A group with status " +
      "not-started or running has no result yet; the two are not the same, and the findings " +
      "column never means 'clean' for the second. Findings is the raw row count; Distinct removes " +
      "rows that dupOf links to another row in the same group."))
  }

  function select(label, options, value, onChange) {
    var node = el("select")
    node.setAttribute("aria-label", label)
    options.forEach(function (option) {
      var item = el("option", null, option.label)
      item.value = option.value
      node.appendChild(item)
    })
    node.value = value
    node.addEventListener("change", function () { onChange(node.value) })
    return node
  }

  function renderFindings() {
    var box = byId("findings")
    clear(box)
    if (!state || !state.aggregate) return
    var aggregate = state.aggregate
    var all = aggregate.groups.reduce(function (list, group) { return list.concat(group.findings) }, [])

    box.appendChild(el("h2", null, "Findings"))
    if (all.length === 0) {
      box.appendChild(el("p", "muted",
        "No findings have been filed, so there is nothing to list here. That is not a clean audit: " +
        aggregate.totals.groupsReported + " of " + aggregate.totals.groups + " groups have reported, " +
        "and the statuses above say which surfaces were never looked at."))
      return
    }

    var filtered = all.filter(function (finding) {
      return (filters.group === "all" || finding.group === filters.group) &&
        (filters.severity === "all" || finding.severity === filters.severity) &&
        (filters.category === "all" || finding.category === filters.category)
    })
    var rank = { blocker: 0, major: 1, minor: 2 }
    filtered.sort(function (a, b) {
      return rank[a.severity] - rank[b.severity] || a.group.localeCompare(b.group) || a.id.localeCompare(b.id)
    })

    var controls = el("div", "controls")
    controls.appendChild(select("Group filter", [{ value: "all", label: "All groups (" + all.length + ")" }].concat(
      aggregate.groups.map(function (group) { return { value: group.id, label: group.id + " (" + group.total + ")" } })
    ), filters.group, function (value) { filters.group = value; renderFindings() }))
    controls.appendChild(select("Severity filter", [{ value: "all", label: "All severities" }].concat(
      SEVERITIES.map(function (severity) { return { value: severity, label: severity + " (" + aggregate.totals.bySeverity[severity] + ")" } })
    ), filters.severity, function (value) { filters.severity = value; renderFindings() }))
    controls.appendChild(select("Category filter", [{ value: "all", label: "All categories" }].concat(
      CATEGORIES.filter(function (category) { return aggregate.totals.byCategory[category] > 0 })
        .map(function (category) { return { value: category, label: category + " (" + aggregate.totals.byCategory[category] + ")" } })
    ), filters.category, function (value) { filters.category = value; renderFindings() }))
    controls.appendChild(el("span", "muted small", "Showing " + filtered.length + " of " + all.length))
    box.appendChild(controls)

    if (filtered.length === 0) {
      box.appendChild(el("p", "muted", "No finding matches these filters. That is not a clean result — clear the filters to see all " + all.length + " finding(s)."))
      return
    }

    var rows = filtered.map(function (finding) {
      var evidence = el("div", "evidence", finding.evidence)
      return [
        finding.id, finding.severity, finding.group, finding.category,
        finding.title, evidence, finding.location, finding.status,
        finding.dupOf || ""
      ]
    })
    box.appendChild(table(
      ["id", "Severity", "Group", "Category", "Title", "Evidence", "Location", "Status", "dupOf"],
      rows,
      {
        rowClass: function (index) { return "row-" + filtered[index].severity },
        cellClass: function (index, colIndex) {
          if (colIndex === 1) return sevClass(filtered[index].severity)
          if (colIndex === 3 || colIndex === 6 || colIndex === 0) return "mono"
          return ""
        }
      }
    ))
  }

  function render() {
    renderStatus()
    renderErrors()
    renderCoverage()
    renderOverall()
    renderComparison()
    renderGroups()
    renderFindings()
    if (state) {
      byId("boot").textContent = "State revision " + state.revision + " · aggregate generated " +
        (state.aggregateAt ? fmtTime(state.aggregateAt) : "never") + " · served from port " + state.port + "."
    }
  }

  function apply(payload) {
    state = payload
    render()
  }

  function fetchState() {
    return fetch("/state", { cache: "no-store" })
      .then(function (response) { return response.json() })
      .then(function (payload) { apply(payload); return payload })
      .catch(function () { /* the SSE stream or the next poll retries */ })
  }

  // The server sends the current state on connect, so this first fetch is only
  // for the no-SSE case and to paint something before the stream opens.
  fetchState()

  if (typeof EventSource === "undefined") {
    connection = "polling"
    renderStatus()
    setInterval(fetchState, 2000)
    setInterval(renderStatus, 1000)
    return
  }

  var source = new EventSource("/events")
  source.addEventListener("open", function () { connection = "live"; renderStatus() })
  source.addEventListener("error", function () { connection = "reconnecting"; renderStatus() })
  source.addEventListener("state", function (event) {
    connection = "live"
    try { apply(JSON.parse(event.data)) } catch (error) { /* keep the previous state */ }
    renderStatus()
  })

  // Safety net for a stream that dies without firing its error handler: if the
  // browser does not think it is connected, ask for the state directly.
  setInterval(function () {
    if (connection !== "live") fetchState()
  }, 4000)
  setInterval(renderStatus, 1000)
})()
</script>
</body>
</html>
`
}
