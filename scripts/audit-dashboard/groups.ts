/**
 * The fixed shape of the audit: four groups, five agents each, and the
 * controlled vocabularies a finding may use.
 *
 * The groups are declared here rather than discovered from the filesystem on
 * purpose. If a group's file is missing or misnamed, the aggregator must say so
 * instead of quietly reporting three groups — a dashboard that under-reports
 * without erroring is worse than one that refuses to run. The trade-off is that
 * adding a group is a code change, which is the right price for a design that
 * is fixed at 4x5.
 *
 * `docs/audit/README.md` is the human-readable version of everything in this
 * file; keep the two in step.
 */

export const DOMAINS = ["teacher", "student"] as const
export type Domain = (typeof DOMAINS)[number]

export const KINDS = ["native", "langchain"] as const
export type Kind = (typeof KINDS)[number]

export const SEVERITIES = ["blocker", "major", "minor"] as const
export type Severity = (typeof SEVERITIES)[number]

export const FINDING_STATUSES = ["open", "fixed", "wontfix"] as const
export type FindingStatus = (typeof FINDING_STATUSES)[number]

export const GROUP_STATUSES = ["not-started", "running", "reported", "failed"] as const
export type GroupStatus = (typeof GROUP_STATUSES)[number]

/**
 * One category per finding, taken from the owner's own list of what the audit
 * is looking for. Controlled rather than free text so that "findings by
 * category" is comparable across groups; an unrecognised value is a parse
 * error, not a new bucket.
 */
export const CATEGORIES = [
  "broken-flow",
  "dead-control",
  "missing-write-path",
  "fabricated-number",
  "partial-implementation",
  "missing-empty-state",
  "inconsistency",
  "unreachable-ui",
  "confidentiality-leak",
] as const
export type Category = (typeof CATEGORIES)[number]

export type GroupDefinition = {
  /** Group id, also the file stem under `docs/audit/`. */
  id: string
  domain: Domain
  kind: Kind
  agents: number
  /** What the group is responsible for, shown on the dashboard. */
  scope: string
}

export const GROUPS: GroupDefinition[] = [
  {
    id: "teacher-native",
    domain: "teacher",
    kind: "native",
    agents: 5,
    scope: "all /teacher/* routes",
  },
  {
    id: "teacher-langchain",
    domain: "teacher",
    kind: "langchain",
    agents: 5,
    scope: "all /teacher/* routes",
  },
  {
    id: "student-native",
    domain: "student",
    kind: "native",
    agents: 5,
    scope: "all /student/* routes",
  },
  {
    id: "student-langchain",
    domain: "student",
    kind: "langchain",
    agents: 5,
    scope: "all /student/* routes",
  },
]

/** Columns of the `## Findings` table, in order. `dupOf` is the only optional one. */
export const FINDING_COLUMNS = [
  "id",
  "agent",
  "severity",
  "category",
  "title",
  "evidence",
  "location",
  "status",
  "dupOf",
] as const
export const REQUIRED_FINDING_COLUMNS = FINDING_COLUMNS.length - 1

/** Fields of the `## Group` table. */
export const GROUP_FIELDS = [
  "group",
  "domain",
  "kind",
  "status",
  "agents",
  "agentsReported",
] as const

export type Finding = {
  id: string
  /** Stamped by the aggregator from the group definition, not read from the row. */
  group: string
  domain: Domain
  kind: Kind
  agent: string
  severity: Severity
  category: Category
  title: string
  evidence: string
  location: string
  status: FindingStatus
  /**
   * Optional id of another finding this one duplicates. It may name a finding
   * in the same group (a finding two agents filed twice) or a finding in the
   * sibling group of the same domain (a native row and its LangChain twin).
   * The link is deliberately one-way: the row with the lower id is canonical
   * and leaves `dupOf` empty; later duplicates point at it.
   */
  dupOf?: string
}

export type CountMap<T extends string> = Record<T, number>

