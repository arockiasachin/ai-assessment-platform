/**
 * Pure display logic for the student peer-evaluation disclosure panel.
 *
 * The server's threshold (`MIN_RATERS_FOR_DISCLOSURE = 3` in
 * `lib/groups/student-service.ts`) is a **confidentiality minimum**: it is
 * deliberately larger than the number of raters the smallest team can produce.
 * For a three-person team the maximum non-self raters is two, so
 * `received.withheld` is always true and the panel used to say "2 of 3 needed" —
 * which reads as progress toward a gate that can never open (SN-30).
 *
 * The threshold is the privacy control and does not move (D5 in
 * `docs/plans/wave-1.md`; `tests/groups-peer-evaluation.test.ts` pins 3), so the
 * copy is the side that changes: the state is resolved here and the panel no
 * longer renders a progress count when the threshold is unreachable. One
 * definition serves the round-progress notice and the received-ratings panel, so
 * the two cannot describe the same fact differently.
 */

export type PeerDisclosureState =
  | { kind: "available" }
  | { kind: "collecting"; received: number; required: number }
  | {
      kind: "unreachable"
      /** Non-self team members: the upper bound on distinct raters. */
      otherMembers: number
      required: number
    }

export function peerDisclosureState(input: {
  withheld: boolean
  ratingCount: number
  minRatersRequired: number
  otherMemberCount: number
}): PeerDisclosureState {
  if (!input.withheld) return { kind: "available" }
  // Fewer possible raters than the rule needs: the gate is not "not yet", it can
  // never open for this team.
  if (input.otherMemberCount < input.minRatersRequired) {
    return {
      kind: "unreachable",
      otherMembers: input.otherMemberCount,
      required: input.minRatersRequired,
    }
  }
  return {
    kind: "collecting",
    received: input.ratingCount,
    required: input.minRatersRequired,
  }
}

export type PeerDisclosureCopy = {
  tone: "info" | "warning" | "success"
  title: string
  detail: string
  /** Only a reachable, incomplete threshold is progress the panel may show. */
  showProgress: boolean
}

function memberNoun(count: number): string {
  return count === 1 ? "member" : "members"
}

/** The "How your teammates rated you" panel's copy and whether it shows progress. */
export function peerDisclosureCopy(state: PeerDisclosureState): PeerDisclosureCopy {
  switch (state.kind) {
    case "available":
      return {
        tone: "success",
        title: "Results available",
        detail:
          "The aggregate is anonymous by construction: nothing here carries a rater identity.",
        showProgress: false,
      }
    case "collecting":
      return {
        tone: "info",
        title: "Not shown yet",
        detail: `Results are shown only after at least ${state.required} teammates have submitted, so individual ratings stay confidential.`,
        showProgress: true,
      }
    case "unreachable":
      return {
        tone: "warning",
        title: "Results stay private for this team",
        detail:
          `A result is disclosed only after at least ${state.required} teammates have rated you, ` +
          `but this team has only ${state.otherMembers} other ${memberNoun(state.otherMembers)}. ` +
          `That many raters can never exist here, so the aggregate stays withheld — the minimum ` +
          `is a confidentiality rule, not a progress bar.`,
        showProgress: false,
      }
  }
}

/** The threshold sentence in the round-progress card, resolved for the team size. */
export function peerThresholdNotice(state: PeerDisclosureState): string {
  switch (state.kind) {
    case "available":
      return "Results are shown because enough teammates have rated you. You will never see who rated you."
    case "collecting":
      return (
        `Results appear only after at least ${state.required} of your teammates have rated you, ` +
        `so no individual rating can be attributed. ${state.received} of ${state.required} so far. ` +
        `You will never see who rated you.`
      )
    case "unreachable":
      return (
        `Results would appear only after at least ${state.required} of your teammates had rated you, ` +
        `but this team has only ${state.otherMembers} other ${memberNoun(state.otherMembers)} — fewer ` +
        `than that rule needs. The aggregate therefore stays private, and you will never see who rated you.`
      )
  }
}
