import { describe, expect, it } from "vitest"

import {
  DOCKER_IMAGE_BY_LANGUAGE,
  SANDBOX_ISOLATION_FLAGS,
  buildSandboxRunArgs,
  deriveWallClockMs,
  resolveSandboxRuntime,
  SANDBOX_MAX_WALL_CLOCK_MS,
} from "@/lib/code-eval/sandbox"

/**
 * The isolation builder is the single place sandbox guarantees are expressed, so
 * these tests assert every restriction is present in the produced argument
 * vector. A removed flag fails here instead of silently weakening the sandbox.
 */

function spec(overrides: Partial<Parameters<typeof buildSandboxRunArgs>[0]> = {}) {
  return {
    containerName: "code-eval-test",
    language: "python" as const,
    memoryLimitMb: 256,
    timeLimitMs: 5000,
    program: "print('hi')",
    ...overrides,
  }
}

function indexOfFlag(args: string[], flag: string): number {
  return args.indexOf(flag)
}

describe("buildSandboxRunArgs", () => {
  it("includes every documented isolation flag", () => {
    const args = buildSandboxRunArgs(spec())

    for (const entry of SANDBOX_ISOLATION_FLAGS) {
      const index = indexOfFlag(args, entry.flag)
      expect(index, `missing ${entry.flag}`).toBeGreaterThanOrEqual(0)
      if (entry.value !== undefined) {
        expect(args[index + 1], `${entry.flag} value`).toBe(entry.value)
      }
    }
  })

  it("denies all network access", () => {
    const args = buildSandboxRunArgs(spec())
    expect(args[indexOfFlag(args, "--network") + 1]).toBe("none")
  })

  it("pins memory and disables swap by setting swap equal to memory", () => {
    const args = buildSandboxRunArgs(spec({ memoryLimitMb: 128 }))
    expect(args[indexOfFlag(args, "--memory") + 1]).toBe("128m")
    expect(args[indexOfFlag(args, "--memory-swap") + 1]).toBe("128m")
  })

  it("caps CPU and PIDs", () => {
    const args = buildSandboxRunArgs(spec())
    expect(args[indexOfFlag(args, "--cpus") + 1]).toBe("1")
    expect(Number(args[indexOfFlag(args, "--pids-limit") + 1])).toBeGreaterThan(0)
  })

  it("runs as non-root with a read-only root and a noexec tmpfs scratch", () => {
    const args = buildSandboxRunArgs(spec())
    expect(args[indexOfFlag(args, "--user") + 1]).toBe("65534:65534")
    expect(args).toContain("--read-only")
    expect(args[indexOfFlag(args, "--cap-drop") + 1]).toBe("ALL")
    expect(args[indexOfFlag(args, "--security-opt") + 1]).toBe("no-new-privileges")
    const tmpfs = args[indexOfFlag(args, "--tmpfs") + 1]
    expect(tmpfs).toContain("/tmp:")
    expect(tmpfs).toContain("noexec")
    expect(tmpfs).toContain("nosuid")
    expect(tmpfs).toContain("nodev")
  })

  it("selects the expected image and interpreter without a shell", () => {
    const python = buildSandboxRunArgs(spec())
    expect(python).toContain(DOCKER_IMAGE_BY_LANGUAGE.python)
    const pythonIndex = python.indexOf(DOCKER_IMAGE_BY_LANGUAGE.python)
    expect(python.slice(pythonIndex + 1, pythonIndex + 3)).toEqual(["python3", "-c"])

    const node = buildSandboxRunArgs(spec({ language: "javascript" }))
    expect(node).toContain(DOCKER_IMAGE_BY_LANGUAGE.javascript)
    const nodeIndex = node.indexOf(DOCKER_IMAGE_BY_LANGUAGE.javascript)
    expect(node.slice(nodeIndex + 1, nodeIndex + 3)).toEqual(["node", "-e"])
  })

  it("starts with docker run and carries the container name exactly once", () => {
    const args = buildSandboxRunArgs(spec({ containerName: "code-eval-abc" }))
    expect(args[0]).toBe("run")
    expect(args[indexOfFlag(args, "--name") + 1]).toBe("code-eval-abc")
  })
})

describe("resolveSandboxRuntime", () => {
  it("disables bytecode writes and hash randomization for python", () => {
    const runtime = resolveSandboxRuntime("python", "program")
    expect(runtime.env).toContain("PYTHONDONTWRITEBYTECODE=1")
    expect(runtime.env).toContain("PYTHONHASHSEED=0")
  })
})

describe("deriveWallClockMs", () => {
  it("scales with the test count and per-test limit", () => {
    expect(deriveWallClockMs(1000, 1)).toBe(6000)
    expect(deriveWallClockMs(1000, 3)).toBe(8000)
  })

  it("is clamped to the hard ceiling", () => {
    expect(deriveWallClockMs(60_000, 10)).toBe(SANDBOX_MAX_WALL_CLOCK_MS)
  })

  it("never returns a budget below the floor", () => {
    expect(deriveWallClockMs(0, 0)).toBe(5001)
  })
})
