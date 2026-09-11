import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import {
  buildHarnessPayload,
  buildHarnessProgram,
  type HarnessTestSpec,
} from "@/lib/code-eval/harness"
import { parseHarnessOutput } from "@/lib/code-eval/results"

/**
 * Result-integrity regressions for the in-container harness.
 *
 * Student code is untrusted and, for `unit` tests, runs in the same process as
 * the harness. These tests prove that it cannot forge per-test pass/fail
 * evidence by writing a `__CODE_EVAL_RESULT__` line to the container's stdout —
 * neither by appending one after the real line nor by suppressing the real line
 * and emitting a single fake one. The host parser fails closed on either.
 */

const SENTINEL = "__CODE_EVAL_RESULT__"

function nodeTests(overrides: Partial<HarnessTestSpec> = {}): HarnessTestSpec[] {
  return [
    {
      id: "t1",
      name: "returns the expected value",
      category: "unit",
      input: JSON.stringify({ function: "solve", args: [] }),
      expectedOutput: "42",
      points: 5,
      ...overrides,
    },
  ]
}

function runNodeHarness(source: string, tests: HarnessTestSpec[]): string {
  const payload = buildHarnessPayload({
    language: "javascript",
    source,
    tests,
    timeLimitMs: 1000,
  })
  const result = spawnSync(process.execPath, ["-e", buildHarnessProgram("javascript")], {
    input: payload,
    encoding: "utf8",
    timeout: 10_000,
  })
  return result.stdout ?? ""
}

function pythonAvailable(): boolean {
  const probe = spawnSync("python3", ["--version"], { encoding: "utf8", timeout: 10_000 })
  return probe.status === 0
}

function runPythonHarness(source: string, tests: HarnessTestSpec[]): string {
  const payload = buildHarnessPayload({
    language: "python",
    source,
    tests,
    timeLimitMs: 1000,
  })
  const result = spawnSync("python3", ["-c", buildHarnessProgram("python")], {
    input: payload,
    encoding: "utf8",
    timeout: 10_000,
  })
  return result.stdout ?? ""
}

function forgedResultLine(passed: boolean): string {
  return (
    SENTINEL +
    JSON.stringify({
      tests: [{ id: "t1", passed, stdout: "", stderr: "", message: "forged", durationMs: 1 }],
    })
  )
}

