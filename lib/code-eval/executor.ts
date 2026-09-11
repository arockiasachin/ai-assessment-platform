import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"

import type { CodeLanguage } from "@/lib/contracts/code-eval"

import { buildHarnessPayload, buildHarnessProgram, type HarnessTestSpec } from "./harness"
import { parseHarnessOutput } from "./results"
import {
  SANDBOX_MAX_OUTPUT_BYTES,
  buildSandboxRunArgs,
  deriveWallClockMs,
  resolveSandboxRuntime,
} from "./sandbox"

/**
 * Docker-backed sandbox executor.
 *
 * The executor is deliberately thin: it shells out to the `docker` CLI with the
 * argument vector produced by {@link buildSandboxRunArgs}, streams the payload to
 * stdin, enforces a wall-clock budget with a hard kill, reads the container's OOM
 * flag, and always removes the container in a `finally` block. It never
 * bind-mounts a host path and never executes student code in this process.
 *
 * Everything below the isolation boundary is injectable
 * ({@link SandboxExecutor}) so services can be tested without Docker; the Docker
 * integration test skips cleanly when the daemon is unavailable.
 */

export type SandboxRunRequest = {
  language: CodeLanguage
  source: string
  tests: HarnessTestSpec[]
  timeLimitMs: number
  memoryLimitMb: number
}

export type SandboxRunKind = "completed" | "timeout" | "memory" | "error"

export type SandboxRunOutcome = {
  kind: SandboxRunKind
  exitCode: number | null
  stdout: string
  stderr: string
  wallClockMs: number
  timedOut: boolean
  memoryExceeded: boolean
  outputLimitExceeded: boolean
  /** Infra-level explanation; per-test messages live in the parsed results. */
  message: string | null
}

export type SandboxExecutor = (request: SandboxRunRequest) => Promise<SandboxRunOutcome>

export type DockerAvailability = { available: boolean; reason: string | null }

const DOCKER_PROBE_TIMEOUT_MS = 8_000
const DOCKER_CLEANUP_TIMEOUT_MS = 10_000

type ExecResult = {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  outputLimitExceeded: boolean
  spawnError: string | null
}

function execDocker(
  args: string[],
  options: { timeoutMs: number; stdin?: string; killOnTimeout?: () => void } = {
    timeoutMs: DOCKER_CLEANUP_TIMEOUT_MS,
  },
): Promise<ExecResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] })
    } catch (error) {
      resolve({
        code: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        outputLimitExceeded: false,
        spawnError: error instanceof Error ? error.message : "docker spawn failed",
      })
      return
    }

    let stdout = ""
    let stderr = ""
    let outputLimitExceeded = false
    let timedOut = false
    let settled = false

    const timer = setTimeout(() => {
      timedOut = true
      options.killOnTimeout?.()
      child.kill("SIGKILL")
    }, options.timeoutMs)

    const capture = (chunk: Buffer, target: "stdout" | "stderr") => {
      const text = chunk.toString("utf8")
      if (target === "stdout") {
        if (stdout.length < SANDBOX_MAX_OUTPUT_BYTES) stdout += text
        else outputLimitExceeded = true
      } else {
        if (stderr.length < SANDBOX_MAX_OUTPUT_BYTES) stderr += text
        else outputLimitExceeded = true
      }
      if (outputLimitExceeded) {
        options.killOnTimeout?.()
        child.kill("SIGKILL")
      }
    }

    child.stdout?.on("data", (chunk: Buffer) => capture(chunk, "stdout"))
    child.stderr?.on("data", (chunk: Buffer) => capture(chunk, "stderr"))

    child.on("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        code: null,
        stdout,
        stderr,
        timedOut,
        outputLimitExceeded,
        spawnError: error.message,
      })
    })

    child.on("close", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut, outputLimitExceeded, spawnError: null })
    })

    if (options.stdin !== undefined && child.stdin) {
      child.stdin.write(options.stdin)
      child.stdin.end()
    } else {
      child.stdin?.end()
    }
  })
}

let dockerAvailability: DockerAvailability | undefined

/** True when the `docker` CLI can reach a running daemon. Cached per process. */
export async function isDockerAvailable(): Promise<DockerAvailability> {
  if (dockerAvailability) return dockerAvailability
  const result = await execDocker(["version", "--format", "{{.Server.Version}}"], {
    timeoutMs: DOCKER_PROBE_TIMEOUT_MS,
  })
  if (result.spawnError) {
    dockerAvailability = { available: false, reason: "The docker CLI is not installed." }
  } else if (result.timedOut) {
    dockerAvailability = { available: false, reason: "The docker daemon did not respond." }
  } else if (result.code !== 0) {
    dockerAvailability = {
      available: false,
      reason: result.stderr.trim() || "The docker daemon is not reachable.",
    }
  } else {
    dockerAvailability = { available: true, reason: null }
  }
  return dockerAvailability
}

/** Test helper: drop the cached probe result. */
export function resetDockerAvailabilityCache(): void {
  dockerAvailability = undefined
}

