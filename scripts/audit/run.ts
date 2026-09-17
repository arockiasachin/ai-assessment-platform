import "dotenv/config"

import { ChatOpenAI } from "@langchain/openai"
import { createAgent, toolCallLimitMiddleware, type BaseMessage } from "langchain"

import { GROUPS, buildSystemPrompt, type AuditAgent, type AuditGroupId } from "./groups"
import {
  type AgentRun,
  type ReportMeta,
  parseFindings,
  writeGroupFile,
  writeReport,
} from "./report"
import { SessionCache, createAuditTools } from "./tools"

/**
 * Entry point for the LangChain audit harness.
 *
 *   npm run audit:langchain
 *   npm run audit:langchain -- --group=teacher --concurrency=2 --max-steps=10
 *
 * Writes two things: a timestamped run report under `scripts/audit/`, and — when
 * a group's full five agents ran — that group's file under `docs/audit/`, in the
 * repo-wide convention the dashboard compares against the native groups.
 *
 * The harness never starts or stops the dev server: other audit groups share
 * port 3000 and the .next directory on this checkout, and a second `next dev`
 * would corrupt it. It probes the server, reports what it found, and leaves it
 * alone.
 */

const DEFAULT_BASE_URL = "http://localhost:3000"
const DEFAULT_CONCURRENCY = 3
// 14 was the first default and it was too small: on the first real run, 8 of 10
// agents hit the cap before writing up. 24 gives a five-route agent room to log
// in, fetch each route and follow one or two leads without the cap dominating
// the result. Still tunable, because cost is the owner's call.
const DEFAULT_MAX_STEPS = 24
const DEFAULT_AGENT_TIMEOUT_MS = 10 * 60 * 1000

// Match the project's own provider defaults (lib/llm/providers/deepseek.ts and
// lib/llm/env.ts) rather than inventing a second set of conventions.
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com"
const DEFAULT_DEEPSEEK_MODEL = "deepseek-flash"

type Options = {
  groupIds: AuditGroupId[]
  concurrency: number
  maxSteps: number
  baseUrl: string
  outDir: string
  groupFilesDir: string
  writeGroupFiles: boolean
  timeoutMs: number
  agentFilter: string[]
  listOnly: boolean
}

function usage(): string {
  return [
    "LangChain audit harness",
    "",
    "Usage: npm run audit:langchain -- [options]",
    "",
    "Options:",
    "  --group=<teacher|student|all>  Which group(s) to run (default: all)",
    "  --agent=<id>                   Only run this agent id; repeatable",
    "  --concurrency=<n>              Agents in flight at once (default: 3)",
    "  --max-steps=<n>                Max tool calls per agent (default: 14)",
    "  --base-url=<url>               Running app (default: http://localhost:3000)",
    "  --out=<dir>                    Report directory (default: scripts/audit)",
    "  --group-files-dir=<dir>        Shared group-file directory (default: docs/audit)",
    "  --no-group-files               Do not write docs/audit/<domain>-langchain.md",
    "  --timeout-ms=<n>               Per-agent wall clock limit (default: 600000)",
    "  --list                         List agents and exit",
    "  --help                         Show this message",
    "",
    "Required environment:",
    "  DEEPSEEK_API_KEY               DeepSeek key (no default; the run stops without it)",
    "  DEEPSEEK_BASE_URL              Optional, default https://api.deepseek.com",
    "  DEEPSEEK_MODEL                 Optional, default deepseek-flash",
  ].join("\n")
}

