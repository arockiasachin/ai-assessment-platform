import { execFile } from "node:child_process"
import { createReadStream } from "node:fs"
import { readdir } from "node:fs/promises"
import path from "node:path"
import { createInterface } from "node:readline"

import { tool } from "langchain"
import { z } from "zod"

/**
 * The tool surface the audit agents are allowed to use.
 *
 * Two constraints shape everything here:
 *
 * 1. These commands are chosen by an LLM, so the shell surface must be an
 *    allowlist rather than a denylist. `run_command` accepts a listed command
 *    plus separately-validated arguments and executes it with `execFile` and an
 *    argument array — never string interpolation into a shell. An unknown
 *    command is rejected with a readable reason so the agent can adapt instead
 *    of crashing.
 *
 * 2. Other audit groups are working in this same checkout and against the same
 *    test database. The agents must not write to the repo, commit, push, or run
 *    `npm test` (a concurrent Vitest run corrupts the shared test database for
 *    the native groups). Those are deliberately absent from the allowlist.
 */

/** Every tool result is capped so one sprawling output cannot blow the context. */
export const DEFAULT_OUTPUT_CAP_BYTES = 30_000

/**
 * `execFile` still buffers the whole child output before we can truncate it, so
 * cap the OS-level buffer too and treat overflow as truncation rather than a
 * crash.
 */
const MAX_EXEC_BUFFER_BYTES = 4 * 1024 * 1024

/** A runaway `rg`/`curl`/`git` should not hold an agent slot forever. */
const COMMAND_TIMEOUT_MS = 30_000

/** Body caps for the two network tools; pages here are large HTML documents. */
const HTTP_BODY_CAP_BYTES = 24_000

export type AuditToolContext = {
  /** Absolute repo root. Every filesystem tool is confined to this subtree. */
  repoRoot: string
  /** Origin of the running app, e.g. `http://localhost:3000`. */
  baseUrl: string
  /** Shared across agents so a login is not repeated per tool call. */
  sessions: SessionCache
}

// ---------------------------------------------------------------------------
// Output handling
// ---------------------------------------------------------------------------

/**
 * Trim to `capBytes` on a UTF-8 boundary and say so. The notice matters: an
 * agent that silently receives a prefix will report "not present" for things
 * that are simply past the cut, so every truncation is announced and paired
 * with the action that would narrow it.
 */
export function truncateOutput(text: string, capBytes = DEFAULT_OUTPUT_CAP_BYTES): string {
  const total = Buffer.byteLength(text, "utf8")
  if (total <= capBytes) return text
  const head = Buffer.from(text, "utf8")
    .subarray(0, capBytes)
    .toString("utf8")
    // A byte-boundary cut can leave a replacement character; drop it rather
    // than showing the agent a stray "�".
    .replace(/\uFFFD$/, "")
  return `${head}\n\n[truncated: showing the first ~${capBytes} of ${total} bytes. Narrow the request (a tighter pattern, a path, or a line range) to see the rest.]`
}

function failure(message: string): string {
  return `ERROR: ${message}`
}

function byteSize(text: string): number {
  return Buffer.byteLength(text, "utf8")
}

// ---------------------------------------------------------------------------
// Path handling
// ---------------------------------------------------------------------------

/**
 * Resolve a tool-supplied path inside the repo. Absolute paths, `..` escapes
 * and symlink tricks are all rejected here: the agents read the checkout, they
 * do not get to wander the filesystem.
 */
function resolveInsideRepo(repoRoot: string, requested: string): string {
  const candidate = path.resolve(repoRoot, requested)
  const rel = path.relative(repoRoot, candidate)
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`path "${requested}" resolves outside the repository (${repoRoot}).`)
  }
  return candidate
}

// ---------------------------------------------------------------------------
// read_file
// ---------------------------------------------------------------------------

type ReadResult = {
  text: string
  /** True when the byte cap stopped us before the requested range ran out. */
  capHit: boolean
  /** True when the loop reached the end of the file inside the range. */
  sawEof: boolean
  /** Last line number inspected, i.e. the file's length when `sawEof`. */
  lastLine: number
  /** Last line number actually included in `text`; 0 when nothing was kept. */
  lastReturnedLine: number
}

