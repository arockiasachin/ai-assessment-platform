import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import type { CodeLanguage } from "@/lib/contracts/code-eval"
import { executeSandbox } from "@/lib/code-eval/executor"
import { DOCKER_IMAGE_BY_LANGUAGE } from "@/lib/code-eval/sandbox"
import { HARNESS_RESULT_SENTINEL } from "@/lib/code-eval/harness"
import { parseHarnessOutput } from "@/lib/code-eval/results"

/**
 * Real-container proof for the out-of-process `unit` execution change (Phase 3
 * item S-4).
 *
 * The parent harness is the only writer of the container's stdout and the only
 * process that builds the per-test evidence; student code runs in a child
 * interpreter. These tests re-run the Phase 3 forgery attempts inside real
 * containers and assert they can no longer produce a passing result, and that
 * the normal path still distinguishes a correct from an incorrect solution.
 *
 * Skips cleanly when the daemon or the pinned image is unavailable.
 */

function dockerReady(): boolean {
  return (
    spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
      encoding: "utf8",
      timeout: 15_000,
    }).status === 0
  )
}

function imageReady(language: CodeLanguage): boolean {
  return (
    spawnSync(
      "docker",
      ["image", "inspect", DOCKER_IMAGE_BY_LANGUAGE[language], "--format", "{{.Id}}"],
      {
        encoding: "utf8",
        timeout: 15_000,
      },
    ).status === 0
  )
}

const DOCKER_READY = dockerReady()
const PYTHON_READY = DOCKER_READY && imageReady("python")
const JAVASCRIPT_READY = DOCKER_READY && imageReady("javascript")

function unitTest(expectedOutput: string) {
  return [
    {
      id: "t1",
      name: "returns the expected value",
      category: "unit" as const,
      input: JSON.stringify({ function: "solve", args: [] }),
      expectedOutput,
      points: 5,
    },
  ]
}

async function run(language: CodeLanguage, source: string, expectedOutput: string) {
  return executeSandbox({
    language,
    source,
    tests: unitTest(expectedOutput),
    timeLimitMs: 3000,
    memoryLimitMb: 128,
  })
}

/** Number of lines in the container stdout that contain the framing sentinel. */
function sentinelLineCount(stdout: string): number {
  return stdout.split(/\r?\n/).filter((line) => line.includes(HARNESS_RESULT_SENTINEL)).length
}

function forgedResult(): string {
  return JSON.stringify({
    tests: [
      {
        id: "t1",
        passed: true,
        stdout: "",
        stderr: "",
        message: "forged",
        signal: null,
        durationMs: 1,
      },
    ],
  })
}