function parseOptions(argv: string[]): Options | { error: string } {
  const options: Options = {
    groupIds: GROUPS.map((group) => group.id),
    concurrency: DEFAULT_CONCURRENCY,
    maxSteps: DEFAULT_MAX_STEPS,
    baseUrl: DEFAULT_BASE_URL,
    outDir: "scripts/audit",
    groupFilesDir: "docs/audit",
    writeGroupFiles: true,
    timeoutMs: DEFAULT_AGENT_TIMEOUT_MS,
    agentFilter: [],
    listOnly: false,
  }

  const numeric = (name: string, raw: string, min: number): number | { error: string } => {
    const value = Number(raw)
    if (!Number.isFinite(value) || value < min || !Number.isInteger(value)) {
      return { error: `${name} must be an integer >= ${min}, received "${raw}".` }
    }
    return value
  }

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") return { error: usage() }
    if (arg === "--list") {
      options.listOnly = true
      continue
    }
    if (arg === "--no-group-files") {
      options.writeGroupFiles = false
      continue
    }
    const [key, ...rest] = arg.split("=")
    const value = rest.join("=")
    switch (key) {
      case "--group": {
        const raw = value.trim().toLowerCase()
        if (raw === "all") {
          options.groupIds = GROUPS.map((group) => group.id)
        } else if (raw === "teacher" || raw === "student") {
          options.groupIds = [raw]
        } else {
          return { error: `--group must be teacher, student or all (received "${value}").` }
        }
        break
      }
      case "--agent":
        if (!value.trim()) return { error: "--agent needs an agent id." }
        options.agentFilter.push(value.trim())
        break
      case "--concurrency": {
        const parsed = numeric("--concurrency", value, 1)
        if (typeof parsed !== "number") return parsed
        options.concurrency = parsed
        break
      }
      case "--max-steps": {
        const parsed = numeric("--max-steps", value, 1)
        if (typeof parsed !== "number") return parsed
        options.maxSteps = parsed
        break
      }
      case "--timeout-ms": {
        const parsed = numeric("--timeout-ms", value, 1000)
        if (typeof parsed !== "number") return parsed
        options.timeoutMs = parsed
        break
      }
      case "--base-url":
        options.baseUrl = value.trim().replace(/\/+$/, "")
        break
      case "--out":
        options.outDir = value.trim()
        break
      case "--group-files-dir":
        options.groupFilesDir = value.trim()
        break
      default:
        return { error: `Unknown option "${arg}".\n\n${usage()}` }
    }
  }

  try {
    const url = new URL(options.baseUrl)
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("not http(s)")
  } catch {
    return { error: `--base-url must be an http(s) URL, received "${options.baseUrl}".` }
  }

  return options
}

function selectedAgents(options: Options): AuditAgent[] {
  const allowed = new Set(options.groupIds)
  const agents = GROUPS.filter((group) => allowed.has(group.id)).flatMap((group) => group.agents)
  if (options.agentFilter.length === 0) return agents
  const wanted = new Set(options.agentFilter)
  return agents.filter((agent) => wanted.has(agent.id))
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

/**
 * Fail before any agent starts if the key is missing.
 *
 * This is deliberately a plain message and a non-zero exit rather than a thrown
 * error: a stack trace from deep inside a provider SDK tells the owner nothing
 * about what to fix, and a run that continues without a key would write an
 * empty report that looks like "no findings" — the worst possible outcome for
 * an audit.
 */
function preflight():
  | { ok: true; apiKey: string; baseModelUrl: string; model: string }
  | { ok: false; message: string } {
  const apiKey = (process.env.DEEPSEEK_API_KEY ?? "").trim()
  const baseModelUrl = (process.env.DEEPSEEK_BASE_URL ?? "").trim() || DEFAULT_DEEPSEEK_BASE_URL
  const model = (process.env.DEEPSEEK_MODEL ?? "").trim() || DEFAULT_DEEPSEEK_MODEL

  if (!apiKey) {
    return {
      ok: false,
      message: [
        "Missing DEEPSEEK_API_KEY.",
        "",
        `The LangChain audit harness calls DeepSeek directly (${baseModelUrl}, model ${model}).`,
        "Set the key and re-run:",
        "",
        '  export DEEPSEEK_API_KEY="sk-..."',
        "  npm run audit:langchain",
        "",
        "Or add DEEPSEEK_API_KEY=... to .env, which this script loads.",
        "",
        "Nothing was run and no report was written.",
      ].join("\n"),
    }
  }

  try {
    const url = new URL(baseModelUrl)
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("not http(s)")
  } catch {
    return {
      ok: false,
      message: `DEEPSEEK_BASE_URL is not a valid http(s) URL: "${baseModelUrl}".`,
    }
  }

  return { ok: true, apiKey, baseModelUrl, model }
}

/**
 * Informational only. The harness does not manage the server — a run that needs
 * one is a run where the agents start it themselves, per the system prompt.
 */
async function probeServer(baseUrl: string): Promise<string> {
  try {
    const response = await fetch(new URL("/api/health", baseUrl), {
      redirect: "manual",
      signal: AbortSignal.timeout(4000),
    })
    return `dev server at ${baseUrl} responded ${response.status}`
  } catch (error) {
    return `dev server at ${baseUrl} did not respond (${error instanceof Error ? error.message : String(error)}); agents will start one if needed`
  }
}

// ---------------------------------------------------------------------------
// Agent execution
// ---------------------------------------------------------------------------

function textOf(message: BaseMessage): string {
  const content = message.content
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part
        if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
          return part.text
        }
        return ""
      })
      .join("")
  }
  return ""
}

const CAP_NOTICE = "call limit exceeded"

