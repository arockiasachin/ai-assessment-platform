# Feature: team formation, peer evaluation, contribution tracking and milestones (Phase 2, pod 4)

The CATME model of collaborative projects: instructor-weighted team formation that
maximises the worst-fitting team, confidential behaviourally-anchored peer
evaluation on the five established dimensions, adjustment factors that convert a
group grade into individual grades, free-rider detection, contribution signals as
secondary evidence, and milestones.

Merged to `dev` in `675dfa0` (`feat(groups): CATME team formation, confidential peer evaluation,
contribution evidence and milestones`); the `p2/groups-peereval` branch was deleted after merging.

## Goal and product rules

This pod implements product-spec §5 (collaborative projects) and keeps the rules
it touches intact:

- **Teacher approves every grade.** Adjustment factors and per-student grade
  suggestions are computed and returned; nothing is published here. Publication
  stays in the gradebook's teacher-approval flow.
- **Confidentiality is a hard rule.** A student can never see who rated them, and
  can never see another team's evaluations.
- **Contribution is evidence, never the sole basis for a grade.** Every
  contribution payload carries `{ evidenceOnly: true, gradeBasis: false, notice }`
  and the free-rider detector refuses to flag a member on contribution alone.

## API surface

### Teacher — `app/api/teacher/groups/**`

All routes are `requireRole("teacher")` **plus** an object-level ownership check
(`CourseOffering.teacherId === staffId` for the offering, and the group's offering
for a group).

| Method + path                                        | Input                                                                                            | Output                                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `GET /api/teacher/groups`                            | `?offeringId=` optional                                                                          | `{ success, groups: GroupSummary[] }`                                                               |
| `POST /api/teacher/groups`                           | `{ offeringId, name, projectTitle?, studentIds[] }`                                              | `{ success, message, group }` — manual team                                                         |
| `GET /api/teacher/groups/[groupId]`                  | path                                                                                             | `{ success, group, milestones }`                                                                    |
| `PATCH /api/teacher/groups/[groupId]`                | `{ name?, projectTitle?, status?, addStudentIds?, removeStudentIds? }`                           | `{ success, group }` — members are soft-removed (`leftAt`)                                          |
| `GET /api/teacher/groups/roster`                     | `?offeringId=`                                                                                   | `{ success, students }` — active enrollment                                                         |
| `POST /api/teacher/groups/form`                      | `{ offeringId, criteria[], students[]?, teamSize?, teamCount?, persist?, groupNamePrefix? }`     | `{ success, formation, persistedGroupIds }`                                                         |
| `GET /api/teacher/groups/analysis`                   | `?offeringId=`, `?assessmentId=` optional, `?groupGrade=` optional                               | `{ success, analysis[], cohortProgress[] }` — factors both ways, free-riders, evidence, grade hints |
| `GET /api/teacher/groups/contributions`              | `?groupId=`                                                                                      | `{ success, evidence }` — evidence-stamped                                                          |
| `POST /api/teacher/groups/contributions`             | `{ groupId, events[{ studentId?, type, source?, externalId?, summary?, weight?, occurredAt }] }` | `{ success, recorded, evidence }`                                                                   |
| `GET /api/teacher/groups/milestones`                 | `?groupId=` or `?offeringId=`                                                                    | `{ success, milestones[], cohortProgress[] }`                                                       |
| `POST /api/teacher/groups/milestones`                | `{ groupId, title, description?, weight?, dueDate? }`                                            | `{ success, milestone }`                                                                            |
| `PATCH /api/teacher/groups/milestones/[milestoneId]` | `{ title?, description?, weight?, dueDate?, status?, completedAt? }`                             | `{ success, milestone }` — completion is timestamped server-side                                    |

### Student — `app/api/student/peer-evaluation/**`

| Method + path                       | Input                                                                     | Output                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `GET /api/student/peer-evaluation`  | —                                                                         | `{ success, groups[] }` — own groups, own evaluations, anonymous received aggregate      |
| `POST /api/student/peer-evaluation` | `{ groupId, evaluations[{ evaluateeId, ratings{}, comments? }], submit }` | `{ success, message, groupId, submitted, status }` — no identities, no received comments |

`GET` returns received results only as dimension averages with a rater count, and
only after at least three distinct teammates have submitted
(`MIN_RATERS_FOR_DISCLOSURE = 3`); otherwise it returns
`{ withheld: true, ratingCount, minRatersRequired, reason }`. No evaluator id,
name, or received free-text comment is ever serialized for a student.

