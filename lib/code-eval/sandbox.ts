import type { CodeLanguage } from "@/lib/contracts/code-eval"

/**
 * The single, reviewable source of truth for sandbox isolation.
 *
 * Every guarantee the product promises for "student code never runs on the app
 * host, with no network and enforced CPU/memory/time limits" is expressed here
 * as Docker CLI arguments produced by {@link buildSandboxRunArgs}. Route and
 * service code must never assemble `docker run` arguments itself: if a
 * restriction is not in this file, it is not enforced.
 *
 * The guarantees and the exact flags that implement them:
 *
 * | Guarantee                              | Flag(s)                                             |
 * | -------------------------------------- | --------------------------------------------------- |
 * | No network egress (in or out)          | `--network none`                                     |
 * | Memory ceiling, swap disabled          | `--memory <n>m --memory-swap <n>m`                   |
 * | CPU ceiling                            | `--cpus <n>`                                         |
 * | Fork-bomb ceiling                      | `--pids-limit <n>`                                   |
 * | Non-root execution                     | `--user 65534:65534`                                 |
 * | Read-only root filesystem              | `--read-only`                                        |
 * | Minimal writable scratch, no exec      | `--tmpfs /tmp:rw,noexec,nosuid,nodev,size=<n>M`      |
 * | No Linux capabilities                  | `--cap-drop ALL`                                     |
 * | No privilege escalation                | `--security-opt no-new-privileges`                   |
 * | File-descriptor / core-dump ceiling    | `--ulimit nofile=128:128 --ulimit core=0`            |
 * | Zombie reaping                         | `--init`                                             |
 * | No leaked container after the run      | explicit `docker rm -f` in the executor's `finally`  |
 *
 * Wall-clock timeout is enforced by the executor: it kills the container and the
 * CLI process when the derived budget elapses, so a runaway loop cannot outlive
 * the request.
 */

/** Official images already documented as small and offline-friendly. */
export const DOCKER_IMAGE_BY_LANGUAGE: Record<CodeLanguage, string> = {
  python: "python:3.12-slim",
  javascript: "node:22-slim",
}

/** One vCPU is plenty for a student exercise and bounds a busy loop. */
export const SANDBOX_CPU_LIMIT = 1

/**
 * A fork bomb is stopped by the kernel: processes beyond this limit fail to
 * spawn instead of exhausting host PIDs.
 */
export const SANDBOX_PIDS_LIMIT = 128

/** Writable scratch space, mounted `noexec,nosuid,nodev`. */
export const SANDBOX_TMPFS_SIZE_MB = 64

/** `nobody:nogroup`, the conventional unprivileged uid/gid. */
export const SANDBOX_USER = "65534:65534"

/** Cap on each of the container's stdout/stderr streams the executor buffers. */
export const SANDBOX_MAX_OUTPUT_BYTES = 256 * 1024

/** Added to the per-test budget to derive the container wall-clock budget. */
export const SANDBOX_WALL_CLOCK_OVERHEAD_MS = 5_000

/** Hard ceiling on the derived wall-clock budget, whatever the test count. */
export const SANDBOX_MAX_WALL_CLOCK_MS = 120_000

export type SandboxSpec = {
  /** Unique, caller-generated container name (`code-eval-<uuid>`). */
  containerName: string
  language: CodeLanguage
  /** Hard memory ceiling; also used as the swap ceiling to disable swap. */
  memoryLimitMb: number
  /** Per-test time limit inside the harness, in milliseconds. */
  timeLimitMs: number
  /** The harness program passed to the interpreter via `-c` / `-e`. */
  program: string
  cpuLimit?: number
  pidsLimit?: number
  tmpfsSizeMb?: number
}

export type SandboxRuntime = {
  image: string
  interpreterArgs: string[]
  env: string[]
}

