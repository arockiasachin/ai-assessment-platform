import { MOCK_STUDENT_BY_ID, MOCK_STUDENTS } from "./course"
import type {
  CatmeRatings,
  ContributionEvent,
  Group,
  GroupMember,
  Milestone,
  PeerEvaluation,
} from "./types"

/**
 * Collaborative work: teams, CATME peer evaluation, contribution evidence, and
 * milestones.
 *
 * The CATME dimension keys match `lib/groups/dimensions.ts` exactly
 * (`contributing`, `interacting`, `keepingOnTrack`, `expectingQuality`,
 * `knowledgeSkillsAbilities`) so an adjustment-factor panel can reuse the real
 * maths unchanged.
 *
 * Edge cases on purpose:
 *  - `Team Scalars` is FORMING with no members, no evaluations and no evidence —
 *    the empty state every list in this area must handle;
 *  - `Team Graphs` has members but nobody has started evaluating yet;
 *  - Ethan Brooks is a free-rider signal (low peer ratings + low contribution).
 */

const DIMENSION_KEYS = [
  "contributing",
  "interacting",
  "keepingOnTrack",
  "expectingQuality",
  "knowledgeSkillsAbilities",
] as const

function ratings(values: readonly [number, number, number, number, number]): CatmeRatings {
  return {
    contributing: values[0],
    interacting: values[1],
    keepingOnTrack: values[2],
    expectingQuality: values[3],
    knowledgeSkillsAbilities: values[4],
  }
}

function overall(ratingsByDimension: CatmeRatings): number {
  const total = DIMENSION_KEYS.reduce((sum, key) => sum + ratingsByDimension[key], 0)
  return Math.round((total / DIMENSION_KEYS.length) * 100) / 100
}

/**
 * Per-student peer rating profile. A student who is not listed falls back to the
 * group default, which keeps a full round-robin compact without hiding the
 * interesting rows.
 */
const PEER_PROFILES: Record<string, readonly [number, number, number, number, number]> = {
  stu_chen: [5, 5, 5, 4, 5],
  stu_hiroshi: [5, 4, 5, 5, 5],
  stu_diya: [3, 4, 3, 3, 4],
  stu_alexandria: [4, 4, 4, 4, 4],
  stu_aarav: [5, 4, 5, 4, 5],
  stu_farah: [4, 5, 4, 5, 4],
  stu_beatriz: [4, 4, 3, 4, 4],
  stu_ethan: [2, 3, 2, 2, 3],
  stu_gabriela: [4, 4, 4, 3, 4],
  stu_isaiah: [2, 3, 3, 3, 3],
  stu_mateo: [4, 3, 4, 4, 4],
  stu_priya: [5, 4, 4, 5, 4],
}

const DEFAULT_PROFILE: readonly [number, number, number, number, number] = [4, 4, 4, 4, 4]

function buildPeerEvaluations(groupId: string, memberIds: string[]): PeerEvaluation[] {
  const evaluations: PeerEvaluation[] = []
  for (const evaluatorId of memberIds) {
    for (const evaluateeId of memberIds) {
      if (evaluatorId === evaluateeId) continue
      // One draft per group so the "not everyone has submitted" state is real.
      const isDraft =
        evaluatorId === memberIds[memberIds.length - 1] && evaluateeId === memberIds[0]
      const profile = PEER_PROFILES[evaluateeId] ?? DEFAULT_PROFILE
      const dimensionRatings = ratings(profile)
      evaluations.push({
        id: `peer_${groupId}_${evaluatorId}_${evaluateeId}`,
        evaluatorId,
        evaluatorName: MOCK_STUDENT_BY_ID[evaluatorId]?.name ?? evaluatorId,
        evaluateeId,
        evaluateeName: MOCK_STUDENT_BY_ID[evaluateeId]?.name ?? evaluateeId,
        state: isDraft ? "DRAFT" : "SUBMITTED",
        ratings: isDraft ? null : dimensionRatings,
        overall: isDraft ? null : overall(dimensionRatings),
        comments: isDraft
          ? null
          : "Reliable on the parts they own; could share progress earlier in the week.",
        submittedAt: isDraft ? null : "2026-09-12T18:20:00.000Z",
      })
    }
  }
  return evaluations
}

function buildMembers(
  memberIds: string[],
  seeds: Record<
    string,
    { role: string | null; adjustmentFactor: number | null; freeRider: boolean }
  >,
): GroupMember[] {
  const sharingTotal = memberIds.reduce((sum, id) => sum + (seeds[id]?.freeRider ? 1 : 2), 0)
  return memberIds.map((studentId) => {
    const student = MOCK_STUDENT_BY_ID[studentId]
    const seed = seeds[studentId] ?? { role: null, adjustmentFactor: null, freeRider: false }
    const weight = seed.freeRider ? 1 : 2
    return {
      studentId,
      name: student?.name ?? studentId,
      registerNumber: student?.registerNumber ?? "—",
      role: seed.role,
      adjustmentFactor: seed.adjustmentFactor,
      selfAdjustmentFactor: seed.adjustmentFactor === null ? null : seed.adjustmentFactor + 0.03,
      contributionShare: Math.round((weight / sharingTotal) * 100),
      freeRider: seed.freeRider,
    }
  })
}