## How team formation works

`lib/groups/formation.ts` is pure and deterministic. Criteria are
instructor-controlled and weighted; each criterion names a student attribute and a
preference:

| Kind                     | Team score                                           |
| ------------------------ | ---------------------------------------------------- |
| `categorical-diversity`  | distinct values / team size — rewards a mix          |
| `categorical-similarity` | modal value count / team size — rewards a match      |
| `numeric-balance`        | `1 − \|teamMean − cohortMean\| / cohortMaxDeviation` |
| `numeric-spread`         | `(teamMax − teamMin) / cohortRange`                  |

Weights are normalised across the criteria that have usable cohort data. A team's
fitness is the weighted sum of its criterion scores, and the **objective is the
minimum team fitness** — the CATME "maximise the worst-fitting team" objective.
The algorithm:

1. Places most schedule-constrained students first, preferring a team that already
   shares a slot with the candidate, then the least-loaded team.
2. Runs a bounded maximin local search (pairwise swaps) that only accepts a swap
   when it strictly raises the worst team's score and keeps both teams
   schedule-compatible.

Schedule compatibility is a hard constraint: a team is only formed when every
student that declared availability shares at least one slot. `availability: []`
means "never available" and forces `TeamFormationError` (HTTP 422) rather than a
silently incompatible team. Undeclared availability is unconstrained.

Formation provenance (criteria, weights, objective, per-team scores) is stored in
`Group.metadata.formation`, so formation criteria and weights are visible in the
output exactly as required.

**Schema gap (reported, not worked around):** the frozen schema has no per-student
attribute or availability column, so formation attributes and availability are
supplied per run in the request body and only the formation provenance is
persisted. There is no offering-level JSON column to cache a roster's attributes.

## How adjustment factors work

`lib/groups/adjustment.ts` is pure. The established CATME convention is a ratio of
ratios:

```
adjustmentFactor(student) = studentReceivedAverage / teamAverageOfReceivedAverages
```

computed **both without and with self-ratings**:

- without self-ratings: only evaluations where `evaluatorId !== evaluateeId` count
  — persisted to `GroupMember.adjustmentFactor`;
- with self-ratings: each student's own rating is folded into their average —
  persisted to `GroupMember.selfAdjustmentFactor`.

A student at the team norm gets 1.0; above gets > 1.0; below gets < 1.0. Optional
`minFactor`/`maxFactor` clamps are supported. A member nobody rated gets a neutral
1.0 with `insufficientRatings: true`. `suggestIndividualGrades(groupGrade, …)`
returns `groupGrade × factor` suggestions with both variants; it never writes a
grade.

The factors are recomputed and persisted on every peer-evaluation submission
(`recomputeAdjustmentFactorsForGroup`), so the roster columns stay current.

## How free-rider detection works

`lib/groups/free-rider.ts` is pure. For each member it computes the team mean and
population standard deviation of received peer averages, the z-score, and the
ratio to the team mean, plus contribution totals and survey completion. A member is
**flagged only when their peer rating is well below the team norm**
(`z ≤ −1.5` or `ratio ≤ 0.8`, with at least two raters). Severity is `watch` or
`at-risk`. Contribution below half the team mean and an incomplete survey are
surfaced as evidence reasons but never set `flagged`; such members are marked
`evidenceOnly: true`. So a member with zero commits but a normal peer rating is
_not_ flagged, and even where contribution is low the suggested grade is computed
from peer factors alone (tested).

## Milestones

`lib/groups/milestones.ts` is pure. Completion is timestamped server-side when a
milestone moves to `COMPLETED` (and cleared when it leaves `COMPLETED`). Progress
reports counts by status, weight-aware completion, overdue and due-soon counts, and
the next due date. `analyzeCohortProgress` flags a group as `behind` when it has
overdue milestones or is materially below the cohort's completion, and `lopsided`
when it is behind while the cohort has made real progress. The instructor dashboard
shows both plus per-group weighted completion.

## Confidentiality (evidence)

- `getPeerEvaluationWorkspaceForStudent` filters to groups where the signed-in
  student has an active membership, and returns only evaluations the student wrote
  themselves plus an anonymous aggregate. A test asserts the serialized `received`
  block contains no peer id, no name, no `evaluator` key, and no `comments`.
- The aggregate is withheld until three distinct raters have submitted, so a
  three-person team cannot reconstruct a single rater's numbers.
