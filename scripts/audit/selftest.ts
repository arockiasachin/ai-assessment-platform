import "dotenv/config"

import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { FINDING_CATEGORIES, GROUPS } from "./groups"
import { parseFindings, renderGroupFile, type AgentRun, type Finding } from "./report"
import { SessionCache, checkCommandPolicy, createAuditHandlers, truncateOutput } from "./tools"

const execFileAsync = promisify(execFile)

/**
 * Direct verification of the harness, with no model involved.
 *
 * The agent loop cannot be exercised without DEEPSEEK_API_KEY, but everything
 * around it can be: this script calls the same tool handlers `createAuditTools`
 * wraps, parses canned agent output through the same findings parser, and
 * validates the generated group file with the repo's own Prettier and — when
 * that module is available — the aggregator's parser.
 *
 *   npx --yes tsx scripts/audit/selftest.ts
 *
 * Exit code 0 when every check passes, 1 otherwise.
 */

const BASE_URL = (process.env.AUDIT_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "")

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1
    process.stdout.write(`PASS  ${name}\n`)
  } else {
    failed += 1
    process.stdout.write(
      `FAIL  ${name}${detail ? `\n      ${detail.replace(/\n/g, "\n      ")}` : ""}\n`,
    )
  }
}

function excerpt(text: string, length = 200): string {
  return text.slice(0, length)
}