describe.skipIf(!DOCKER_READY)("out-of-process unit execution (Docker)", () => {
  describe.skipIf(!PYTHON_READY)("python", () => {
    it("passes a correct solution and fails an incorrect one", async () => {
      const correct = await run("python", "def solve():\n    return 42\n", "42")
      const correctResults = parseHarnessOutput(correct.stdout)
      expect(correctResults).toHaveLength(1)
      expect(correctResults[0]?.passed).toBe(true)

      const incorrect = await run("python", "def solve():\n    return 1\n", "42")
      const incorrectResults = parseHarnessOutput(incorrect.stdout)
      expect(incorrectResults).toHaveLength(1)
      expect(incorrectResults[0]?.passed).toBe(false)
    })

    it("rejects a trailing atexit sentinel (forgery attempt a)", async () => {
      const forged = forgedResult()
      const source = [
        "import atexit, os",
        "def _forged():",
        `    os.write(1, b"__CODE_EVAL_RESULT__" + ${JSON.stringify(forged)}.encode("utf-8") + b"\\n")`,
        "atexit.register(_forged)",
        "def solve():",
        "    return 1",
      ].join("\n")

      const outcome = await run("python", source, "42")
      expect(outcome.kind).toBe("completed")
      expect(sentinelLineCount(outcome.stdout)).toBe(1)
      const results = parseHarnessOutput(outcome.stdout)
      expect(results).toHaveLength(1)
      expect(results[0]?.passed).toBe(false)
    })

    it("rejects stdout suppression plus a raw fd write (forgery attempt b)", async () => {
      const forged = forgedResult()
      const source = [
        "import atexit, os, sys",
        'sys.stdout = open(os.devnull, "w")',
        "def _forged():",
        `    os.write(1, b"__CODE_EVAL_RESULT__" + ${JSON.stringify(forged)}.encode("utf-8") + b"\\n")`,
        "atexit.register(_forged)",
        "def solve():",
        "    return 1",
      ].join("\n")

      const outcome = await run("python", source, "42")
      expect(outcome.kind).toBe("completed")
      expect(sentinelLineCount(outcome.stdout)).toBe(1)
      const results = parseHarnessOutput(outcome.stdout)
      expect(results[0]?.passed).toBe(false)
    })

    it("rejects a patched json.dumps (forgery attempt c)", async () => {
      const forged = forgedResult()
      const source = [
        "import json",
        `json.dumps = lambda *args, **kwargs: ${JSON.stringify(forged)}`,
        "def solve():",
        "    return 1",
      ].join("\n")

      const outcome = await run("python", source, "42")
      expect(outcome.kind).toBe("completed")
      expect(sentinelLineCount(outcome.stdout)).toBe(1)
      const results = parseHarnessOutput(outcome.stdout)
      expect(results[0]?.passed).toBe(false)
    })
  })

  describe.skipIf(!JAVASCRIPT_READY)("javascript", () => {
    it("passes a correct solution and fails an incorrect one", async () => {
      const correct = await run("javascript", "module.exports = { solve: () => 42 }", "42")
      const correctResults = parseHarnessOutput(correct.stdout)
      expect(correctResults).toHaveLength(1)
      expect(correctResults[0]?.passed).toBe(true)

      const incorrect = await run("javascript", "module.exports = { solve: () => 1 }", "42")
      const incorrectResults = parseHarnessOutput(incorrect.stdout)
      expect(incorrectResults).toHaveLength(1)
      expect(incorrectResults[0]?.passed).toBe(false)
    })

    it("rejects a trailing setTimeout sentinel (forgery attempt a)", async () => {
      const forged = forgedResult()
      const source = [
        'const fs = require("fs")',
        `setTimeout(() => { fs.writeSync(1, "__CODE_EVAL_RESULT__" + ${JSON.stringify(forged)} + "\\n") }, 100)`,
        "module.exports = { solve: () => 1 }",
      ].join("\n")

      const outcome = await run("javascript", source, "42")
      expect(outcome.kind).toBe("completed")
      expect(sentinelLineCount(outcome.stdout)).toBe(1)
      const results = parseHarnessOutput(outcome.stdout)
      expect(results[0]?.passed).toBe(false)
    })

    it("rejects stdout suppression plus a raw fd write (forgery attempt b)", async () => {
      const forged = forgedResult()
      const source = [
        'const fs = require("fs")',
        "process.stdout.write = () => true",
        `setTimeout(() => { fs.writeSync(1, "__CODE_EVAL_RESULT__" + ${JSON.stringify(forged)} + "\\n") }, 100)`,
        "module.exports = { solve: () => 1 }",
      ].join("\n")

      const outcome = await run("javascript", source, "42")
      expect(outcome.kind).toBe("completed")
      expect(sentinelLineCount(outcome.stdout)).toBe(1)
      const results = parseHarnessOutput(outcome.stdout)
      expect(results[0]?.passed).toBe(false)
    })

    it("rejects prototype and JSON.stringify pollution (forgery attempt c)", async () => {
      const forged = forgedResult()
      const source = [
        "const realPush = Array.prototype.push",
        "Array.prototype.push = function (entry) {",
        "  if (entry && typeof entry === 'object' && entry.id) entry.passed = true",
        "  return realPush.call(this, entry)",
        "}",
        `Array.prototype.toJSON = function () { return ${JSON.stringify(forged)} }`,
        `JSON.stringify = function () { return ${JSON.stringify(forged)} }`,
        "module.exports = { solve: () => 1 }",
      ].join("\n")

      const outcome = await run("javascript", source, "42")
      expect(outcome.kind).toBe("completed")
      expect(sentinelLineCount(outcome.stdout)).toBe(1)
      const results = parseHarnessOutput(outcome.stdout)
      expect(results[0]?.passed).toBe(false)
    })
  })
})
