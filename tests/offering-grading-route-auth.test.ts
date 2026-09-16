import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Route-level proof that the offering grading policy enforces its role and its body **before
 * any service or database work**.
 *
 * The service is mocked, so a denial cannot possibly write a policy. The session mechanism is
 * the local `signInAs` helper matching the other route-auth tests: cookies are mocked, the
 * session value is really signed, and `revalidateSessionActor` is stubbed because these
 * synthetic users have no `User` row.
 *
 * This matters more than for a typical settings route: a `PUT` here changes how every student's
 * final grade is computed, so an authorization hole would be a grade-tampering hole.
 */
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  getCookies: vi.fn(),
}))

vi.mock("@/lib/grading/offering-config-service", () => ({
  getOfferingGradingForTeacher: mocks.get,
  setOfferingGradingForTeacher: mocks.set,
}))

vi.mock("next/headers", () => ({
  cookies: () => mocks.getCookies(),
}))

vi.mock("@/lib/authz-actor", () => ({
  revalidateSessionActor: (user: unknown) => Promise.resolve(user),
}))

import { GET, PUT } from "@/app/api/teacher/offerings/[offeringId]/grading/route"
import { signSessionValue } from "@/lib/session"

const ADMIN = { id: "admin-1", email: "admin@test.local", role: "admin" as const }
const TEACHER = { id: "teacher-1", email: "teacher@test.local", role: "teacher" as const }
const STUDENT = { id: "student-1", email: "student@test.local", role: "student" as const }

function signInAs(user: typeof ADMIN | typeof TEACHER | typeof STUDENT | null) {
  mocks.getCookies.mockReturnValue({
    get: () => (user ? { name: "auth-user", value: signSessionValue(user) } : undefined),
  })
}

const VALID_BODY = {
  catWeight: 40,
  fatWeight: 60,
  finalAssessmentId: null,
  minimumCatPercent: 30,
}

function put(body: unknown, offeringId = "o1", raw = false) {
  return PUT(
    new Request("https://app.test/api/teacher/offerings/o1/grading", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: raw ? (body as string) : JSON.stringify(body),
    }),
    { params: Promise.resolve({ offeringId }) },
  )
}

function get(offeringId = "o1") {
  return GET(new Request("https://app.test/api/teacher/offerings/o1/grading"), {
    params: Promise.resolve({ offeringId }),
  })
}

describe("/api/teacher/offerings/[offeringId]/grading", () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.set.mockReset()
    mocks.getCookies.mockReset()
  })

  it("rejects anonymous, student and admin callers on both verbs, before the service runs", async () => {
    // `requireRole` distinguishes the two denials, and the distinction is worth keeping: 401
    // says "sign in", 403 says "this is not yours to change". They must not both be 403 or a
    // signed-out teacher gets an authorization error instead of a login prompt.
    for (const [user, expected] of [
      [null, 401],
      [STUDENT, 403],
      [ADMIN, 403],
    ] as const) {
      signInAs(user)

      const read = await get()
      const write = await put(VALID_BODY)

      const who = user === null ? "anonymous" : user.role
      expect(read.status, `GET as ${who}`).toBe(expected)
      expect(write.status, `PUT as ${who}`).toBe(expected)
    }

    expect(mocks.get).not.toHaveBeenCalled()
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it("rejects a body whose weights do not sum to 100 before the service runs", async () => {
    // The refinement is the point: a stored policy that does not sum to 100 would make the
    // export's own validator throw, so the write must be refused at the edge.
    signInAs(TEACHER)

    const response = await put({ ...VALID_BODY, catWeight: 40, fatWeight: 40 })

    expect(response.status).toBe(400)
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it.each([
    ["a negative weight", { ...VALID_BODY, catWeight: -1, fatWeight: 101 }],
    ["a weight above 100", { ...VALID_BODY, fatWeight: 101, catWeight: -1 }],
    ["a string weight", { ...VALID_BODY, catWeight: "40" }],
    ["a missing weight", { catWeight: 40, minimumCatPercent: 30, finalAssessmentId: null }],
    ["a completion ratio above 1", { ...VALID_BODY, minimumCatCompletionRatio: 2 }],
    ["a completion ratio of zero", { ...VALID_BODY, minimumCatCompletionRatio: 0 }],
    ["malformed JSON", "{"],
  ])("rejects %s before the service runs", async (_label, body) => {
    signInAs(TEACHER)

    const response = await put(body, "o1", body === "{")

    expect(response.status).toBe(400)
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it("accepts a valid body and passes the parsed policy to the service", async () => {
    signInAs(TEACHER)
    mocks.set.mockResolvedValue({
      kind: "ok",
      payload: { success: true, offeringId: "o1", roster: [] },
    })

    const response = await put(VALID_BODY)

    expect(response.status).toBe(200)
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ role: "teacher" }), "o1", {
      catWeight: 40,
      fatWeight: 60,
      finalAssessmentId: null,
      minimumCatPercent: 30,
    })
  })

  it("allows a disabled gate, which is null and not zero", async () => {
    // `null` means "no gate"; `0` would mean "the gate is at zero", which passes everyone but
    // reads as a configured rule. The contract must keep them distinct.
    signInAs(TEACHER)
    mocks.set.mockResolvedValue({
      kind: "ok",
      payload: { success: true, offeringId: "o1", roster: [] },
    })

    const response = await put({ ...VALID_BODY, minimumCatPercent: null })

    expect(response.status).toBe(200)
    expect(mocks.set).toHaveBeenCalledWith(expect.anything(), "o1", {
      catWeight: 40,
      fatWeight: 60,
      finalAssessmentId: null,
      minimumCatPercent: null,
    })
  })

  it("reports a non-owned offering as 404, not 403", async () => {
    // The service scopes its query by teacher, so it cannot tell "not yours" from "does not
    // exist" — and the route must not add a distinction the service deliberately does not make.
    signInAs(TEACHER)
    mocks.get.mockResolvedValue({ kind: "not-found" })
    mocks.set.mockResolvedValue({ kind: "not-found" })

    expect((await get()).status).toBe(404)
    expect((await put(VALID_BODY)).status).toBe(404)
  })

  it("rejects a final assessment that is not the offering's own with a 400", async () => {
    signInAs(TEACHER)
    mocks.set.mockResolvedValue({ kind: "invalid-final-assessment" })

    const response = await put({ ...VALID_BODY, finalAssessmentId: "other-offering-assessment" })

    expect(response.status).toBe(400)
    const body = (await response.json()) as { message: string }
    expect(body.message).toMatch(/final assessment/i)
  })

  it("returns the read payload unchanged for a valid request", async () => {
    signInAs(TEACHER)
    const payload = { success: true, offeringId: "o1", usingDefaults: true, roster: [] }
    mocks.get.mockResolvedValue({ kind: "ok", payload })

    const response = await get()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(payload)
    expect(mocks.get).toHaveBeenCalledWith(expect.objectContaining({ role: "teacher" }), "o1")
  })
})
