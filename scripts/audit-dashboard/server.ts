/**
 * Local, self-refreshing HTTP view of the audit.
 *
 *   npm run audit:dashboard:serve        # http://127.0.0.1:4318
 *   npm run audit:dashboard:serve -- --port 4319
 *
 * The CLI (`run.ts`) is a snapshot: parse, write aggregate.json, exit. This is
 * the same pipeline left running, with the four report files watched and the
 * current state pushed to every open browser tab.
 *
 * Three decisions worth knowing before changing anything:
 *
 *  - **SSE, not WebSockets.** The data only moves server → browser, so a
 *    full-duplex protocol would be more machinery for the same result.
 *    `EventSource` needs no dependency, reconnects on its own, and a dropped
 *    connection is just a reconnect rather than a re-subscribe.
 *  - **The watcher is debounced, and re-reads are single-flight.** `fs.watch`
 *    fires a burst for one logical save, and an editor that saves by rename
 *    fires more. The coalescer in `live.ts` collapses a burst; the in-flight
 *    guard below makes sure an older read can never finish last and overwrite a
 *    newer one with stale counts.
 *  - **A failed read is not fatal.** Reports are being written while this runs,
 *    so a partially written table is expected. The last good aggregate stays up
 *    and the parse error is pushed to the page.
 *
 * It binds `127.0.0.1` by default: the page renders audit findings, which can
 * include confidentiality issues, and it has no authentication. Override with
 * `AUDIT_DASHBOARD_HOST` only on a network you trust. `AUDIT_DASHBOARD_PORT`
 * and `AUDIT_DASHBOARD_DIR` override the port and the directory read; see the
 * comments on each below.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { watch, type FSWatcher } from "node:fs"
import { writeFile } from "node:fs/promises"
import path from "node:path"

import { buildAggregate } from "./aggregate"
import { GROUPS, type AuditAggregate } from "./groups"
import {
  applyOutcome,
  createCoalescer,
  describeCoverage,
  initialLiveState,
  type Coverage,
  type LiveState,
} from "./live"
import { AGGREGATE_PATH, AUDIT_DIR, readGroupFiles, REPO_ROOT, humanPath } from "./read"
import { renderPage } from "./view"

/**
 * Default port. 4318 is outside the ranges this repo and the usual front-end
 * tooling occupy — Next dev on 3000, Vite on 5173/4173, Storybook on 6006,
 * Chrome's inspector on 9222 — and below the ephemeral range, so it cannot be
 * handed out to something else mid-session. Nothing else in the repo binds it.
 */
const DEFAULT_PORT = 4318

/** How long to wait after the first filesystem event before re-reading. */
const DEBOUNCE_MS = 250

/** SSE comment frames keep the connection from being reaped as idle. */
const HEARTBEAT_MS = 15_000

/** Only these files are reports; `aggregate.json` is written by us and ignored. */
const WATCHED_FILES = new Set(GROUPS.map((group) => `${group.id}.md`))

const HOST = process.env.AUDIT_DASHBOARD_HOST ?? "127.0.0.1"
const PORT = resolvePort()

/**
 * Where the four report files are read and watched. Defaults to `docs/audit`.
 * The override exists so the server can be pointed at a fixture copy — its own
 * repo files may be mid-write by an audit group, which makes for a poor test
 * target — or at another checkout's audit. When it is set, the durable
 * `aggregate.json` is deliberately not written: that file belongs next to the
 * real reports, and writing the fixture's result into the repo would be wrong.
 */
const AUDIT_SOURCE_DIR = process.env.AUDIT_DASHBOARD_DIR
  ? path.resolve(process.env.AUDIT_DASHBOARD_DIR)
  : AUDIT_DIR

const STARTED_AT = new Date().toISOString()

function resolvePort(): number {
  const args = process.argv.slice(2)
  const flag = args.find((arg) => arg === "--port" || arg === "-p")
  const inline = args.find((arg) => arg.startsWith("--port="))
  const raw = inline
    ? inline.slice("--port=".length)
    : flag
      ? args[args.indexOf(flag) + 1]
      : undefined
  const value = raw ?? process.env.AUDIT_DASHBOARD_PORT
  if (value === undefined) return DEFAULT_PORT
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    process.stderr.write(`Ignoring invalid port "${value}"; using ${DEFAULT_PORT}.\n`)
    return DEFAULT_PORT
  }
  return port
}

let state: LiveState = initialLiveState(STARTED_AT)
let watcher: FSWatcher | null = null
let watcherNote = ""
let refreshing = false
let refreshQueued = false
let refreshTimer: NodeJS.Timeout | null = null
const clients = new Set<ServerResponse>()

function log(line: string): void {
  process.stdout.write(`${line}\n`)
}

function payload() {
  const aggregate: AuditAggregate | null = state.aggregate
  const coverage: Coverage | null = aggregate ? describeCoverage(aggregate) : null
  return {
    revision: state.revision,
    readAt: state.readAt,
    aggregateAt: state.aggregateAt,
    errors: state.errors,
    aggregate,
    coverage,
    watcher: {
      watching: watcher !== null,
      dir: humanPath(AUDIT_SOURCE_DIR, REPO_ROOT),
      note: watcherNote,
    },
    startedAt: STARTED_AT,
    port: PORT,
  }
}

function sendStateTo(client: ServerResponse): void {
  try {
    client.write(`event: state\ndata: ${JSON.stringify(payload())}\n\n`)
  } catch {
    clients.delete(client)
  }
}

function broadcast(): void {
  for (const client of clients) sendStateTo(client)
}