/**
 * Stream the file so a multi-megabyte file costs one line at a time, and stop
 * as soon as the requested range ends. Reading the whole file first would make
 * the range parameter pointless for exactly the files that need it most.
 */
async function readFileRange(
  absPath: string,
  startLine: number,
  endLine: number,
  capBytes: number,
): Promise<ReadResult> {
  const stream = createReadStream(absPath, { encoding: "utf8" })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  const kept: string[] = []
  let bytes = 0
  let lineNo = 0
  let capHit = false
  let sawEof = false
  let rangeDone = false

  try {
    for await (const line of lines) {
      lineNo += 1
      if (lineNo > endLine) {
        rangeDone = true
        break
      }
      if (lineNo < startLine) continue
      // Number the lines so evidence can cite an exact location and so a
      // follow-up `read_file` range is unambiguous.
      const chunk = `${lineNo}\t${line}\n`
      const size = byteSize(chunk)
      if (bytes + size > capBytes) {
        capHit = true
        break
      }
      kept.push(chunk)
      bytes += size
    }
    // Only a completed walk means EOF; breaking on the cap or on the range end
    // says nothing about whether more lines exist.
    if (!rangeDone && !capHit) sawEof = true
  } finally {
    lines.close()
    stream.destroy()
  }

  return {
    text: kept.join(""),
    capHit,
    sawEof,
    lastLine: lineNo,
    lastReturnedLine: kept.length > 0 ? startLine + kept.length - 1 : 0,
  }
}

export async function runReadFile(
  ctx: AuditToolContext,
  input: { path: string; startLine?: number; endLine?: number },
): Promise<string> {
  let absPath: string
  try {
    absPath = resolveInsideRepo(ctx.repoRoot, input.path)
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }

  const startLine = Math.max(1, input.startLine ?? 1)
  const endLine = input.endLine ?? startLine + 600
  if (endLine < startLine) {
    return failure(`endLine (${endLine}) is before startLine (${startLine}).`)
  }

  try {
    const result = await readFileRange(absPath, startLine, endLine, DEFAULT_OUTPUT_CAP_BYTES)
    if (result.text.length === 0) {
      return result.sawEof
        ? failure(
            `no lines in range ${startLine}-${endLine}; the file has ${result.lastLine} line(s).`,
          )
        : failure(`no lines in range ${startLine}-${endLine}.`)
    }
    const header = `# ${input.path} (lines ${startLine}-${result.lastReturnedLine})\n`
    const body = truncateOutput(header + result.text)
    // The internal read cap and the outer output cap are separate, so say
    // explicitly when the *range* was cut short: a header that reads
    // "lines 1-88" while the requested range was 1-600 looks complete.
    return result.capHit
      ? `${body}\n\n[more lines exist but were not read: this tool stops at ~${DEFAULT_OUTPUT_CAP_BYTES} bytes per call. Request the next range with startLine=${result.lastReturnedLine + 1}.]`
      : body
  } catch (error) {
    return failure(`could not read "${input.path}": ${describeError(error)}`)
  }
}

// ---------------------------------------------------------------------------
// grep
// ---------------------------------------------------------------------------