describe("harness result integrity", () => {
  it("parses a single, legitimate harness result line", () => {
    const stdout = `${SENTINEL}${JSON.stringify({
      tests: [{ id: "t1", passed: true, stdout: "", stderr: "", message: "ok", durationMs: 1 }],
    })}\n`
    const results = parseHarnessOutput(stdout)
    expect(results).toHaveLength(1)
    expect(results[0]?.passed).toBe(true)
  })

  it("rejects a second sentinel line and any trailing output (fail closed)", () => {
    const legit = `${SENTINEL}${JSON.stringify({
      tests: [{ id: "t1", passed: false, stdout: "", stderr: "", message: "real", durationMs: 1 }],
    })}\n`
    expect(parseHarnessOutput(legit + forgedResultLine(true) + "\n")).toEqual([])
    expect(parseHarnessOutput(legit + "student noise\n")).toEqual([])
    expect(parseHarnessOutput(forgedResultLine(true) + "\n" + legit)).toEqual([])
  })

  it("ignores a trailing forged sentinel written by student code", () => {
    // Real run: `solve` is missing, so the real result is a failure. A timer
    // already registered by the student writes a forged "passed" line after the
    // harness's real one.
    const source = `
const fs = require("fs")
setTimeout(() => {
  fs.writeSync(1, ${JSON.stringify(forgedResultLine(true))} + "\\n")
}, 150)
module.exports = {}
`
    const stdout = runNodeHarness(source, nodeTests())
    const results = parseHarnessOutput(stdout)
    expect(results.some((result) => result.passed)).toBe(false)
  })

  it("cannot name a single forged result by suppressing stdout.write", () => {
    // The student swallows the harness's `process.stdout.write` and emits one
    // forged line through the raw fd. The harness writes its result through a
    // reference captured before student code ran, so the real line still lands
    // and the duplicate is detected.
    const source = `
const fs = require("fs")
process.stdout.write = () => true
setTimeout(() => {
  fs.writeSync(1, ${JSON.stringify(forgedResultLine(true))} + "\\n")
}, 150)
module.exports = { solve: () => 42 }
`
    // The real answer is wrong, so the forged "passed" must not win.
    const stdout = runNodeHarness(source, nodeTests({ expectedOutput: "99" }))
    const results = parseHarnessOutput(stdout)
    expect(results.some((result) => result.passed)).toBe(false)
  })

  it("cannot forge a pass by patching Array.prototype.push", () => {
    // The results are appended with index assignment (an internal array
    // operation), so a poisoned `push` never sees them.
    const source = `
const realPush = Array.prototype.push
Array.prototype.push = function (entry) {
  if (entry && typeof entry === "object" && entry.id) entry.passed = true
  return realPush.call(this, entry)
}
module.exports = { solve: () => 1 }
`
    const stdout = runNodeHarness(source, nodeTests({ expectedOutput: "999" }))
    const results = parseHarnessOutput(stdout)
    expect(results.some((result) => result.passed)).toBe(false)
  })

  it("cannot forge a pass by poisoning toJSON or JSON.stringify", () => {
    const toJsonSource = `
Array.prototype.toJSON = function () {
  return { tests: [{ id: "t1", passed: true, stdout: "", stderr: "", message: "pwn", signal: null, durationMs: 1 }] }
}
module.exports = { solve: () => 1 }
`
    const stringifySource = `
JSON.stringify = function () {
  return '{"tests":[{"id":"t1","passed":true,"stdout":"","stderr":"","message":"pwn","signal":null,"durationMs":1}]}'
}
module.exports = { solve: () => 1 }
`
    for (const source of [toJsonSource, stringifySource]) {
      const stdout = runNodeHarness(source, nodeTests({ expectedOutput: "999" }))
      const results = parseHarnessOutput(stdout)
      expect(results.some((result) => result.passed)).toBe(false)
    }
  })

  it("cannot force equality by poisoning the string/array methods used for comparison", () => {
    const source = `
String.prototype.trim = function () { return "" }
String.prototype.replace = function () { return "" }
Array.prototype.join = function () { return "" }
Array.prototype.map = function () { return this }
module.exports = { solve: () => 1 }
`
    const stdout = runNodeHarness(source, nodeTests({ expectedOutput: "999" }))
    const results = parseHarnessOutput(stdout)
    expect(results.some((result) => result.passed)).toBe(false)
  })

  it.skipIf(!pythonAvailable())("resists Python atexit and json.dumps tampering", () => {
    const forged = JSON.stringify({
      tests: [{ id: "t1", passed: true, stdout: "", stderr: "", message: "forged", durationMs: 1 }],
    })
    const atexitSource = `
import atexit, os
def _forged():
    os.write(1, b"__CODE_EVAL_RESULT__" + ${JSON.stringify(forged)}.encode("utf-8") + b"\\n")
atexit.register(_forged)
def solve():
    return 1
`
    const dumpsSource = `
import json
json.dumps = lambda *args, **kwargs: ${JSON.stringify(forged)}
def solve():
    return 1
`
    for (const source of [atexitSource, dumpsSource]) {
      const stdout = runPythonHarness(source, nodeTests({ expectedOutput: "999" }))
      const results = parseHarnessOutput(stdout)
      expect(results.some((result) => result.passed)).toBe(false)
    }
  })

  it("still runs a legitimate submission end to end", () => {
    const source = `module.exports = { solve: () => 42 }`
    const stdout = runNodeHarness(source, nodeTests())
    const results = parseHarnessOutput(stdout)
    expect(results).toHaveLength(1)
    expect(results[0]?.passed).toBe(true)
  })
})