async function imageAvailable(image: string): Promise<boolean> {
  const result = await execDocker(["image", "inspect", image, "--format", "{{.Id}}"], {
    timeoutMs: DOCKER_PROBE_TIMEOUT_MS,
  })
  return result.code === 0 && !result.spawnError && !result.timedOut
}

type InspectResult = { oomKilled: boolean; exitCode: number | null; running: boolean }

async function inspectContainer(name: string): Promise<InspectResult> {
  const result = await execDocker(
    ["inspect", "--format", "{{.State.OOMKilled}}|{{.State.ExitCode}}|{{.State.Running}}", name],
    { timeoutMs: DOCKER_CLEANUP_TIMEOUT_MS },
  )
  if (result.code !== 0) return { oomKilled: false, exitCode: null, running: false }
  const [oom, exit, running] = result.stdout.trim().split("|")
  const parsedExit = Number.parseInt(exit ?? "", 10)
  return {
    oomKilled: oom === "true",
    exitCode: Number.isFinite(parsedExit) ? parsedExit : null,
    running: running === "true",
  }
}

/**
 * The production executor. Runs one student submission in a fresh, locked-down
 * container and always cleans it up.
 */
export const executeSandbox: SandboxExecutor = async (request) => {
  const availability = await isDockerAvailable()
  if (!availability.available) {
    return {
      kind: "error",
      exitCode: null,
      stdout: "",
      stderr: "",
      wallClockMs: 0,
      timedOut: false,
      memoryExceeded: false,
      outputLimitExceeded: false,
      message: `Sandbox unavailable: ${availability.reason ?? "docker is not available"}.`,
    }
  }

  const runtime = resolveSandboxRuntime(request.language, "")
  if (!(await imageAvailable(runtime.image))) {
    return {
      kind: "error",
      exitCode: null,
      stdout: "",
      stderr: "",
      wallClockMs: 0,
      timedOut: false,
      memoryExceeded: false,
      outputLimitExceeded: false,
      message: `Sandbox image ${runtime.image} is not available locally; refusing to pull it.`,
    }
  }

  const containerName = `code-eval-${randomUUID()}`
  const program = buildHarnessProgram(request.language)
  const payload = buildHarnessPayload({
    language: request.language,
    source: request.source,
    tests: request.tests,
    timeLimitMs: request.timeLimitMs,
  })
  const args = buildSandboxRunArgs({
    containerName,
    language: request.language,
    memoryLimitMb: request.memoryLimitMb,
    timeLimitMs: request.timeLimitMs,
    program,
  })
  const wallClockMs = deriveWallClockMs(request.timeLimitMs, request.tests.length)

  const startedAt = Date.now()
  let killed = false
  const killContainer = () => {
    if (killed) return
    killed = true
    void execDocker(["kill", containerName], { timeoutMs: DOCKER_CLEANUP_TIMEOUT_MS })
  }

  let run: ExecResult
  try {
    run = await execDocker(args, {
      timeoutMs: wallClockMs,
      stdin: payload,
      killOnTimeout: killContainer,
    })
  } finally {
    // Cleanup is unconditional: success, timeout, crash, or output-limit kill.
    await execDocker(["rm", "-f", containerName], { timeoutMs: DOCKER_CLEANUP_TIMEOUT_MS })
  }

  const elapsed = Date.now() - startedAt

  const base = {
    exitCode: run.code,
    stdout: run.stdout,
    stderr: run.stderr,
    wallClockMs: elapsed,
    timedOut: run.timedOut,
    memoryExceeded: false,
    outputLimitExceeded: run.outputLimitExceeded,
    message: null as string | null,
  }

  if (run.spawnError) {
    return { ...base, kind: "error", message: `Failed to start docker: ${run.spawnError}.` }
  }
  if (run.outputLimitExceeded) {
    return {
      ...base,
      kind: "error",
      message: "The sandbox produced more output than the limit allows.",
    }
  }
  if (base.timedOut) {
    return { ...base, kind: "timeout", message: "The sandbox exceeded its wall-clock limit." }
  }
  const inspect = await inspectContainer(containerName)
  // The memory ceiling can manifest two ways: the container itself is OOM-killed
  // (in-process unit tests, harness allocations), or the harness's child program
  // is SIGKILLed at the cgroup boundary while the harness survives. Both are a
  // memory-limit failure, not a wrong answer.
  const childKilled = parseHarnessOutput(run.stdout).some((result) => result.signal === "SIGKILL")
  if (inspect.oomKilled || childKilled) {
    return {
      ...base,
      kind: "memory",
      memoryExceeded: true,
      message: `The sandbox exceeded its ${request.memoryLimitMb} MB memory limit.`,
    }
  }

  if (run.code !== 0) {
    return {
      ...base,
      kind: "error",
      message: run.stderr.trim() || `The sandbox exited with code ${run.code ?? "unknown"}.`,
    }
  }

  return { ...base, kind: "completed" }
}