export async function runGrep(
  ctx: AuditToolContext,
  input: { pattern: string; glob?: string; path?: string },
): Promise<string> {
  // Always pass a search path: without one, ripgrep reads stdin and never
  // returns (the process has no input to close), which is how an "rg timed out"
  // turns into a wasted agent step. Relative so results print as repo-relative
  // paths, which is what evidence should cite.
  let searchPath = "."
  if (input.path) {
    try {
      searchPath = path.relative(ctx.repoRoot, resolveInsideRepo(ctx.repoRoot, input.path)) || "."
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error))
    }
  }

  const args = [
    "--line-number",
    "--no-heading",
    "--color",
    "never",
    // Long minified/generated lines would otherwise dominate the output.
    "--max-columns",
    "240",
    "--max-columns-preview",
    "-e",
    input.pattern,
  ]
  if (input.glob) args.push("-g", input.glob)
  args.push(searchPath)

  const result = await execute("rg", args, ctx.repoRoot)
  if (!result.ok) {
    // rg exits 1 for "no matches", which is a valid answer rather than a tool
    // error — only report it as an error when rg itself failed to run.
    if (result.exitCode === 1) return "No matches."
    return failure(`rg failed: ${result.output || `exit code ${result.exitCode}`}`)
  }
  if (!result.output.trim()) return "No matches."
  return truncateOutput(result.output.replace(/^\.\//gm, ""))
}

// ---------------------------------------------------------------------------
// list_dir
// ---------------------------------------------------------------------------

export async function runListDir(ctx: AuditToolContext, input: { path?: string }): Promise<string> {
  let absPath: string
  try {
    absPath = resolveInsideRepo(ctx.repoRoot, input.path ?? ".")
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }

  try {
    const entries = await readdir(absPath, { withFileTypes: true })
    if (entries.length === 0) return `(empty directory: ${input.path ?? "."})`

    const lines = entries
      .map((entry) => {
        const kind = entry.isDirectory() ? "dir " : entry.isSymbolicLink() ? "link" : "file"
        return `${kind} ${entry.name}${entry.isDirectory() ? "/" : ""}`
      })
      .sort((a, b) => {
        const aDir = a.startsWith("dir") ? 0 : 1
        const bDir = b.startsWith("dir") ? 0 : 1
        return aDir - bDir || a.localeCompare(b)
      })
    return truncateOutput(`${input.path ?? "."}:\n${lines.join("\n")}`)
  } catch (error) {
    return failure(`could not list "${input.path ?? "."}": ${describeError(error)}`)
  }
}

// ---------------------------------------------------------------------------
// run_command
// ---------------------------------------------------------------------------

/**
 * The whole allowlist, with per-command argument rules.
 *
 * Read-only by construction:
 * - `rg`, `ls`, `cat` only read.
 * - `git` is restricted to `log`/`diff`/`status`; `add`/`commit`/`push`/`checkout`
 *   are absent because several audit pods share this working tree — a stray
 *   commit or checkout would destroy another pod's uncommitted work.
 * - `curl` is read-only only with the flags below; write-shaped flags (`-X`,
 *   `-d`, `-F`, `-o`, cookie jars, `-K` config files) are rejected explicitly.
 *   curl's flag surface is too open to allowlist exhaustively, so this is the
 *   one place a denylist is used inside an allowlisted command.
 * - `pkill` is allowed (the audit spec calls for it) but deliberately NOT
 *   advertised in the tool description: a model told that pkill is available
 *   will eventually use it, and the `next dev` process is shared with every
 *   other audit group. It stays for an operator or a future run that started its
 *   own server and must clean up; the shared server must be left alone.
 *
 * Deliberately absent: `npm`/`npx`/`yarn`/`pnpm` (a concurrent `npm test`
 * corrupts the shared test database), any editor, and anything that writes.
 */
const CURL_WRITE_FLAGS = new Set([
  "-X",
  "--request",
  "-d",
  "--data",
  "--data-raw",
  "--data-binary",
  "--data-urlencode",
  "-F",
  "--form",
  "-T",
  "--upload-file",
  "-o",
  "--output",
  "-O",
  "--remote-name",
  "-c",
  "--cookie-jar",
  "-K",
  "--config",
])

type CommandRule = (args: string[]) => string | null

const COMMAND_ALLOWLIST: Record<string, CommandRule> = {
  rg: () => null,
  ls: () => null,
  cat: () => null,
  curl: (args) => {
    const bad = args.find((arg) => CURL_WRITE_FLAGS.has(arg.split("=")[0]))
    return bad ? `curl flag ${bad} can write or mutate; the audit only needs read-only GETs.` : null
  },
  git: (args) => {
    const sub = args[0]
    if (!sub || !["log", "diff", "status"].includes(sub)) {
      return `git "${sub ?? ""}" is not allowed; the audit may only use git log, git diff, git status.`
    }
    return null
  },
  pkill: (args) => {
    const pattern = args.join(" ")
    if (args[0] !== "-f" || !/next(-| )?(dev|server)/.test(pattern)) {
      return 'pkill is limited to the dev server, e.g. pkill -f "next dev". Other processes are out of scope.'
    }
    return null
  },
}

const ALLOWED_COMMAND_NAMES = Object.keys(COMMAND_ALLOWLIST)

/** Exposed so the self-test can assert rejections without executing anything. */
export function checkCommandPolicy(command: string, args: string[]): string | null {
  const rule = COMMAND_ALLOWLIST[command]
  if (!rule) {
    return `"${command}" is not on the audit allowlist. Allowed: ${ALLOWED_COMMAND_NAMES.join(", ")}. This harness cannot write to the repo, commit, push, or run the test suite: other audit groups share this working tree and the test database.`
  }
  const reason = rule(args)
  return reason ? `Command rejected: ${reason}` : null
}

type ExecResult = { ok: boolean; output: string; exitCode: number | null }

function execute(command: string, args: string[], cwd: string): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        cwd,
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: MAX_EXEC_BUFFER_BYTES,
        encoding: "utf8",
        // Belt and braces: execFile does not spawn a shell by default, and we
        // never want metacharacters in an agent-supplied argument to be
        // interpreted. Keep this explicit so a future edit cannot quietly
        // reintroduce shell parsing.
        shell: false,
      },
      (error, stdout, stderr) => {
        const output = [stdout, stderr].filter((part) => part && part.length > 0).join("\n")
        if (!error) {
          resolve({ ok: true, output, exitCode: 0 })
          return
        }
        const code = (error as NodeJS.ErrnoException).code
        if (code === "ENOENT") {
          resolve({ ok: false, output: `command not found: ${command}`, exitCode: null })
          return
        }
        if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
          resolve({
            ok: true,
            output: `${output}\n\n[output exceeded the ${MAX_EXEC_BUFFER_BYTES}-byte buffer; it was cut off. Narrow the command.]`,
            exitCode: 0,
          })
          return
        }
        const timedOut = (error as { killed?: boolean }).killed === true
        resolve({
          ok: false,
          output: timedOut ? `command timed out after ${COMMAND_TIMEOUT_MS}ms` : output,
          exitCode: typeof error.code === "number" ? error.code : null,
        })
      },
    )
  })
}