- A student who is not an active member of a group gets 403 from `POST`, and a
  student's workspace contains only their own groups (tested).
- Route tests assert the student route rejects anonymous and teacher callers, and
  that the teacher groups routes reject students before any service runs.

## Contribution never the sole grade basis (evidence)

- `CONTRIBUTION_EVIDENCE_DISCLAIMER` (`evidenceOnly: true`, `gradeBasis: false`,
  notice) is embedded in every contribution response and in the analysis block.
- Free-rider `flagged` is set only from the peer-rating signal; contribution-only
  members get `evidenceOnly: true`.
- A DB-backed test gives one member zero contributions and identical peer ratings,
  then asserts their **suggested individual grade equals the group grade with no
  contribution influence** and that the response states the disclaimer.

## New files

- `lib/groups/` — `errors.ts`, `http.ts`, `dimensions.ts`, `storage.ts`,
  `formation.ts`, `adjustment.ts`, `contribution.ts`, `free-rider.ts`,
  `milestones.ts`, `analysis.ts`, `authz.ts`, `serialize.ts`, `service.ts`,
  `records.ts`, `student-service.ts`, `index.ts`.
- `lib/contracts/groups.ts` and one re-export line in `lib/contracts/index.ts`.
- `app/api/teacher/groups/**` and `app/api/student/peer-evaluation/route.ts`.
- `components/teacher-groups-manager.tsx`,
  `components/student-peer-evaluation.tsx`,
  `app/(dashboard)/teacher/groups/page.tsx`,
  `app/(dashboard)/student/peer-evaluation/page.tsx`.
- Tests: `tests/groups-formation.test.ts`, `tests/groups-adjustment.test.ts`,
  `tests/groups-free-rider.test.ts`, `tests/groups-peer-evaluation.test.ts`,
  `tests/groups-route-auth.test.ts`, `tests/fixtures/groups.ts`.

## Shared files touched

- `lib/contracts/index.ts` — one line: re-exports the new pod contract.
- `components/role-routes-menu.tsx` — two nav entries ("Groups" for teachers,
  "Peer eval" for students).

`prisma/schema.prisma`, `prisma/migrations/**`, `package.json`, and
`package-lock.json` are unchanged.

## Tests

| File                                   | Coverage                                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/groups-formation.test.ts`       | Maximin objective beats round-robin, determinism, diversity, schedule hard constraints, `[]` availability failure, even sizes, errors.                  |
| `tests/groups-adjustment.test.ts`      | Factors with and without self-ratings, clamping, neutral factor, dedupe/outsider handling, factor application.                                          |
| `tests/groups-free-rider.test.ts`      | Rating-norm flagging, contribution-only never flags, survey completion, minimum raters, milestone progress and cohort flags.                            |
| `tests/groups-peer-evaluation.test.ts` | DB-backed: formation persistence, confidentiality and withholding, cross-group denial, factor persistence, contribution-as-evidence, milestones, authz. |
| `tests/groups-route-auth.test.ts`      | Route-level: anonymous 401, student/teacher 403, malformed 400, service never called on denial.                                                         |

## Deferred items and limits

- **No attribute/availability persistence** (schema gap, see above). A future
  migration adding `StudentProfile.metadata` (or an offering-level column) would
  let a roster's attributes be cached between runs.
- **Group grade source.** The analysis accepts an explicit `groupGrade`, or derives
  one from an owned `GROUP_PROJECT` assessment only when every active member
  carries the same mark. Wiring the gradebook's group mark directly, and publishing
  adjusted individual grades through the existing teacher-approval flow, is a
  follow-up in the gradebook pod.
- **Peer-evaluation window / deadlines are not enforced** — the schema has no
  evaluation window column, so submissions stay editable. Locking needs a schema
  field.
- **Contribution ingestion is manual** (instructor-recorded events). A Git/CI
  webhook importer that writes `ContributionEvent` rows is a later increment.
- **Formation local search is bounded** (200 passes) and greedy for the initial
  assignment; it is deterministic and maximin-improving, not a guaranteed global
  optimum. Pathological availability patterns can raise `TeamFormationError`
  instead of guessing.
- **Smallest teams cannot see their results** (the three-rater confidentiality
  floor). Instructors still see per-member factors.
- UI is functional, not polished: criteria/attributes/availability are edited as
  JSON, which matches the pod's test-first scope.