/**
 * Re-read the four files and fold the result into the live state.
 *
 * `refreshing`/`refreshQueued` make this single-flight: a read that starts
 * while another is in flight is queued and run once, rather than racing. Two
 * concurrent reads could otherwise land out of order and show older counts.
 */
async function refresh(): Promise<void> {
  if (refreshing) {
    refreshQueued = true
    return
  }
  refreshing = true
  try {
    const at = new Date().toISOString()
    const result = await readGroupFiles(AUDIT_SOURCE_DIR)

    if (!result.ok) {
      state = applyOutcome(state, { ok: false, errors: result.errors }, at)
      log(
        `[${at}] read failed (${result.errors.length} problem(s)); still serving ${
          state.aggregateAt ?? "no"
        } aggregate`,
      )
      for (const error of result.errors) log(`  ${error}`)
    } else {
      const aggregate = buildAggregate(result.parsed, at)
      state = applyOutcome(state, { ok: true, aggregate }, at)
      if (AUDIT_SOURCE_DIR === AUDIT_DIR) {
        try {
          await writeFile(AGGREGATE_PATH, `${JSON.stringify(aggregate, null, 2)}\n`, "utf8")
        } catch (error) {
          // The page does not read aggregate.json, so a write failure degrades the
          // durable artifact but not the live view. Say so instead of hiding it.
          log(`  warning: could not write ${humanPath(AGGREGATE_PATH)}: ${String(error)}`)
        }
      }
      log(
        `[${at}] ${aggregate.totals.findings} finding(s), ${aggregate.totals.groupsReported}/${aggregate.totals.groups} group(s) reported`,
      )
    }

    broadcast()
  } finally {
    refreshing = false
    if (refreshQueued) {
      refreshQueued = false
      void refresh()
    }
  }
}

const coalescer = createCoalescer({ delayMs: DEBOUNCE_MS, onFlush: () => void refresh() })

function startWatching(): void {
  try {
    watcher = watch(AUDIT_SOURCE_DIR, { persistent: true }, (_eventType, filename) => {
      // A null filename means the platform did not say which file changed; treat
      // it as relevant rather than missing an update. `aggregate.json` is ours,
      // and refreshing on our own write would be a loop.
      if (filename !== null && !WATCHED_FILES.has(filename)) return
      coalescer.schedule()
    })
    watcher.on("error", (error) => {
      watcherNote = `watcher error: ${String(error)}`
      log(watcherNote)
      startPollingFallback()
    })
    log(
      `Watching ${humanPath(AUDIT_SOURCE_DIR, REPO_ROOT)} for ${[...WATCHED_FILES].join(", ")} (debounced ${DEBOUNCE_MS}ms).`,
    )
  } catch (error) {
    // A missing directory (fresh checkout) must not stop the server: the page
    // should still come up and explain that nothing has parsed.
    watcherNote = `cannot watch (${String(error)})`
    log(`${watcherNote}; falling back to polling every 3s.`)
    startPollingFallback()
  }
}

/**
 * Fallback for when `fs.watch` is unavailable. It re-reads on a timer without
 * comparing mtimes: four small files every 3s is cheaper than the bookkeeping,
 * and this path only runs when watching failed.
 */
function startPollingFallback(): void {
  if (refreshTimer !== null) return
  refreshTimer = setInterval(() => void refresh(), 3000)
  refreshTimer.unref()
}

function handleEvents(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    // `no-transform` stops a proxy from buffering the stream into uselessness.
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  })
  res.socket?.setNoDelay(true)
  // The browser's own retry hint, sent before anything else so a reconnect is
  // quick even if the first state frame is large.
  res.write("retry: 1000\n\n")
  clients.add(res)
  // A tab that opens (or reconnects) later must see the current state now, not
  // only after the next filesystem event.
  sendStateTo(res)
  log(`[${new Date().toISOString()}] SSE client connected (${clients.size} open)`)
  req.on("close", () => {
    clients.delete(res)
  })
}

function handleState(res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  })
  res.end(`${JSON.stringify(payload(), null, 2)}\n`)
}

function handlePage(res: ServerResponse): void {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" })
  res.end(renderPage())
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${HOST}:${PORT}`}`)
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" })
    res.end("Method not allowed\n")
    return
  }
  switch (url.pathname) {
    case "/":
    case "/index.html":
      handlePage(res)
      return
    case "/state":
      handleState(res)
      return
    case "/events":
      handleEvents(req, res)
      return
    default:
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
      res.end("Not found. Try / , /state or /events.\n")
  }
})

const heartbeat = setInterval(() => {
  for (const client of clients) {
    try {
      client.write(": ping\n\n")
    } catch {
      clients.delete(client)
    }
  }
}, HEARTBEAT_MS)
heartbeat.unref()

function shutdown(signal: string): void {
  log(`\n${signal} received; shutting down.`)
  coalescer.cancel()
  if (refreshTimer !== null) clearInterval(refreshTimer)
  watcher?.close()
  for (const client of clients) client.end()
  clients.clear()
  server.close(() => process.exit(0))
  // Do not wait forever for a hung client socket to close.
  setTimeout(() => process.exit(0), 1000).unref()
}

server.listen(PORT, HOST, () => {
  log(`Audit dashboard live at http://${HOST}:${PORT}`)
  log("  page    GET /")
  log("  state   GET /state")
  log("  stream  GET /events (SSE)")
  log("Ctrl-C to stop. No authentication: bound to localhost only.")
  // Watch before the first read, so an edit that lands during the first read is
  // not missed between "no watcher yet" and "watching".
  startWatching()
  void refresh()
})

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))