export async function runCommand(
  ctx: AuditToolContext,
  input: { command: string; args?: string[] },
): Promise<string> {
  const args = input.args ?? []
  const rejection = checkCommandPolicy(input.command, args)
  if (rejection) return failure(rejection)

  const result = await execute(input.command, args, ctx.repoRoot)
  const rendered = `$ ${[input.command, ...args].join(" ")}\n(exit ${result.exitCode ?? "n/a"})\n${result.output}`
  if (!result.ok) return failure(rendered)
  if (!result.output.trim()) return `${rendered}\n(no output)`
  return truncateOutput(rendered)
}

// ---------------------------------------------------------------------------
// http_get / login_and_fetch
// ---------------------------------------------------------------------------

/**
 * The agents audit the running app, so the network tools are pinned to the
 * configured origin. Three benefits: no outbound requests from a dev tool, no
 * accidental hits on a staging deployment, and the SSRF-shaped question ("what
 * else can this tool reach?") has a one-line answer.
 */
function resolveLocalUrl(ctx: AuditToolContext, requested: string): URL {
  const base = new URL(ctx.baseUrl)
  const url =
    requested.startsWith("http://") || requested.startsWith("https://")
      ? new URL(requested)
      : new URL(requested.startsWith("/") ? requested : `/${requested}`, base)
  if (url.origin !== base.origin) {
    throw new Error(
      `only ${base.origin} is reachable from this tool (asked for ${url.origin}). Pass a path like "/teacher/classes" or a URL on ${base.origin}.`,
    )
  }
  return url
}

async function readBody(response: Response): Promise<string> {
  const body = await response.text()
  return truncateOutput(body, HTTP_BODY_CAP_BYTES)
}