// Shared for the whole process: ten agents logging in repeatedly would trip the
// login throttle and turn every fetch after that into a 429.
const sharedSessions = new SessionCache()

async function runAgent(agent: AuditAgent, model: ChatOpenAI, options: Options): Promise<AgentRun> {
  const startedAt = Date.now()
  const base: Omit<
    AgentRun,
    "status" | "toolCalls" | "blockedCalls" | "modelTurns" | "findings" | "durationMs"
  > = {
    agentId: agent.id,
    agentTitle: agent.title,
    group: agent.groupId,
  }

  try {
    const tools = createAuditTools({
      repoRoot: process.cwd(),
      baseUrl: options.baseUrl,
      sessions: sharedSessions,
    })

    const auditAgent = createAgent({
      model,
      tools,
      systemPrompt: buildSystemPrompt(agent, {
        baseUrl: options.baseUrl,
        maxSteps: options.maxSteps,
      }),
      middleware: [
        // "continue" rather than "error": the agent is told it is out of calls
        // and gets one more turn to write up what it already saw, so a capped
        // agent still contributes findings instead of throwing them away.
        toolCallLimitMiddleware({ runLimit: options.maxSteps, exitBehavior: "continue" }),
      ],
    })

    const result = await auditAgent.invoke(
      {
        messages: [
          {
            role: "user",
            content: `Audit your scope now. Start by logging in, then work through your routes. Emit your findings block before you run out of tool calls.`,
          },
        ],
      },
      {
        // Each tool call costs two graph steps (model + tools), so the graph
        // recursion limit has to sit above the tool-call budget or LangGraph
        // kills a well-behaved agent that is simply using its allowance.
        recursionLimit: options.maxSteps * 3 + 10,
        signal: AbortSignal.timeout(options.timeoutMs),
      },
    )

    const messages = result.messages ?? []
    let toolCalls = 0
    let blockedCalls = 0
    let modelTurns = 0
    let capped = false
    let finalText = ""

    for (const message of messages) {
      const type = message.getType()
      if (type === "tool") {
        // A ToolMessage the cap middleware synthesised is a refused call, not
        // work the agent did. Keeping the two apart is what makes "the agent
        // gave up" legible in the report.
        if (textOf(message).toLowerCase().includes(CAP_NOTICE)) {
          capped = true
          blockedCalls += 1
        } else {
          toolCalls += 1
        }
      } else if (type === "ai") {
        modelTurns += 1
        const text = textOf(message)
        if (text.trim()) finalText = text
      }
    }

    const parsed = parseFindings(finalText, {
      group: agent.groupId,
      agentId: agent.id,
      agent: agent.title,
    })

    return {
      ...base,
      status: capped ? "capped" : "completed",
      toolCalls,
      blockedCalls,
      modelTurns,
      findings: parsed.findings,
      parseError: parsed.parseError,
      notes: parsed.notes,
      durationMs: Date.now() - startedAt,
    }
  } catch (error) {
    return {
      ...base,
      status: "failed",
      toolCalls: 0,
      blockedCalls: 0,
      modelTurns: 0,
      findings: [],
      error: describeError(error),
      durationMs: Date.now() - startedAt,
    }
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const name = error.name && error.name !== "Error" ? `${error.name}: ` : ""
    return `${name}${error.message}`
  }
  return String(error)
}

/**
 * Run tasks with a bounded pool. A worker that rejects would lose its slot, so
 * `runAgent` converts every failure into a result object; `Promise.all` here is
 * therefore expected to always resolve.
 */
