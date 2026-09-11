import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import { executeSandbox } from "@/lib/code-eval/executor"
import { parseHarnessOutput } from "@/lib/code-eval/results"
import { DOCKER_IMAGE_BY_LANGUAGE } from "@/lib/code-eval/sandbox"

/**
 * Real Docker integration tests.
 *
 * These are the honest half of the sandbox guarantee: they actually run
 * containers through `executeSandbox` and observe whether network egress,
 * runaway loops, and memory hogs are contained. When the daemon or the pinned
 * image is unavailable the whole block SKIPS — it never fails the suite on a
 * machine without Docker.
 */

function probe(): boolean {
  const version = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
    encoding: "utf8",
    timeout: 15_000,
  })
  if (version.status !== 0) return false
  const image = spawnSync(
    "docker",
    ["image", "inspect", DOCKER_IMAGE_BY_LANGUAGE.python, "--format", "{{.Id}}"],
    { encoding: "utf8", timeout: 15_000 },
  )
  return image.status === 0
}

const DOCKER_READY = probe()

describe.skipIf(!DOCKER_READY)("sandboxed execution (Docker)", () => {
  it("runs a correct submission and reports per-test results", async () => {
    const outcome = await executeSandbox({
      language: "python",
      source: "value = int(input())\nprint(value + 1)\n",
      tests: [
        {
          id: "t1",
          name: "increments",
          category: "input-output",
          input: "41\n",
          expectedOutput: "42\n",
          points: 1,
        },
        {
          id: "t2",
          name: "defines nothing suspicious",
          category: "structure",
          input: JSON.stringify({ mustContain: ["input("] }),
          expectedOutput: null,
          points: 1,
        },
      ],
      timeLimitMs: 3000,
      memoryLimitMb: 128,
    })

    expect(outcome.kind).toBe("completed")
    const results = parseHarnessOutput(outcome.stdout)
    expect(results).toHaveLength(2)
    expect(results.every((result) => result.passed)).toBe(true)
  })

  it("denies network egress (--network none)", async () => {
    const outcome = await executeSandbox({
      language: "python",
      source: [
        "import socket",
        "sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)",
        "sock.settimeout(3)",
        'sock.connect(("1.1.1.1", 80))',
        'print("NETWORK_OK")',
      ].join("\n"),
      tests: [
        {
          id: "net",
          name: "network attempt is blocked",
          category: "input-output",
          input: "",
          expectedOutput: "NETWORK_OK",
          points: 1,
        },
      ],
      timeLimitMs: 5000,
      memoryLimitMb: 128,
    })

    const results = parseHarnessOutput(outcome.stdout)
    expect(results).toHaveLength(1)
    expect(results[0].passed).toBe(false)
    const diagnostic = `${results[0].stderr}\n${results[0].message}`
    expect(diagnostic).toMatch(
      /network|unreachable|timed out|timeout|refused|resolve|temporary failure|name or service/i,
    )
    expect(results[0].stdout).not.toContain("NETWORK_OK")
  })

  it("kills a runaway loop with the wall-clock timeout", async () => {
    const started = Date.now()
    // A `unit` test runs the student's function in-process inside the harness, so
    // nothing can return control to the harness: only the container wall-clock
    // kill stops it. This is the backstop the executor guarantees.
    const outcome = await executeSandbox({
      language: "python",
      source: "def solve(*args):\n    while True:\n        pass\n",
      tests: [
        {
          id: "loop",
          name: "never terminates",
          category: "unit",
          input: JSON.stringify({ function: "solve", args: [] }),
          expectedOutput: null,
          points: 1,
        },
      ],
      timeLimitMs: 1000,
      memoryLimitMb: 128,
    })
    const elapsed = Date.now() - started

    expect(outcome.kind).toBe("timeout")
    expect(outcome.timedOut).toBe(true)
    // Derived budget is 1 test * 1000ms + 5000ms overhead; allow generous slack.
    expect(elapsed).toBeLessThan(20_000)
  })

  it("contains a hanging program per test without killing the container", async () => {
    const outcome = await executeSandbox({
      language: "python",
      source: "while True:\n    pass\n",
      tests: [
        {
          id: "loop",
          name: "never terminates",
          category: "input-output",
          input: "",
          expectedOutput: "",
          points: 1,
        },
      ],
      timeLimitMs: 1000,
      memoryLimitMb: 128,
    })

    expect(outcome.kind).toBe("completed")
    const results = parseHarnessOutput(outcome.stdout)
    expect(results).toHaveLength(1)
    expect(results[0].passed).toBe(false)
    expect(results[0].message).toMatch(/timed out/i)
  })

  it("kills a memory hog with the memory limit", async () => {
    const outcome = await executeSandbox({
      language: "python",
      source:
        "chunks = []\n" + "while True:\n" + "    chunks.append(bytearray(20 * 1024 * 1024))\n",
      tests: [
        {
          id: "memory",
          name: "allocates far beyond the limit",
          category: "input-output",
          input: "",
          expectedOutput: "419430400",
          points: 1,
        },
      ],
      timeLimitMs: 5000,
      memoryLimitMb: 64,
    })

    expect(outcome.kind).toBe("memory")
    expect(outcome.memoryExceeded).toBe(true)
  })
})