export async function runHttpGet(ctx: AuditToolContext, input: { path: string }): Promise<string> {
  let url: URL
  try {
    url = resolveLocalUrl(ctx, input.path)
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }

  try {
    // Redirects are reported rather than followed: a 307 to /login is itself
    // the finding ("this page is unreachable while signed in").
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000) })
    const location = response.headers.get("location")
    const head = `GET ${url.pathname}${url.search} -> ${response.status} ${response.statusText}${location ? ` (location: ${location})` : ""}`
    const body = await readBody(response)
    return `${head}\n\n${body}`
  } catch (error) {
    return failure(`GET ${url.toString()} failed: ${describeError(error)}`)
  }
}

type Session = { cookie: string; user: string }

/**
 * Signed-in sessions, cached per email for the life of the run.
 *
 * Two reasons: repeated logins from ten concurrent agents would trip
 * `lib/login-rate-limit.ts` and turn every fetch after that into a 429, and the
 * login round trip is pure overhead once the signed cookie is in hand.
 *
 * The cache key is the credential pair, not the email. Keying on email alone
 * means a later call with a wrong password silently reuses an earlier session
 * for that address — a login failure would look like a success, which is
 * exactly the class of lie this audit is meant to find.
 */
export class SessionCache {
  private sessions = new Map<string, Promise<Session>>()

  get(email: string, password: string, login: () => Promise<Session>): Promise<Session> {
    const key = `${email}\u0000${password}`
    const existing = this.sessions.get(key)
    if (existing) return existing
    const pending = login().catch((error: unknown) => {
      // Drop a failed login so the next attempt can retry rather than replay
      // the same rejection forever.
      this.sessions.delete(key)
      throw error
    })
    this.sessions.set(key, pending)
    return pending
  }
}

async function login(baseUrl: string, email: string, password: string): Promise<Session> {
  const response = await fetch(new URL("/api/auth/login", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`login for ${email} failed with HTTP ${response.status}: ${text.slice(0, 300)}`)
  }

  const setCookies =
    typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : []
  const sessionCookie = setCookies
    .map((value) => value.split(";")[0])
    .find((value) => value.startsWith("auth-user="))
  if (!sessionCookie) {
    throw new Error(`login for ${email} returned no auth-user cookie`)
  }

  let user = email
  try {
    const parsed = JSON.parse(text) as { user?: { email?: string; role?: string } }
    if (parsed.user?.role) user = `${parsed.user.email ?? email} (${parsed.user.role})`
  } catch {
    // A non-JSON body is not fatal; the cookie is what the fetch needs.
  }
  return { cookie: sessionCookie, user }
}

export async function runLoginAndFetch(
  ctx: AuditToolContext,
  input: { email: string; password: string; path: string },
): Promise<string> {
  let url: URL
  try {
    url = resolveLocalUrl(ctx, input.path)
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }

  let session: Session
  try {
    session = await ctx.sessions.get(input.email, input.password, () =>
      login(ctx.baseUrl, input.email, input.password),
    )
  } catch (error) {
    return failure(describeError(error))
  }

  try {
    const response = await fetch(url, {
      headers: { cookie: session.cookie },
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    })
    const location = response.headers.get("location")
    const head = `GET ${url.pathname}${url.search} as ${session.user} -> ${response.status} ${response.statusText}${location ? ` (location: ${location})` : ""}`
    const body = await readBody(response)
    return `${head}\n\n${body}`
  } catch (error) {
    return failure(`GET ${url.toString()} as ${session.user} failed: ${describeError(error)}`)
  }
}

// ---------------------------------------------------------------------------
// LangChain tool wrappers
// ---------------------------------------------------------------------------

export type AuditToolHandlers = {
  read_file: (input: { path: string; startLine?: number; endLine?: number }) => Promise<string>
  grep: (input: { pattern: string; glob?: string; path?: string }) => Promise<string>
  list_dir: (input: { path?: string }) => Promise<string>
  run_command: (input: { command: string; args?: string[] }) => Promise<string>
  http_get: (input: { path: string }) => Promise<string>
  login_and_fetch: (input: { email: string; password: string; path: string }) => Promise<string>
}