/** Resolve the image, interpreter invocation, and interpreter env for a language. */
export function resolveSandboxRuntime(language: CodeLanguage, program: string): SandboxRuntime {
  switch (language) {
    case "python":
      return {
        image: DOCKER_IMAGE_BY_LANGUAGE.python,
        interpreterArgs: ["python3", "-c", program],
        env: ["PYTHONDONTWRITEBYTECODE=1", "PYTHONUNBUFFERED=1", "PYTHONHASHSEED=0"],
      }
    case "javascript":
      return {
        image: DOCKER_IMAGE_BY_LANGUAGE.javascript,
        interpreterArgs: ["node", "-e", program],
        env: ["NODE_NO_WARNINGS=1"],
      }
  }
}

/**
 * Derive the container wall-clock budget from the per-test limit and the number
 * of tests, so N hanging tests cannot each consume the whole request. Clamped to
 * {@link SANDBOX_MAX_WALL_CLOCK_MS}.
 */
export function deriveWallClockMs(timeLimitMs: number, testCount: number): number {
  const tests = Math.max(1, testCount)
  const budget = tests * Math.max(1, timeLimitMs) + SANDBOX_WALL_CLOCK_OVERHEAD_MS
  return Math.min(SANDBOX_MAX_WALL_CLOCK_MS, budget)
}

/**
 * Build the complete `docker run` argument vector for one sandboxed execution.
 *
 * This is the only function allowed to spell out isolation flags. It returns the
 * arguments *including* the leading `"run"`; the executor prepends `"docker"`.
 */
export function buildSandboxRunArgs(spec: SandboxSpec): string[] {
  const runtime = resolveSandboxRuntime(spec.language, spec.program)
  const cpuLimit = spec.cpuLimit ?? SANDBOX_CPU_LIMIT
  const pidsLimit = spec.pidsLimit ?? SANDBOX_PIDS_LIMIT
  const tmpfsSizeMb = spec.tmpfsSizeMb ?? SANDBOX_TMPFS_SIZE_MB
  const memory = `${spec.memoryLimitMb}m`

  return [
    "run",
    "--name",
    spec.containerName,
    // Isolation: no network, memory/CPU/PID ceilings, non-root, read-only root.
    "--network",
    "none",
    "--memory",
    memory,
    "--memory-swap",
    memory,
    "--cpus",
    String(cpuLimit),
    "--pids-limit",
    String(pidsLimit),
    "--read-only",
    "--tmpfs",
    `/tmp:rw,noexec,nosuid,nodev,size=${tmpfsSizeMb}M`,
    "--user",
    SANDBOX_USER,
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--ulimit",
    "nofile=128:128",
    "--ulimit",
    "core=0",
    // Reap zombies so a spawned child cannot pin the PID budget.
    "--init",
    "--workdir",
    "/tmp",
    "--env",
    "HOME=/tmp",
    ...runtime.env.flatMap((entry) => ["--env", entry]),
    // Payload (source + tests) arrives on stdin; nothing is bind-mounted.
    "-i",
    runtime.image,
    ...runtime.interpreterArgs,
  ]
}

/**
 * Machine-readable description of the guarantees, used by the isolation tests
 * and mirrored in `docs/features/code-eval.md`. Keeping it next to the builder
 * means a removed flag fails a test instead of silently weakening the sandbox.
 */
export const SANDBOX_ISOLATION_FLAGS: readonly {
  flag: string
  value?: string
  guarantee: string
}[] = [
  { flag: "--network", value: "none", guarantee: "no network egress" },
  { flag: "--memory", guarantee: "hard memory ceiling" },
  { flag: "--memory-swap", guarantee: "swap disabled (swap == memory)" },
  { flag: "--cpus", guarantee: "CPU ceiling" },
  { flag: "--pids-limit", guarantee: "fork-bomb ceiling" },
  { flag: "--read-only", guarantee: "read-only root filesystem" },
  { flag: "--tmpfs", guarantee: "minimal noexec scratch space" },
  { flag: "--user", value: SANDBOX_USER, guarantee: "non-root execution" },
  { flag: "--cap-drop", value: "ALL", guarantee: "no Linux capabilities" },
  {
    flag: "--security-opt",
    value: "no-new-privileges",
    guarantee: "no privilege escalation",
  },
] as const