export type GroupReport = {
  id: string
  domain: Domain
  kind: Kind
  scope: string
  status: GroupStatus
  agents: number
  agentsReported: number
  findings: Finding[]
  /** Raw row count, duplicates included. */
  total: number
  /** Rows whose `dupOf` names a finding in this same group (linked duplicates). */
  duplicates: number
  /** `total` minus `duplicates`: the number of distinct defects reported. */
  distinct: number
  bySeverity: CountMap<Severity>
  /**
   * Of `bySeverity`, how many are still `open`.
   *
   * The two answer different questions and are easy to confuse: `bySeverity` is what
   * was **found** and never falls, while this is what is **left to do**. A dashboard
   * card that shows the first while reading as the second is a fabricated number — the
   * exact defect class this audit exists to find, so the distinction is a named field
   * rather than something each consumer derives.
   */
  bySeverityOpen: CountMap<Severity>
  byCategory: CountMap<Category>
  byStatus: CountMap<FindingStatus>
  byAgent: Record<string, number>
}

export type ComparisonSide = {
  group: string
  status: GroupStatus
  agents: number
  agentsReported: number
  /** Raw row count, duplicates included. */
  total: number
  /** Linked same-group duplicates, which are not paired a second time. */
  duplicates: number
  /** `total` minus `duplicates`. */
  distinct: number
  bySeverity: CountMap<Severity>
}

/**
 * A set of native findings and LangChain findings judged to be the same
 * defect(s). `key` is either the shared match key or an explicit `dupOf` link.
 */
export type SharedFindings = {
  key: string
  category: Category
  location: string
  native: Finding[]
  langchain: Finding[]
}

export type Comparison = {
  domain: Domain
  native: ComparisonSide
  langchain: ComparisonSide
  /** Native minus LangChain, per severity. Positive means native found more. */
  delta: CountMap<Severity>
  uniqueToNative: Finding[]
  uniqueToLangchain: Finding[]
  shared: SharedFindings[]
}

export type AuditAggregate = {
  schemaVersion: number
  generatedAt: string
  source: { convention: string; files: string[] }
  groups: GroupReport[]
  comparisons: Comparison[]
  totals: {
    groups: number
    groupsReported: number
    groupsNotStarted: number
    groupsRunning: number
    groupsFailed: number
    agents: number
    agentsReported: number
    /** Raw finding rows across every group, duplicates included. */
    findings: number
    /** Rows linked as duplicates of another row in the same group. */
    duplicates: number
    /** Distinct findings across every group (`findings` minus `duplicates`). */
    distinct: number
    bySeverity: CountMap<Severity>
    /** Of `bySeverity`, how many are still `open`. See `GroupReport.bySeverityOpen`. */
    bySeverityOpen: CountMap<Severity>
    byStatus: CountMap<FindingStatus>
    byCategory: CountMap<Category>
  }
}

export function emptyCountMap<T extends string>(values: readonly T[]): CountMap<T> {
  const counts = {} as CountMap<T>
  for (const value of values) counts[value] = 0
  return counts
}

export function defineGroup(id: string): GroupDefinition {
  const group = GROUPS.find((candidate) => candidate.id === id)
  if (!group) throw new Error(`No group definition for "${id}".`)
  return group
}

/**
 * The ids in `findings` that are linked duplicates of another finding in the
 * same group. A cross-group `dupOf` (a native row naming its LangChain twin) is
 * not a duplicate in this sense: that pair is a comparison, not a double count.
 */
export function linkedDuplicateIds(findings: Finding[]): Set<string> {
  const own = new Set(findings.map((finding) => finding.id))
  return new Set(
    findings
      .filter((finding) => finding.dupOf !== undefined && own.has(finding.dupOf))
      .map((finding) => finding.id),
  )
}

/** The other kind's group in the same domain, used by `dupOf` validation. */
export function siblingGroup(group: GroupDefinition): GroupDefinition {
  const sibling = GROUPS.find(
    (candidate) => candidate.domain === group.domain && candidate.kind !== group.kind,
  )
  if (!sibling) throw new Error(`No sibling group for "${group.id}".`)
  return sibling
}