/** Plain async handlers — the self-test drives these directly, with no model. */
export function createAuditHandlers(ctx: AuditToolContext): AuditToolHandlers {
  return {
    read_file: (input) => runReadFile(ctx, input),
    grep: (input) => runGrep(ctx, input),
    list_dir: (input) => runListDir(ctx, input),
    run_command: (input) => runCommand(ctx, input),
    http_get: (input) => runHttpGet(ctx, input),
    login_and_fetch: (input) => runLoginAndFetch(ctx, input),
  }
}

/** Read-only repo inspection, shared by both groups. */
const pathArg = z
  .string()
  .describe("Path relative to the repository root, e.g. 'app/(dashboard)/teacher/page.tsx'.")

export function createAuditTools(ctx: AuditToolContext) {
  const handlers = createAuditHandlers(ctx)

  return [
    tool(
      ({ path: filePath, startLine, endLine }) =>
        handlers.read_file({ path: filePath, startLine, endLine }),
      {
        name: "read_file",
        description:
          "Read a file from the repository, optionally limited to a line range. Output is line-numbered and truncated past ~30KB, so pass startLine/endLine for large files instead of reading them whole.",
        schema: z.object({
          path: pathArg,
          startLine: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("First line to return (1-based)."),
          endLine: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("Last line to return (inclusive)."),
        }),
      },
    ),
    tool(
      ({ pattern, glob, path: searchPath }) => handlers.grep({ pattern, glob, path: searchPath }),
      {
        name: "grep",
        description:
          "Regex search the repository with ripgrep. Returns 'path:line:content'. Use it to find where a control, label, or API route is implemented. Output is truncated past ~30KB.",
        schema: z.object({
          pattern: z.string().describe("Ripgrep regex, e.g. 'onClick|onPress' or 'TODO'."),
          glob: z.string().optional().describe("Optional file glob, e.g. 'app/**/*.tsx'."),
          path: pathArg.optional().describe("Optional directory or file to search within."),
        }),
      },
    ),
    tool(({ path: dirPath }) => handlers.list_dir({ path: dirPath }), {
      name: "list_dir",
      description: "List a directory in the repository (dirs first, suffixed with '/').",
      schema: z.object({
        path: pathArg
          .optional()
          .describe("Directory relative to the repo root. Defaults to the root."),
      }),
    }),
    tool(({ command, args }) => handlers.run_command({ command, args }), {
      name: "run_command",
      description:
        "Run one allowlisted shell command. Allowed: rg, ls, cat, curl (read-only), git log, git diff, git status. A dev server is shared with other audit groups: never start a second one and never stop the running one. Anything else is rejected, including npm/npx (a concurrent `npm test` corrupts the shared test database).",
      schema: z.object({
        command: z.string().describe("The executable name, e.g. 'git'."),
        args: z
          .array(z.string())
          .optional()
          .describe("Arguments, passed literally (no shell interpolation)."),
      }),
    }),
    tool(({ path: requestPath }) => handlers.http_get({ path: requestPath }), {
      name: "http_get",
      description:
        "GET a path on the running app without a session and return the status plus body. Use it to check which routes redirect to login and what an anonymous visitor sees. Redirects are reported, not followed.",
      schema: z.object({
        path: z.string().describe('Path like "/api/health" or "/teacher".'),
      }),
    }),
    tool(
      ({ email, password, path: requestPath }) =>
        handlers.login_and_fetch({ email, password, path: requestPath }),
      {
        name: "login_and_fetch",
        description:
          "Log in as a seeded account and GET a path with the session cookie, returning the status plus the rendered HTML. This is how you reach anything behind auth — use it for every /teacher and /student page. Sessions are cached per credential for the run.",
        schema: z.object({
          email: z.string().describe("Seeded account email, e.g. 'demo.teacher@school.edu'."),
          password: z.string().describe("That account's password."),
          path: z.string().describe('Path to fetch, e.g. "/teacher/classes".'),
        }),
      },
    ),
  ]
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause
    return cause instanceof Error ? `${error.message} (${cause.message})` : error.message
  }
  return String(error)
}
