import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Route-level proof that the retention triggers enforce their roles and
 * contracts before any service (or database) runs. Both services are mocked, so
 * a denial can never purge or publish anything.
 */
const mocks = vi.hoisted(() => ({
  runRetentionPurge: vi.fn(),
  publishOfferingResults: vi.fn(),
  getCookies: vi.fn(),
}))

vi.mock("@/lib/retention/purge", () => ({
  runRetentionPurge: mocks.runRetentionPurge,
}))

vi.mock("@/lib/retention/results-publication", () => ({
  publishOfferingResults: mocks.publishOfferingResults,
}))

vi.mock("next/headers", () => ({
  cookies: () => mocks.getCookies(),
}))

// Synthetic sessions with no User row: database re-validation is covered by the
// database-backed tests.
vi.mock("@/lib/authz-actor", () => ({
  revalidateSessionActor: (user: unknown) => Promise.resolve(user),
}))

import { POST as purgeRetention } from "@/app/api/admin/retention/purge/route"
import { POST as publishResults } from "@/app/api/teacher/offerings/[offeringId]/results/route"
import { signSessionValue } from "@/lib/session"

const ADMIN = { id: "admin-1", email: "admin@test.local", role: "admin" as const }
const TEACHER = { id: "teacher-1", email: "teacher@test.local", role: "teacher" as const }
const STUDENT = { id: "student-1", email: "student@test.local", role: "student" as const }

function useSession(user: typeof ADMIN | typeof TEACHER | typeof STUDENT | null) {
  mocks.getCookies.mockReturnValue({
    get: () => (user ? { name: "auth-user", value: signSessionValue(user) } : undefined),
  })
}

function purge(body: unknown, raw = false) {
  return purgeRetention(
    new Request("https://app.test/api/admin/retention/purge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ? (body as string) : JSON.stringify(body),
    }),
  )
}

function publish(offeringId = "o1") {
  return publishResults(new Request("https://app.test/x", { method: "POST" }), {
    params: Promise.resolve({ offeringId }),
  })
}

const REPORT = { dryRun: true, totals: {}, eligibleOfferings: 0 }

describe("POST /api/admin/retention/purge authorization", () => {
  beforeEach(() => {
    mocks.runRetentionPurge.mockReset()
    mocks.publishOfferingResults.mockReset()
    mocks.getCookies.mockReset()
  })

  it("rejects anonymous and non-admin callers before the service runs", async () => {
    useSession(null)
    expect((await purge({})).status).toBe(401)

    useSession(STUDENT)
    expect((await purge({})).status).toBe(403)

    useSession(TEACHER)
    expect((await purge({})).status).toBe(403)

    expect(mocks.runRetentionPurge).not.toHaveBeenCalled()
  })

  it("defaults to a dry run and only executes when explicitly asked", async () => {
    useSession(ADMIN)
    mocks.runRetentionPurge.mockResolvedValue(REPORT)

    expect((await purge({})).status).toBe(200)
    expect(mocks.runRetentionPurge).toHaveBeenLastCalledWith({ dryRun: true })

    expect((await purge({ dryRun: false })).status).toBe(200)
    expect(mocks.runRetentionPurge).toHaveBeenLastCalledWith({ dryRun: false })

    expect(mocks.runRetentionPurge).toHaveBeenCalledTimes(2)
  })

  it("rejects an invalid body without touching the service", async () => {
    useSession(ADMIN)

    expect((await purge({ dryRun: "yes" })).status).toBe(400)
    expect((await purge("{not json", true)).status).toBe(400)

    expect(mocks.runRetentionPurge).not.toHaveBeenCalled()
  })
})

describe("POST /api/teacher/offerings/[offeringId]/results authorization", () => {
  beforeEach(() => {
    mocks.publishOfferingResults.mockReset()
    mocks.getCookies.mockReset()
  })

  it("rejects anonymous and non-teacher callers before the service runs", async () => {
    useSession(null)
    expect((await publish()).status).toBe(401)

    useSession(STUDENT)
    expect((await publish()).status).toBe(403)

    expect(mocks.publishOfferingResults).not.toHaveBeenCalled()
  })

  it("passes an authorized request through with the offering id", async () => {
    useSession(TEACHER)
    mocks.publishOfferingResults.mockResolvedValue({
      kind: "published",
      offeringId: "o42",
      resultsPublishedAt: new Date("2026-09-01T00:00:00.000Z"),
      retentionCutoff: new Date("2026-09-16T00:00:00.000Z"),
    })

    const response = await publish("o42")
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      success: boolean
      alreadyPublished: boolean
      retentionCutoff: string
    }
    expect(body.success).toBe(true)
    expect(body.alreadyPublished).toBe(false)
    expect(body.retentionCutoff).toBe("2026-09-16T00:00:00.000Z")
    expect(mocks.publishOfferingResults).toHaveBeenCalledWith(
      { id: "teacher-1", email: "teacher@test.local", role: "teacher" },
      "o42",
    )
  })

  it("is idempotent for an already-published offering", async () => {
    useSession(TEACHER)
    mocks.publishOfferingResults.mockResolvedValue({
      kind: "already-published",
      offeringId: "o1",
      resultsPublishedAt: new Date("2026-09-01T00:00:00.000Z"),
      retentionCutoff: new Date("2026-09-16T00:00:00.000Z"),
    })

    const response = await publish()
    expect(response.status).toBe(200)
    const body = (await response.json()) as { alreadyPublished: boolean }
    expect(body.alreadyPublished).toBe(true)
  })

  it("reports a foreign or missing offering as 404 without confirming existence", async () => {
    useSession(TEACHER)

    mocks.publishOfferingResults.mockResolvedValue({ kind: "not-found" })
    expect((await publish("someone-elses")).status).toBe(404)

    mocks.publishOfferingResults.mockResolvedValue({ kind: "staff-profile-missing" })
    expect((await publish("o1")).status).toBe(404)
  })
})
