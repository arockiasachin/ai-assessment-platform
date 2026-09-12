import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ queryRawUnsafe: vi.fn() }))

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRawUnsafe: mocks.queryRawUnsafe },
}))

import { GET } from "@/app/api/health/route"

const ENV_KEYS = [
  "DATABASE_URL",
  "HEALTH_DB_TIMEOUT_MS",
  "LLM_PROVIDER",
  "EMBEDDINGS_PROVIDER",
  "APP_VERSION",
  "GIT_COMMIT_SHA",
  "GITHUB_SHA",
  "VERCEL_GIT_COMMIT_SHA",
] as const

const SECRET_URL =
  "postgresql://assessment_user:supersecret@db.internal:5432/assessment_observability_test"

let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = {}
  for (const key of ENV_KEYS) saved[key] = process.env[key]
  process.env.DATABASE_URL = SECRET_URL
  process.env.LLM_PROVIDER = "mock"
  delete process.env.EMBEDDINGS_PROVIDER
  delete process.env.HEALTH_DB_TIMEOUT_MS
  mocks.queryRawUnsafe.mockReset()
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  mocks.queryRawUnsafe.mockReset()
})

function call() {
  return GET(new Request("https://app.test/api/health"), undefined)
}

type LlmCheck = { provider: string; mode: string }
type LlmChecks = { generation: LlmCheck; embeddings: LlmCheck }

describe("GET /api/health", () => {
  it("reports ok without auth and never leaks the connection string", async () => {
    mocks.queryRawUnsafe.mockResolvedValue([{ ok: 1 }])
    const response = await call()

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      status: string
      checks: { app: string; database: { status: string }; llm: LlmChecks }
    }
    expect(body.status).toBe("ok")
    expect(body.checks.app).toBe("ok")
    expect(body.checks.database.status).toBe("ok")
    expect(body.checks.llm).toEqual({
      generation: { provider: "mock", mode: "offline" },
      embeddings: { provider: "mock", mode: "offline" },
    })
    expect(response.headers.get("x-request-id")).toBeTruthy()

    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain("supersecret")
    expect(serialized).not.toContain("db.internal")
    expect(serialized).not.toContain("postgresql")
    expect(serialized).not.toContain("/Users")
  })

  it("degrades to 503 on a database error without echoing the error", async () => {
    mocks.queryRawUnsafe.mockRejectedValue(
      new Error(`connect ECONNREFUSED ${SECRET_URL} at /Users/secret/internal.ts`),
    )
    const response = await call()

    expect(response.status).toBe(503)
    const body = (await response.json()) as {
      status: string
      checks: { database: { status: string; latencyMs: number | null } }
    }
    expect(body.status).toBe("degraded")
    expect(body.checks.database.status).toBe("error")
    expect(typeof body.checks.database.latencyMs).toBe("number")

    const serialized = JSON.stringify(body)
    for (const fragment of ["supersecret", "db.internal", "postgresql", "ECONNREFUSED", "/Users"]) {
      expect(serialized).not.toContain(fragment)
    }
  })

  it("bounds a slow database check with a timeout", async () => {
    process.env.HEALTH_DB_TIMEOUT_MS = "50"
    mocks.queryRawUnsafe.mockReturnValue(new Promise(() => {}))

    const response = await call()
    expect(response.status).toBe(503)
    const body = (await response.json()) as { checks: { database: { status: string } } }
    expect(body.checks.database.status).toBe("timeout")
  })

  it("skips the database check when no connection is configured", async () => {
    delete process.env.DATABASE_URL
    const response = await call()

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      status: string
      checks: { database: { status: string } }
    }
    expect(body.status).toBe("ok")
    expect(body.checks.database.status).toBe("skipped")
    expect(mocks.queryRawUnsafe).not.toHaveBeenCalled()
  })

  it("reports the configured LLM mode without instantiating the provider", async () => {
    mocks.queryRawUnsafe.mockResolvedValue([{ ok: 1 }])

    process.env.LLM_PROVIDER = "openai"
    const live = (await (await call()).json()) as { checks: { llm: LlmChecks } }
    expect(live.checks.llm).toEqual({
      generation: { provider: "openai", mode: "live" },
      embeddings: { provider: "openai", mode: "live" },
    })

    process.env.LLM_PROVIDER = "deepseek"
    const deepseek = (await (await call()).json()) as { checks: { llm: LlmChecks } }
    expect(deepseek.checks.llm).toEqual({
      generation: { provider: "deepseek", mode: "live" },
      embeddings: { provider: "deepseek", mode: "live" },
    })

    process.env.LLM_PROVIDER = "not-a-provider"
    const unknown = (await (await call()).json()) as { checks: { llm: LlmChecks } }
    expect(unknown.checks.llm).toEqual({
      generation: { provider: "unknown", mode: "unknown" },
      embeddings: { provider: "unknown", mode: "unknown" },
    })
  })

  it("reports generation and embeddings separately when they differ", async () => {
    mocks.queryRawUnsafe.mockResolvedValue([{ ok: 1 }])

    process.env.LLM_PROVIDER = "deepseek"
    process.env.EMBEDDINGS_PROVIDER = "openai"
    const split = (await (await call()).json()) as { checks: { llm: LlmChecks } }
    expect(split.checks.llm).toEqual({
      generation: { provider: "deepseek", mode: "live" },
      embeddings: { provider: "openai", mode: "live" },
    })

    // A blank EMBEDDINGS_PROVIDER inherits LLM_PROVIDER.
    process.env.EMBEDDINGS_PROVIDER = "   "
    const inherited = (await (await call()).json()) as { checks: { llm: LlmChecks } }
    expect(inherited.checks.llm).toEqual({
      generation: { provider: "deepseek", mode: "live" },
      embeddings: { provider: "deepseek", mode: "live" },
    })

    // An unknown embeddings value degrades to unknown without failing the probe.
    process.env.EMBEDDINGS_PROVIDER = "nope"
    const badEmbeddings = (await (await call()).json()) as { checks: { llm: LlmChecks } }
    expect(badEmbeddings.checks.llm).toEqual({
      generation: { provider: "deepseek", mode: "live" },
      embeddings: { provider: "unknown", mode: "unknown" },
    })
  })
})
