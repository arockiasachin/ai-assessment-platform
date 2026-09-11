import { NextResponse } from "next/server"

import { isLiveProvider } from "@/lib/llm/env"
import { LLM_PROVIDER_NAMES, type LlmProviderName } from "@/lib/llm/types"
import { withApiRoute } from "@/lib/observability/http"
import { prisma } from "@/lib/prisma"

/**
 * `GET /api/health` — a dependency-free service probe. No auth.
 *
 * Reports app liveness, database reachability, and the configured LLM provider
 * mode. It deliberately never returns the connection string, the raw provider
 * value, a database error message, or any filesystem path. The database check
 * is bounded by `HEALTH_DB_TIMEOUT_MS` (default 1s, clamped 50ms–10s) and is
 * skipped when no `DATABASE_URL` is configured, so a slow or absent database
 * degrades the response instead of hanging the endpoint.
 *
 * Returns 200 when healthy and 503 when the database check fails or times out.
 */

export const dynamic = "force-dynamic"

const DEFAULT_DB_TIMEOUT_MS = 1000
const MIN_DB_TIMEOUT_MS = 50
const MAX_DB_TIMEOUT_MS = 10_000
const MAX_BUILD_FIELD_CHARS = 64

type DatabaseCheck = {
  status: "ok" | "error" | "timeout" | "skipped"
  latencyMs: number | null
}

type LlmCheck = {
  provider: string
  mode: "offline" | "live" | "unknown"
}

class DatabaseTimeoutError extends Error {}

function resolveDbTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number((env.HEALTH_DB_TIMEOUT_MS ?? "").trim())
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DB_TIMEOUT_MS
  return Math.min(MAX_DB_TIMEOUT_MS, Math.max(MIN_DB_TIMEOUT_MS, Math.floor(parsed)))
}

async function checkDatabase(timeoutMs: number): Promise<DatabaseCheck> {
  if (!(process.env.DATABASE_URL ?? "").trim()) {
    return { status: "skipped", latencyMs: null }
  }

  const startedAt = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      prisma.$queryRawUnsafe("SELECT 1"),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new DatabaseTimeoutError("database health check timed out")),
          timeoutMs,
        )
      }),
    ])
    return { status: "ok", latencyMs: Date.now() - startedAt }
  } catch (error) {
    // The error message is intentionally dropped: a Prisma connection error can
    // embed the connection string.
    return {
      status: error instanceof DatabaseTimeoutError ? "timeout" : "error",
      latencyMs: Date.now() - startedAt,
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function resolveLlmCheck(env: NodeJS.ProcessEnv = process.env): LlmCheck {
  const raw = (env.LLM_PROVIDER ?? "").trim().toLowerCase()
  if (!raw) return { provider: "mock", mode: "offline" }
  const normalized = raw === "openai-compatible" || raw === "openai_compatible" ? "openai" : raw
  if (!(LLM_PROVIDER_NAMES as readonly string[]).includes(normalized)) {
    return { provider: "unknown", mode: "unknown" }
  }
  const provider = normalized as LlmProviderName
  return { provider, mode: isLiveProvider(provider) ? "live" : "offline" }
}

function firstNonEmpty(...values: (string | undefined)[]): string | null {
  for (const value of values) {
    const trimmed = (value ?? "").trim()
    if (trimmed) return trimmed.slice(0, MAX_BUILD_FIELD_CHARS)
  }
  return null
}

function resolveBuildInfo(env: NodeJS.ProcessEnv = process.env): {
  version: string | null
  commit: string | null
} {
  return {
    version: firstNonEmpty(env.APP_VERSION, env.npm_package_version),
    commit: firstNonEmpty(env.GIT_COMMIT_SHA, env.GITHUB_SHA, env.VERCEL_GIT_COMMIT_SHA),
  }
}

async function health(): Promise<NextResponse> {
  const database = await checkDatabase(resolveDbTimeoutMs())
  const llm = resolveLlmCheck()
  const build = resolveBuildInfo()
  const degraded = database.status === "error" || database.status === "timeout"

  return NextResponse.json(
    {
      success: true,
      status: degraded ? "degraded" : "ok",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      version: build.version,
      commit: build.commit,
      environment: process.env.NODE_ENV ?? "unknown",
      checks: {
        app: "ok",
        database,
        llm,
      },
    },
    { status: degraded ? 503 : 200 },
  )
}

export const GET = withApiRoute(health, { route: "/api/health" })