const VECTORS_MEMBERS = ["stu_chen", "stu_hiroshi", "stu_diya", "stu_alexandria"]
const MATRICES_MEMBERS = ["stu_aarav", "stu_farah", "stu_beatriz", "stu_ethan"]
const GRAPHS_MEMBERS = ["stu_gabriela", "stu_mateo", "stu_priya", "stu_isaiah"]

const VECTORS_MILESTONES: Milestone[] = [
  {
    id: "ms_vectors_1",
    title: "Dataset selection",
    description: "Agree the dataset and write the one-paragraph justification.",
    state: "COMPLETED",
    weight: 1,
    dueAt: "2026-09-05T13:30:00.000Z",
    completedAt: "2026-09-04T16:10:00.000Z",
  },
  {
    id: "ms_vectors_2",
    title: "Exploratory analysis notebook",
    description: "Summary statistics and three charts with annotations.",
    state: "COMPLETED",
    weight: 2,
    dueAt: "2026-09-12T13:30:00.000Z",
    completedAt: "2026-09-11T20:40:00.000Z",
  },
  {
    id: "ms_vectors_3",
    title: "Story outline",
    description: "Narrative arc and the two claims the story will support.",
    state: "IN_PROGRESS",
    weight: 2,
    dueAt: "2026-09-19T13:30:00.000Z",
    completedAt: null,
  },
  {
    id: "ms_vectors_4",
    title: "Peer evaluation round 1",
    description: "Everyone rates every teammate on the five CATME dimensions.",
    state: "PLANNED",
    weight: 1,
    dueAt: "2026-09-26T13:30:00.000Z",
    completedAt: null,
  },
]

const MATRICES_MILESTONES: Milestone[] = [
  {
    id: "ms_matrices_1",
    title: "Dataset selection",
    description: "Agree the dataset and write the one-paragraph justification.",
    state: "COMPLETED",
    weight: 1,
    dueAt: "2026-09-05T13:30:00.000Z",
    completedAt: "2026-09-05T11:05:00.000Z",
  },
  {
    id: "ms_matrices_2",
    title: "Exploratory analysis notebook",
    description: "Summary statistics and three charts with annotations.",
    state: "MISSED",
    weight: 2,
    dueAt: "2026-09-12T13:30:00.000Z",
    completedAt: null,
  },
  {
    id: "ms_matrices_3",
    title: "Story outline",
    description: "Narrative arc and the two claims the story will support.",
    state: "IN_PROGRESS",
    weight: 2,
    dueAt: "2026-09-19T13:30:00.000Z",
    completedAt: null,
  },
  {
    id: "ms_matrices_4",
    title: "Peer evaluation round 1",
    description: "Everyone rates every teammate on the five CATME dimensions.",
    state: "PLANNED",
    weight: 1,
    dueAt: "2026-09-26T13:30:00.000Z",
    completedAt: null,
  },
]

const GRAPHS_MILESTONES: Milestone[] = [
  {
    id: "ms_graphs_1",
    title: "Dataset selection",
    description: "Agree the dataset and write the one-paragraph justification.",
    state: "COMPLETED",
    weight: 1,
    dueAt: "2026-09-05T13:30:00.000Z",
    completedAt: "2026-09-06T09:30:00.000Z",
  },
  {
    id: "ms_graphs_2",
    title: "Exploratory analysis notebook",
    description: "Summary statistics and three charts with annotations.",
    state: "IN_PROGRESS",
    weight: 2,
    dueAt: "2026-09-12T13:30:00.000Z",
    completedAt: null,
  },
  {
    id: "ms_graphs_3",
    title: "Story outline",
    description: "Narrative arc and the two claims the story will support.",
    state: "PLANNED",
    weight: 2,
    dueAt: "2026-09-19T13:30:00.000Z",
    completedAt: null,
  },
]

function buildContributions(
  groupId: string,
  memberIds: string[],
  freeRiderId: string | null,
): ContributionEvent[] {
  const summaries: { kind: ContributionEvent["kind"]; summary: string }[] = [
    { kind: "COMMIT", summary: "Pushed 3 commits to notebooks/exploration.ipynb" },
    { kind: "PULL_REQUEST", summary: "Opened PR #14 — add summary statistics" },
    { kind: "REVIEW", summary: "Reviewed PR #14 and left 4 comments" },
    { kind: "ISSUE", summary: "Opened issue #9 — missing 2019 rows" },
    { kind: "COMMIT", summary: "Pushed 1 commit to report/outline.md" },
    { kind: "MANUAL", summary: "Marked milestone 2 complete" },
  ]
  const events: ContributionEvent[] = []
  const contributors = memberIds.filter((id) => id !== freeRiderId)
  let index = 0
  for (const studentId of contributors) {
    for (const entry of summaries.slice(0, 2)) {
      events.push({
        id: `contrib_${groupId}_${studentId}_${index}`,
        studentId,
        studentName: MOCK_STUDENT_BY_ID[studentId]?.name ?? studentId,
        kind: entry.kind,
        summary: entry.summary,
        occurredAt: `2026-09-${String(8 + index).padStart(2, "0")}T14:20:00.000Z`,
        weight: 1,
      })
      index += 1
    }
  }
  if (freeRiderId) {
    events.push({
      id: `contrib_${groupId}_${freeRiderId}_0`,
      studentId: freeRiderId,
      studentName: MOCK_STUDENT_BY_ID[freeRiderId]?.name ?? freeRiderId,
      kind: "COMMIT",
      summary: "Pushed 1 commit to report/outline.md",
      occurredAt: "2026-09-10T21:05:00.000Z",
      weight: 0.25,
    })
  }
  return events
}

