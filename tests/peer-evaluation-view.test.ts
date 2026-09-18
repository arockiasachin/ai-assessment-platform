import { describe, expect, it } from "vitest"

import {
  peerDisclosureCopy,
  peerDisclosureState,
  peerThresholdNotice,
} from "@/lib/peer-evaluation-view"

const required = 3

describe("peerDisclosureState", () => {
  it("is available once the server releases the aggregate", () => {
    expect(
      peerDisclosureState({
        withheld: false,
        ratingCount: 3,
        minRatersRequired: required,
        otherMemberCount: 3,
      }),
    ).toEqual({ kind: "available" })
  })

  it("is collecting while a reachable threshold is still short", () => {
    // A four-person team can produce three non-self raters, so "2 of 3 needed" is real progress.
    expect(
      peerDisclosureState({
        withheld: true,
        ratingCount: 2,
        minRatersRequired: required,
        otherMemberCount: 3,
      }),
    ).toEqual({ kind: "collecting", received: 2, required: 3 })
  })

  it("is unreachable when the team cannot produce enough non-self raters (SN-30)", () => {
    // The seeded three-person team: two other members, threshold three. No progress bar can open.
    expect(
      peerDisclosureState({
        withheld: true,
        ratingCount: 2,
        minRatersRequired: required,
        otherMemberCount: 2,
      }),
    ).toEqual({ kind: "unreachable", otherMembers: 2, required: 3 })
  })

  it("is unreachable for a solo member", () => {
    expect(
      peerDisclosureState({
        withheld: true,
        ratingCount: 0,
        minRatersRequired: required,
        otherMemberCount: 0,
      }),
    ).toEqual({ kind: "unreachable", otherMembers: 0, required: 3 })
  })
})

describe("peerDisclosureCopy", () => {
  it("offers a progress count only when the threshold is reachable", () => {
    const collecting = peerDisclosureCopy({ kind: "collecting", received: 1, required: 3 })
    expect(collecting.showProgress).toBe(true)

    const unreachable = peerDisclosureCopy({ kind: "unreachable", otherMembers: 2, required: 3 })
    expect(unreachable.showProgress).toBe(false)
  })

  it("explains the unreachable case without stating a progress count", () => {
    const copy = peerDisclosureCopy({ kind: "unreachable", otherMembers: 2, required: 3 })
    expect(copy.title).toBe("Results stay private for this team")
    expect(copy.detail).toContain("2 other members")
    expect(copy.detail).toContain("at least 3")
    // The defect was the phrase "2 of 3 needed"; the panel must not render it as a goal.
    expect(copy.detail).not.toContain("of 3")
  })

  it("uses the singular noun for a one-member team", () => {
    const copy = peerDisclosureCopy({ kind: "unreachable", otherMembers: 1, required: 3 })
    expect(copy.detail).toContain("1 other member")
    expect(copy.detail).not.toContain("1 other members")
  })
})

describe("peerThresholdNotice", () => {
  it("names the team size instead of an unreachable count", () => {
    const notice = peerThresholdNotice({ kind: "unreachable", otherMembers: 2, required: 3 })
    expect(notice).toContain("only 2 other members")
    expect(notice).toContain("stays private")
  })

  it("shows real progress while collecting", () => {
    const notice = peerThresholdNotice({ kind: "collecting", received: 1, required: 3 })
    expect(notice).toContain("1 of 3 so far")
  })

  it("says the aggregate is shown once it is available", () => {
    expect(peerThresholdNotice({ kind: "available" })).toContain("Results are shown")
  })
})