async function runPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const parsedOptions = parseOptions(process.argv.slice(2))
  if ("error" in parsedOptions) {
    // --help prints usage and exits 0; a bad option exits 1.
    const isHelp = process.argv.includes("--help") || process.argv.includes("-h")
    process.stdout.write(`${parsedOptions.error}\n`)
    process.exitCode = isHelp ? 0 : 1
    return
  }
  const options = parsedOptions

  const agents = selectedAgents(options)
  if (agents.length === 0) {
    process.stderr.write("No agents selected. Use --list to see the available agent ids.\n")
    process.exitCode = 1
    return
  }

  if (options.listOnly) {
    for (const group of GROUPS) {
      process.stdout.write(`${group.name}: ${group.description}\n`)
      for (const agent of group.agents) {
        process.stdout.write(`  ${agent.id}  [${agent.routes.join(", ")}]\n`)
      }
    }
    return
  }

  const preflightResult = preflight()
  if (!preflightResult.ok) {
    // Two blank lines: this is the whole output of a failed run, and it should
    // read as a message rather than as part of a log.
    process.stderr.write(`\n${preflightResult.message}\n\n`)
    process.exitCode = 1
    return
  }

  const model = new ChatOpenAI({
    model: preflightResult.model,
    apiKey: preflightResult.apiKey,
    temperature: 0,
    // DeepSeek serves Chat Completions, not OpenAI's Responses API. The current
    // default is already `false`, but pinning it means a future langchain
    // release cannot silently redirect this provider at a route DeepSeek lacks.
    useResponsesApi: false,
    configuration: { baseURL: preflightResult.baseModelUrl },
    maxRetries: 2,
    timeout: 120_000,
  })

  const serverStatus = await probeServer(options.baseUrl)
  process.stdout.write(
    `LangChain audit: ${agents.length} agent(s), group(s) ${options.groupIds.join(", ")}, concurrency ${options.concurrency}, max ${options.maxSteps} tool calls each.\n`,
  )
  process.stdout.write(`Model: ${preflightResult.model} at ${preflightResult.baseModelUrl}\n`)
  process.stdout.write(`Server: ${serverStatus}\n\n`)

  const startedAt = Date.now()
  const runs = await runPool(agents, options.concurrency, async (agent, index) => {
    process.stdout.write(`[${index + 1}/${agents.length}] start ${agent.id}\n`)
    const run = await runAgent(agent, model, options)
    process.stdout.write(
      `[${index + 1}/${agents.length}] ${run.status} ${agent.id} — ${run.toolCalls} tool calls${run.blockedCalls > 0 ? ` (${run.blockedCalls} refused at the cap)` : ""}, ${run.findings.length} finding(s), ${(run.durationMs / 1000).toFixed(1)}s${run.error ? ` — ${run.error}` : ""}\n`,
    )
    return run
  })

  const meta: ReportMeta = {
    generatedAt: new Date(),
    baseUrl: options.baseUrl,
    model: preflightResult.model,
    baseModelUrl: preflightResult.baseModelUrl,
    concurrency: options.concurrency,
    maxSteps: options.maxSteps,
    groupIds: options.groupIds,
  }

  const { markdownPath, jsonPath } = await writeReport(runs, meta, options.outDir)

  // Write the shared group files only when a group's full five agents ran.
  // A filtered run must leave the file at "not-started": claiming the group
  // reported when half of it never ran would corrupt the native-vs-LangChain
  // coverage comparison, which is the whole point of the exercise.
  const groupFilePaths: string[] = []
  const groupFileSkips: string[] = []
  if (options.writeGroupFiles) {
    for (const group of GROUPS) {
      if (!options.groupIds.includes(group.id)) continue
      const groupRuns = runs.filter((run) => run.group === group.id)
      if (groupRuns.length !== group.agents.length) {
        groupFileSkips.push(
          `${group.id}: only ${groupRuns.length}/${group.agents.length} agents ran, so docs/audit/${group.id}-langchain.md was left untouched`,
        )
        continue
      }
      groupFilePaths.push(await writeGroupFile(group.id, groupRuns, options.groupFilesDir))
    }
  }

  const completed = runs.filter((run) => run.status === "completed").length
  const capped = runs.filter((run) => run.status === "capped").length
  const failed = runs.filter((run) => run.status === "failed").length
  const toolCalls = runs.reduce((total, run) => total + run.toolCalls, 0)
  const blockedCalls = runs.reduce((total, run) => total + run.blockedCalls, 0)
  const findings = runs.flatMap((run) => run.findings)
  const count = (severity: string) =>
    findings.filter((finding) => finding.severity === severity).length

  process.stdout.write(
    [
      "",
      "--- summary ---",
      `agents: ${runs.length} (completed ${completed}, capped ${capped}, failed ${failed})`,
      `tool calls: ${toolCalls} (${blockedCalls} refused at the step cap)`,
      `findings: ${findings.length} (blocker ${count("blocker")}, major ${count("major")}, minor ${count("minor")})`,
      `elapsed: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
      `report: ${markdownPath}`,
      `json:   ${jsonPath}`,
      ...groupFilePaths.map((filePath) => `group file: ${filePath}`),
      ...groupFileSkips.map((message) => `skipped: ${message}`),
      failed > 0
        ? "some agents failed; their runs are recorded in the report and the rest were not lost"
        : "",
      "",
    ]
      .filter((line) => line !== "")
      .join("\n"),
  )
}

main().catch((error: unknown) => {
  process.stderr.write(`Audit harness failed: ${describeError(error)}\n`)
  process.exitCode = 1
})