function lastActivity(events: ContributionEvent[]): string {
  return events.reduce(
    (latest, event) => (event.occurredAt > latest ? event.occurredAt : latest),
    "2026-09-01T00:00:00.000Z",
  )
}

const vectorsContributions = buildContributions("grp_vectors", VECTORS_MEMBERS, null)
const matricesContributions = buildContributions("grp_matrices", MATRICES_MEMBERS, "stu_ethan")
const graphsContributions = buildContributions("grp_graphs", GRAPHS_MEMBERS, "stu_isaiah")

export const MOCK_GROUPS: Group[] = [
  {
    id: "grp_vectors",
    name: "Team Vectors",
    projectTitle: "Mobility trends in the 2025 city dataset",
    state: "ACTIVE",
    members: buildMembers(VECTORS_MEMBERS, {
      stu_chen: { role: "Lead", adjustmentFactor: 1.06, freeRider: false },
      stu_hiroshi: { role: "Analyst", adjustmentFactor: 1.04, freeRider: false },
      stu_diya: { role: null, adjustmentFactor: 0.96, freeRider: false },
      stu_alexandria: { role: "Writer", adjustmentFactor: 1.0, freeRider: false },
    }),
    peerEvaluations: buildPeerEvaluations("grp_vectors", VECTORS_MEMBERS),
    milestones: VECTORS_MILESTONES,
    contributions: vectorsContributions,
    avgContribution: 1.02,
    lastActivityAt: lastActivity(vectorsContributions),
    similarityFlag: true,
  },
  {
    id: "grp_matrices",
    name: "Team Matrices",
    projectTitle: "Attendance and attainment: is the link real?",
    state: "ACTIVE",
    members: buildMembers(MATRICES_MEMBERS, {
      stu_aarav: { role: "Lead", adjustmentFactor: 1.05, freeRider: false },
      stu_farah: { role: "Analyst", adjustmentFactor: 1.03, freeRider: false },
      stu_beatriz: { role: null, adjustmentFactor: 0.99, freeRider: false },
      stu_ethan: { role: null, adjustmentFactor: 0.85, freeRider: true },
    }),
    peerEvaluations: buildPeerEvaluations("grp_matrices", MATRICES_MEMBERS),
    milestones: MATRICES_MILESTONES,
    contributions: matricesContributions,
    avgContribution: 0.94,
    lastActivityAt: lastActivity(matricesContributions),
    similarityFlag: true,
  },
  {
    id: "grp_graphs",
    name: "Team Graphs",
    projectTitle: "Which campus service is used most, and by whom?",
    state: "ACTIVE",
    members: buildMembers(GRAPHS_MEMBERS, {
      stu_gabriela: { role: "Lead", adjustmentFactor: 1.01, freeRider: false },
      stu_mateo: { role: "Analyst", adjustmentFactor: 1.0, freeRider: false },
      stu_priya: { role: "Writer", adjustmentFactor: 1.03, freeRider: false },
      stu_isaiah: { role: null, adjustmentFactor: 0.9, freeRider: true },
    }),
    // Nobody in this team has started the peer evaluation round yet.
    peerEvaluations: [],
    milestones: GRAPHS_MILESTONES,
    contributions: graphsContributions,
    avgContribution: 0.97,
    lastActivityAt: lastActivity(graphsContributions),
    similarityFlag: false,
  },
  {
    id: "grp_scalars",
    name: "Team Scalars",
    projectTitle: "Not yet assigned",
    state: "FORMING",
    members: [],
    peerEvaluations: [],
    milestones: [],
    contributions: [],
    avgContribution: 0,
    lastActivityAt: "2026-09-15T07:00:00.000Z",
    similarityFlag: false,
  },
]

export const MOCK_GROUP_BY_ID: Record<string, Group> = Object.fromEntries(
  MOCK_GROUPS.map((group) => [group.id, group]),
)

/** Every evaluation the demo student has submitted, for the student view. */
export const MOCK_MY_PEER_EVALUATIONS = MOCK_GROUP_BY_ID["grp_matrices"].peerEvaluations.filter(
  (evaluation) => evaluation.evaluatorId === "stu_aarav",
)

export const MOCK_UNASSIGNED_STUDENTS = MOCK_STUDENTS.filter((student) => student.groupId === null)
