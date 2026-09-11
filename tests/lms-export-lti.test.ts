import { afterEach, describe, expect, it, vi } from "vitest"

import {
  AGS_SCORE_CONTENT_TYPE,
  LmsExportValidationError,
  LtiConfigurationError,
  LtiUnpublishedGradeError,
  buildAgsLineItemPayload,
  buildAgsScorePayload,
  createDryRunLtiAgsClient,
  requireLtiAgsConfig,
  validateLtiAgsConfig,
} from "@/lib/lms-export"

const VALID_ENV = {
  LTI_PLATFORM_ISSUER: "https://lms.example",
  LTI_CLIENT_ID: "client-1",
  LTI_DEPLOYMENT_ID: "deployment-1",
  LTI_KEY_ID: "key-1",
  LTI_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
  LTI_AGS_LINEITEMS_URL: "https://lms.example/ags/lineitems",
}

describe("buildAgsScorePayload", () => {
  it("builds an application/vnd.ims.lis.v1.score+json payload from a published grade", () => {
    const payload = buildAgsScorePayload({
      grade: {
        assessmentId: "a1",
        studentId: "s1",
        points: 16,
        maxPoints: 20,
        publishedAt: new Date("2026-11-01T10:00:00.000Z"),
      },
      ltiUserId: "lti-user-1",
      comment: "Nice work",
      timestamp: new Date("2026-11-03T10:00:00.000Z"),
    })

    expect(payload).toEqual({
      userId: "lti-user-1",
      timestamp: "2026-11-03T10:00:00.000Z",
      scoreGiven: 16,
      scoreMaximum: 20,
      comment: "Nice work",
      activityProgress: "Completed",
      gradingProgress: "FullyGraded",
    })
    expect(AGS_SCORE_CONTENT_TYPE).toBe("application/vnd.ims.lis.v1.score+json")
  })

  it("refuses to build a score for an unpublished grade", () => {
    expect(() =>
      buildAgsScorePayload({
        grade: {
          assessmentId: "a1",
          studentId: "s1",
          points: 20,
          maxPoints: 20,
          publishedAt: null,
        },
        ltiUserId: "lti-user-1",
      }),
    ).toThrowError(LtiUnpublishedGradeError)
  })

  it("rejects an out-of-range score or a missing user id", () => {
    expect(() =>
      buildAgsScorePayload({
        grade: {
          assessmentId: "a1",
          studentId: "s1",
          points: 25,
          maxPoints: 20,
          publishedAt: new Date(),
        },
        ltiUserId: "lti-user-1",
      }),
    ).toThrowError(/between 0 and 20/)
    expect(() =>
      buildAgsScorePayload({
        grade: {
          assessmentId: "a1",
          studentId: "s1",
          points: 10,
          maxPoints: 20,
          publishedAt: new Date(),
        },
        ltiUserId: "  ",
      }),
    ).toThrowError(LmsExportValidationError)
  })
})

describe("buildAgsLineItemPayload", () => {
  it("builds a LineItem payload for an assessment", () => {
    const payload = buildAgsLineItemPayload(
      {
        id: "a1",
        title: "Midterm",
        type: "QUIZ",
        maxMarks: 20,
        dueDate: new Date("2026-10-01T08:00:00.000Z"),
      },
      { tag: "Exams" },
    )
    expect(payload).toEqual({
      scoreMaximum: 20,
      label: "Midterm",
      resourceId: "assessment:a1",
      tag: "Exams",
      endDateTime: "2026-10-01T08:00:00.000Z",
    })
  })

  it("rejects an assessment with no ceiling", () => {
    expect(() => buildAgsLineItemPayload({ id: "a1", title: "Midterm", maxMarks: 0 })).toThrowError(
      LmsExportValidationError,
    )
  })
})

describe("LTI AGS configuration", () => {
  it("reports every missing variable with an actionable message", () => {
    const status = validateLtiAgsConfig({})
    expect(status.configured).toBe(false)
    if (status.configured) return
    expect(status.missing).toHaveLength(6)
    expect(status.message).toContain("LTI_PLATFORM_ISSUER")
    expect(status.message).toContain("migration")
  })

  it("returns the parsed configuration and scopes when complete", () => {
    const status = validateLtiAgsConfig(VALID_ENV)
    expect(status.configured).toBe(true)
    if (!status.configured) return
    expect(status.config.clientId).toBe("client-1")
    expect(status.config.scopes).toContain("https://purl.imsglobal.org/spec/lti-ags/scope/score")
  })

  it("throws a 422 when configuration is required but incomplete", () => {
    expect(() => requireLtiAgsConfig({})).toThrowError(LtiConfigurationError)
    try {
      requireLtiAgsConfig({})
    } catch (error) {
      expect((error as LtiConfigurationError).status).toBe(422)
    }
  })
})

describe("dry-run AGS client", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("records calls in memory and issues deterministic ids without networking", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("network is disabled in tests")
    })
    vi.stubGlobal("fetch", fetchSpy)

    const client = createDryRunLtiAgsClient({
      now: () => new Date("2026-11-03T10:00:00.000Z"),
    })
    expect(client.mode).toBe("dry-run")

    const lineItem = await client.lineItems.createLineItem({
      scoreMaximum: 20,
      label: "Midterm",
      resourceId: "assessment:a1",
    })
    expect(lineItem.id).toBe("lineitem-1")
    expect(lineItem.lineItemUrl).toBe("https://lms.invalid/ags/lineitems/lineitem-1")

    const receipt = await client.scores.putScore(lineItem.id, {
      userId: "lti-user-1",
      timestamp: "2026-11-03T10:00:00.000Z",
      scoreGiven: 16,
      scoreMaximum: 20,
      activityProgress: "Completed",
      gradingProgress: "FullyGraded",
    })
    expect(receipt.acceptedAt).toBe("2026-11-03T10:00:00.000Z")

    const results = await client.results.listResults(lineItem.id)
    expect(results).toEqual([
      {
        id: "lineitem-1-result-1",
        lineItemId: "lineitem-1",
        userId: "lti-user-1",
        scoreGiven: 16,
        scoreMaximum: 20,
      },
    ])
    expect(client.log.map((entry) => entry.operation)).toEqual([
      "createLineItem",
      "putScore",
      "listResults",
    ])
    // Structural no-network property: even with fetch stubbed to throw, nothing
    // in the dry-run path ever reached for it.
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