async function serverReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/api/health`, {
      redirect: "manual",
      signal: AbortSignal.timeout(4000),
    })
    return response.status === 200
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  const handlers = createAuditHandlers({
    repoRoot: process.cwd(),
    baseUrl: BASE_URL,
    sessions: new SessionCache(),
  })

  process.stdout.write(`Tool-layer self-test against ${BASE_URL}\n\n`)

  // --- truncation reporting -------------------------------------------------
  const long = "abcdefghij".repeat(5000)
  const truncated = truncateOutput(long, 1000)
  check("truncateOutput cuts to the cap", Buffer.byteLength(truncated, "utf8") < 2000)
  check("truncateOutput says it truncated", truncated.includes("[truncated:"))
  const short = truncateOutput("hello", 1000)
  check("truncateOutput leaves short text intact", short === "hello")

  // --- list_dir -------------------------------------------------------------
  const root = await handlers.list_dir({})
  check(
    "list_dir lists the repo root",
    root.includes("package.json") && /^dir\s+app\//m.test(root),
    excerpt(root),
  )

  // --- read_file ------------------------------------------------------------
  const ranged = await handlers.read_file({ path: "package.json", startLine: 1, endLine: 4 })
  check(
    "read_file returns the requested range",
    ranged.includes('"name"') && !ranged.includes("prisma"),
    excerpt(ranged),
  )
  check("read_file numbers lines", /^# package\.json[\s\S]*1\t/m.test(ranged), excerpt(ranged))
  const escaped = await handlers.read_file({ path: "../../../etc/passwd" })
  check("read_file rejects paths outside the repo", escaped.startsWith("ERROR:"), excerpt(escaped))
  const capped = await handlers.read_file({ path: "CHANGELOG.md", endLine: 100000 })
  // CHANGELOG.md is ~116KB, so this must stop early and say so. Note the outer
  // `[truncated:` marker is not guaranteed here: the internal per-call cap and
  // the output cap are separate, and the header may land just under the latter.
  check(
    "read_file reports that a large range was cut short",
    capped.includes("more lines exist but were not read") &&
      /\(lines 1-\d+\)/.test(capped) &&
      !capped.includes("(lines 1-988)"),
    excerpt(capped, 300),
  )
  const resumed = await handlers.read_file({ path: "CHANGELOG.md", startLine: 1, endLine: 3 })
  check(
    "read_file narrows to a small range without a truncation notice",
    !resumed.includes("more lines exist but were not read") && resumed.includes("3\t"),
    excerpt(resumed),
  )

  // --- grep -----------------------------------------------------------------
  const found = await handlers.grep({ pattern: "SESSION_COOKIE_NAME", glob: "lib/**/*.ts" })
  check(
    "grep finds a known symbol with repo-relative paths",
    found.includes("lib/session.ts") && !found.includes(process.cwd()),
    excerpt(found),
  )
  // The token is built at runtime so the search does not match this very file,
  // which would otherwise make "no matches" untestable.
  const missingToken = `zzz-${Date.now()}-cannot-exist-zzz`
  const notFound = await handlers.grep({ pattern: missingToken })
  check("grep reports no matches cleanly", notFound === "No matches.", excerpt(notFound))

  // --- run_command policy ---------------------------------------------------
  // Asserted through the policy function, not by executing: the whole point is
  // that these never run.
  check(
    "rejects a destructive command",
    checkCommandPolicy("rm", ["-rf", "/tmp/x"]) !== null,
    String(checkCommandPolicy("rm", ["-rf", "/tmp/x"])),
  )
  check(
    "rejects git push",
    checkCommandPolicy("git", ["push"]) !== null,
    String(checkCommandPolicy("git", ["push"])),
  )
  check(
    "rejects the test suite",
    checkCommandPolicy("npm", ["test"]) !== null,
    String(checkCommandPolicy("npm", ["test"])),
  )
  check(
    "rejects a write-shaped curl",
    checkCommandPolicy("curl", ["-X", "POST", "http://localhost:3000/api/auth/login"]) !== null,
    String(checkCommandPolicy("curl", ["-X", "POST", "http://localhost:3000/api/auth/login"])),
  )
  check(
    "rejects pkill against a non-dev-server process",
    checkCommandPolicy("pkill", ["-f", "postgres"]) !== null,
    String(checkCommandPolicy("pkill", ["-f", "postgres"])),
  )
  check("allows git status", checkCommandPolicy("git", ["status", "--short"]) === null)
  check(
    "allows a read-only curl",
    checkCommandPolicy("curl", ["-s", "http://localhost:3000/api/health"]) === null,
  )
  check('allows pkill for "next dev"', checkCommandPolicy("pkill", ["-f", "next dev"]) === null)

  const status = await handlers.run_command({ command: "git", args: ["status", "--short"] })
  check("run_command executes an allowlisted command", status.includes("exit 0"), excerpt(status))
  const rejected = await handlers.run_command({ command: "npm", args: ["test"] })
  check(
    "run_command returns a readable rejection, not a crash",
    rejected.startsWith("ERROR:") && rejected.includes("allowlist"),
    excerpt(rejected),
  )

  // --- findings parsing -----------------------------------------------------
  const canned = [
    "I exercised /teacher/classes and /teacher/marks.",
    "",
    "<AUDIT_FINDINGS>",
    JSON.stringify([
      {
        title: "Export control does nothing",
        severity: "major",
        category: "dead-control",
        location: "/teacher/classes",
        evidence:
          "GET /teacher/classes returned 200; the Export button has no form action and no href.",
        whyItMatters:
          "A teacher cannot export the class list despite the control inviting them to.",
      },
    ]),
    "</AUDIT_FINDINGS>",
  ].join("\n")
  const parsed = parseFindings(canned, {
    group: "teacher",
    agentId: "teacher-structure",
    agent: "x",
  })
  check(
    "parseFindings reads the findings block",
    parsed.findings.length === 1 && !parsed.parseError,
    parsed.parseError,
  )
  check(
    "parseFindings captures category and location",
    parsed.findings[0]?.category === "dead-control" &&
      parsed.findings[0]?.location === "/teacher/classes",
  )
  check(
    "parseFindings keeps the narrative as notes",
    parsed.notes?.includes("exercised") === true,
    String(parsed.notes),
  )

  const badCategory = parseFindings(
    `<AUDIT_FINDINGS>${JSON.stringify([
      { title: "t", severity: "major", category: "vibes", location: "/x", evidence: "e" },
    ])}</AUDIT_FINDINGS>`,
    { group: "teacher", agentId: "a", agent: "x" },
  )
  check(
    "parseFindings drops a finding with an unknown category",
    badCategory.findings.length === 0 && Boolean(badCategory.parseError),
    badCategory.parseError,
  )

  const noBlock = parseFindings("I found nothing.", { group: "teacher", agentId: "a", agent: "x" })
  check(
    "parseFindings reports a missing block",
    noBlock.findings.length === 0 && noBlock.parseError?.includes("no <AUDIT_FINDINGS>") === true,
    noBlock.parseError,
  )

  const fenced = parseFindings(
    'Here:\n```json\n[{"title":"t","severity":"minor","category":"inconsistency","location":"/x","evidence":"e"}]\n```',
    { group: "student", agentId: "a", agent: "x" },
  )
  check(
    "parseFindings falls back to a fenced json block",
    fenced.findings.length === 1,
    fenced.parseError,
  )

  // --- group file, in the docs/audit convention -----------------------------
  const teacherGroup = GROUPS.find((group) => group.id === "teacher")
  if (!teacherGroup) throw new Error("no teacher group definition")

  const finding = (index: number): Finding => ({
    // A newline and a pipe: both are illegal in a table cell and must be
    // normalised by the renderer rather than reaching the parser.
    title: `Finding number ${index + 1}\nspans lines`,
    severity: index === 0 ? "blocker" : "major",
    category: FINDING_CATEGORIES[index % FINDING_CATEGORIES.length],
    location: `/teacher/route-${index + 1}`,
    evidence: `curl -s http://localhost:3000/teacher | head -1 returned 200`,
    whyItMatters: `teacher consequence ${index + 1}`,
    group: "teacher",
    agentId: teacherGroup.agents[index].id,
    agent: teacherGroup.agents[index].title,
  })

  const makeRuns = (withFindings: number, allFailed = false): AgentRun[] =>
    teacherGroup.agents.map((agent, index) => ({
      agentId: agent.id,
      agentTitle: agent.title,
      group: "teacher" as const,
      status: allFailed ? ("failed" as const) : ("completed" as const),
      toolCalls: 3,
      blockedCalls: 0,
      modelTurns: 2,
      findings: !allFailed && index < withFindings ? [finding(index)] : [],
      durationMs: 1000,
    }))

  const groupMarkdown = renderGroupFile("teacher", makeRuns(3))
  check(
    "group file has the two required sections in order",
    groupMarkdown.indexOf("## Group") !== -1 &&
      groupMarkdown.indexOf("## Group") < groupMarkdown.indexOf("## Findings"),
  )
  check(
    "group file declares group metadata",
    /\|\s*group\s*\|\s*teacher-langchain\s*\|/.test(groupMarkdown) &&
      /\|\s*kind\s*\|\s*langchain\s*\|/.test(groupMarkdown) &&
      /\|\s*status\s*\|\s*reported\s*\|/.test(groupMarkdown) &&
      /\|\s*agentsReported\s*\|\s*5\s*\|/.test(groupMarkdown),
    excerpt(groupMarkdown, 500),
  )
  check(
    "group file numbers findings from TL-1",
    groupMarkdown.includes("TL-1") &&
      groupMarkdown.includes("TL-3") &&
      !groupMarkdown.includes("TL-4"),
  )
  check("group file escapes pipes", groupMarkdown.includes("\\|"), excerpt(groupMarkdown, 400))
  check(
    "group file keeps every cell on one line",
    !/Finding number 1\n/.test(groupMarkdown),
    excerpt(groupMarkdown, 400),
  )
  check("group file carries the model's category through", groupMarkdown.includes("dead-control"))

  const oneFailed = makeRuns(2)
  oneFailed[4].status = "failed"
  const partialMarkdown = renderGroupFile("teacher", oneFailed)
  check(
    "a failed agent does not discard the others' findings",
    partialMarkdown.includes("TL-2") && /\|\s*agentsReported\s*\|\s*4\s*\|/.test(partialMarkdown),
    excerpt(partialMarkdown, 500),
  )
  const allFailedMarkdown = renderGroupFile("teacher", makeRuns(0, true))
  check(
    "an all-failed group is recorded as failed",
    /\|\s*status\s*\|\s*failed\s*\|/.test(allFailedMarkdown) &&
      /\|\s*agentsReported\s*\|\s*0\s*\|/.test(allFailedMarkdown),
    excerpt(allFailedMarkdown, 500),
  )

  // `npm run format:check` covers docs/**, so the generated table has to be
  // byte-stable under the repo's own Prettier, not merely valid Markdown.
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "audit-selftest-"))
  const tmpFile = path.join(tmpDir, "teacher-langchain.md")
  await writeFile(tmpFile, groupMarkdown, "utf8")
  try {
    await execFileAsync(
      path.join(process.cwd(), "node_modules", ".bin", "prettier"),
      ["--check", "--config", path.join(process.cwd(), ".prettierrc"), tmpFile],
      { cwd: process.cwd() },
    )
    check("generated group file is Prettier-clean", true)
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout ?? ""
    check(
      "generated group file is Prettier-clean",
      false,
      `${stdout}\n${error instanceof Error ? error.message : String(error)}`,
    )
  }
  await rm(tmpDir, { recursive: true, force: true })

  // Best-effort cross-check against the aggregator's own parser. Imported with a
  // non-literal specifier so the harness does not hard-depend on a sibling pod's
  // in-flight file; if it cannot be loaded, the check is skipped with a warning
  // rather than failing the harness for someone else's refactor.
  try {
    // Built through a helper so the specifier is not a string literal: a
    // literal path ending in `.ts` is a TypeScript error here
    // (allowImportingTsExtensions is off), and resolving the sibling module at
    // runtime is exactly what we want anyway.
    const loadAggregatorModule = (name: string) => import(`../audit-dashboard/${name}`)
    const parserModule = (await loadAggregatorModule("parse.ts")) as {
      parseGroupFile?: (input: unknown) => { findings: unknown[]; agentsReported: number }
    }
    if (typeof parserModule.parseGroupFile !== "function") {
      throw new Error("parseGroupFile is not exported")
    }
    const parsedGroupFile = parserModule.parseGroupFile({
      filePath: "docs/audit/teacher-langchain.md",
      text: groupMarkdown,
      definition: {
        id: "teacher-langchain",
        domain: "teacher",
        kind: "langchain",
        agents: 5,
        scope: "all /teacher/* routes",
      },
    })
    check(
      "the aggregator's parser accepts the generated group file",
      parsedGroupFile.findings.length === 3 && parsedGroupFile.agentsReported === 5,
      JSON.stringify(parsedGroupFile).slice(0, 300),
    )

    const definitionsModule = (await loadAggregatorModule("groups.ts")) as {
      CATEGORIES?: readonly string[]
    }
    check(
      "category vocabulary matches the aggregator's",
      JSON.stringify(definitionsModule.CATEGORIES) === JSON.stringify(FINDING_CATEGORIES),
      `harness ${FINDING_CATEGORIES.join(",")} vs aggregator ${(definitionsModule.CATEGORIES ?? []).join(",")}`,
    )
  } catch (error) {
    process.stdout.write(
      `WARN  could not cross-check against scripts/audit-dashboard (${error instanceof Error ? error.message : String(error)}); skipping.\n`,
    )
  }

  // --- session cache --------------------------------------------------------
  let loginCalls = 0
  const cache = new SessionCache()
  const fakeLogin = async () => {
    loginCalls += 1
    return { cookie: "auth-user=fake", user: "fake" }
  }
  await Promise.all([
    cache.get("a@b.c", "pw", fakeLogin),
    cache.get("a@b.c", "pw", fakeLogin),
    cache.get("a@b.c", "pw", fakeLogin),
  ])
  check(
    "SessionCache collapses concurrent logins for one credential",
    loginCalls === 1,
    `login() called ${loginCalls} times`,
  )
  await cache.get("a@b.c", "different-password", fakeLogin)
  check(
    "SessionCache keys on the credential pair, not the email",
    loginCalls === 2,
    `login() called ${loginCalls} times`,
  )

  // --- network tools (need the dev server) ----------------------------------
  if (!(await serverReachable())) {
    process.stdout.write(
      `\nWARN  ${BASE_URL} is not answering; skipping http_get/login_and_fetch checks.\n      Start the dev server and re-run to verify those.\n`,
    )
  } else {
    const health = await handlers.http_get({ path: "/api/health" })
    check("http_get returns status and body", health.includes("-> 200"), excerpt(health))

    const anonymous = await handlers.http_get({ path: "/teacher" })
    check(
      "http_get reports redirects instead of following them",
      anonymous.includes("-> 3"),
      excerpt(anonymous),
    )

    const outside = await handlers.http_get({ path: "https://example.com/" })
    check("http_get refuses a non-app origin", outside.startsWith("ERROR:"), excerpt(outside))

    const teacher = await handlers.login_and_fetch({
      email: "demo.teacher@school.edu",
      password: "demo1234",
      path: "/teacher",
    })
    check(
      "login_and_fetch signs in and returns a teacher page",
      teacher.includes("-> 200") && teacher.includes("(teacher)"),
      excerpt(teacher),
    )

    const student = await handlers.login_and_fetch({
      email: "demo.student1@school.edu",
      password: "demo1234",
      path: "/student",
    })
    check(
      "login_and_fetch signs in as a student",
      student.includes("-> 200") && student.includes("(student)"),
      excerpt(student),
    )

    const badPassword = await handlers.login_and_fetch({
      // A non-existent address rather than a seeded one: a failed attempt
      // records a throttle hit for the identifier, and the self-test should not
      // spend a real account's budget.
      email: "audit-selftest-no-such-user@example.invalid",
      password: "not-the-password",
      path: "/teacher",
    })
    check(
      "login_and_fetch reports bad credentials as an error",
      badPassword.startsWith("ERROR:") && badPassword.includes("401"),
      excerpt(badPassword),
    )
  }

  process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
  process.exitCode = failed === 0 ? 0 : 1
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Self-test crashed: ${error instanceof Error ? error.stack : String(error)}\n`,
  )
  process.exitCode = 1
})
