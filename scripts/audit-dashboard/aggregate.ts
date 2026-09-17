/**
 * Aggregation: parsed groups in, the consolidated dashboard model out.
 *
 * Pure functions only — no filesystem, no clock beyond the timestamp passed in
 * — so `scripts/audit-dashboard/selftest.ts` can exercise the comparison logic
 * against fixtures without touching the real report files.
 */

import {
  CATEGORIES,
  DOMAINS,
  FINDING_STATUSES,
  GROUPS,
  SEVERITIES,
  emptyCountMap,
  linkedDuplicateIds,
  type AuditAggregate,
  type Comparison,
  type ComparisonSide,
  type Domain,
  type Finding,
  type GroupReport,
  type SharedFindings,
} from "./groups"
import type { ParsedGroup } from "./parse"

export const SCHEMA_VERSION = 1

/**
 * Canonicalise a location to the coarsest place two agents can be expected to
 * agree on. It strips the parts that no two independent runs will produce
 * identically (backticks, a trailing line or line range, whitespace, case) and
 * folds the two shapes a location is written in onto one: a route
 * (`/teacher/classes`) and the page file that serves it
 * (`app/(dashboard)/teacher/classes/page.tsx`) become the same key.
 *
 * It deliberately stops there. Mapping a component or a `lib/` module to the
 * route(s) that render it needs a router and an import graph, and guessing
 * wrong would merge two unrelated findings, so those locations stay as files.
 */
export function normalizeLocation(location: string): string {
  const cleaned = location.replace(/`/g, "").replace(/\s+/g, " ").trim().toLowerCase()

  // A LangChain finding cites the route it exercised; a native one cites the
  // file. Keep an explicit leading route first, because it is the primary
  // location even when the cell also mentions a file.
  const route = /^(\/[^\s,;(]+)/.exec(cleaned)
  if (route) return stripLineSuffix(route[1])

  const page = routeFromPageFile(cleaned)
  if (page !== null) return page

  return stripLineSuffix(cleaned)
}

/** Drop a trailing `:12`, `:12-14` or `:121,139`. */
function stripLineSuffix(token: string): string {
  return token.replace(/:\d+(?:[-,]\d+)*$/, "")
}

/**
 * `app/(dashboard)/teacher/classes/page.tsx` → `/teacher/classes`. Parenthesised
 * route groups such as `(dashboard)` are not part of the URL, so they are
 * dropped. Returns null when the location names no `page.tsx`.
 */
function routeFromPageFile(location: string): string | null {
  const match = /app\/((?:[^\s;,]+\/)*?)page\.tsx/.exec(location)
  if (!match) return null
  const segments = match[1]
    .split("/")
    .filter((segment) => segment.length > 0 && !(segment.startsWith("(") && segment.endsWith(")")))
  return `/${segments.join("/")}`
}

/** The match key used to pair a finding with the sibling kind's findings. */
export function matchKey(finding: Finding): string {
  return `${finding.category}@${normalizeLocation(finding.location)}`
}

export function buildGroupReport(parsed: ParsedGroup): GroupReport {
  const { definition, findings } = parsed
  const duplicates = linkedDuplicateIds(findings).size

  const bySeverity = emptyCountMap(SEVERITIES)
  const byCategory = emptyCountMap(CATEGORIES)
  const byStatus = emptyCountMap(FINDING_STATUSES)
  const byAgent: Record<string, number> = {}

  for (const finding of findings) {
    bySeverity[finding.severity] += 1
    byCategory[finding.category] += 1
    byStatus[finding.status] += 1
    byAgent[finding.agent] = (byAgent[finding.agent] ?? 0) + 1
  }

  return {
    id: definition.id,
    domain: definition.domain,
    kind: definition.kind,
    scope: definition.scope,
    status: parsed.status,
    agents: parsed.agents,
    agentsReported: parsed.agentsReported,
    findings,
    total: findings.length,
    duplicates,
    distinct: findings.length - duplicates,
    bySeverity,
    byCategory,
    byStatus,
    byAgent,
  }
}

function side(group: GroupReport): ComparisonSide {
  return {
    group: group.id,
    status: group.status,
    agents: group.agents,
    agentsReported: group.agentsReported,
    total: group.total,
    duplicates: group.duplicates,
    distinct: group.distinct,
    bySeverity: group.bySeverity,
  }
}

/**
 * Pair the two kinds' findings within one domain.
 *
 * Explicit `dupOf` links are applied first because a reviewer who has looked at
 * both findings knows more than the key does. The remaining findings are paired
 * on `category + location`. Everything unpaired is "unique to" its kind, which
 * is the number the whole two-kind design exists to produce. See
 * `docs/audit/README.md` for why the key is coarse and how to read it.
 */
function buildComparison(domain: Domain, groups: GroupReport[]): Comparison {
  const definitions = GROUPS.filter((candidate) => candidate.domain === domain)
  const nativeDefinition = definitions.find((candidate) => candidate.kind === "native")
  const langchainDefinition = definitions.find((candidate) => candidate.kind === "langchain")
  if (!nativeDefinition || !langchainDefinition) {
    throw new Error(`Expected a native and a langchain group for domain "${domain}".`)
  }

  const nativeGroup = groups.find((candidate) => candidate.id === nativeDefinition.id)
  const langchainGroup = groups.find((candidate) => candidate.id === langchainDefinition.id)
  if (!nativeGroup || !langchainGroup) {
    throw new Error(`Missing group report for domain "${domain}".`)
  }

  const nativeFindings = nativeGroup.findings
  const langchainFindings = langchainGroup.findings
  const langchainById = new Map(langchainFindings.map((finding) => [finding.id, finding]))

  // A same-group `dupOf` link says "this is the same defect filed twice". Only
  // the canonical row participates in the comparison, so a duplicate cannot be
  // counted as a second finding paired or a second finding unique.
  const nativeDuplicates = linkedDuplicateIds(nativeFindings)
  const langchainDuplicates = linkedDuplicateIds(langchainFindings)

  const shared: SharedFindings[] = []
  const pairedNative = new Set<string>()
  const pairedLangchain = new Set<string>()

  for (const finding of nativeFindings) {
    if (finding.dupOf === undefined) continue
    const counterpart = langchainById.get(finding.dupOf)
    if (!counterpart) continue // a same-group link, or validateDupOf() rejects it
    shared.push({
      key: `declared ${finding.id} = ${counterpart.id}`,
      category: finding.category,
      location: finding.location,
      native: [finding],
      langchain: [counterpart],
    })
    pairedNative.add(finding.id)
    pairedLangchain.add(counterpart.id)
  }

  const buckets = new Map<string, { native: Finding[]; langchain: Finding[] }>()
  const bucketFor = (key: string) => {
    const existing = buckets.get(key)
    if (existing) return existing
    const created = { native: [] as Finding[], langchain: [] as Finding[] }
    buckets.set(key, created)
    return created
  }
  for (const finding of nativeFindings) {
    if (pairedNative.has(finding.id) || nativeDuplicates.has(finding.id)) continue
    bucketFor(matchKey(finding)).native.push(finding)
  }
  for (const finding of langchainFindings) {
    if (pairedLangchain.has(finding.id) || langchainDuplicates.has(finding.id)) continue
    bucketFor(matchKey(finding)).langchain.push(finding)
  }

  for (const [key, bucket] of buckets) {
    if (bucket.native.length === 0 || bucket.langchain.length === 0) continue
    shared.push({
      key,
      category: bucket.native[0].category,
      location: bucket.native[0].location,
      native: bucket.native,
      langchain: bucket.langchain,
    })
    for (const finding of bucket.native) pairedNative.add(finding.id)
    for (const finding of bucket.langchain) pairedLangchain.add(finding.id)
  }

  shared.sort((a, b) => a.key.localeCompare(b.key))

  const delta = emptyCountMap(SEVERITIES)
  for (const severity of SEVERITIES) {
    delta[severity] = nativeGroup.bySeverity[severity] - langchainGroup.bySeverity[severity]
  }

  return {
    domain,
    native: side(nativeGroup),
    langchain: side(langchainGroup),
    delta,
    uniqueToNative: nativeFindings.filter(
      (finding) => !pairedNative.has(finding.id) && !nativeDuplicates.has(finding.id),
    ),
    uniqueToLangchain: langchainFindings.filter(
      (finding) => !pairedLangchain.has(finding.id) && !langchainDuplicates.has(finding.id),
    ),
    shared,
  }
}

export function buildAggregate(parsedGroups: ParsedGroup[], generatedAt: string): AuditAggregate {
  const groups = parsedGroups.map(buildGroupReport)

  const totals = {
    groups: groups.length,
    groupsReported: groups.filter((group) => group.status === "reported").length,
    groupsNotStarted: groups.filter((group) => group.status === "not-started").length,
    groupsRunning: groups.filter((group) => group.status === "running").length,
    groupsFailed: groups.filter((group) => group.status === "failed").length,
    agents: groups.reduce((sum, group) => sum + group.agents, 0),
    agentsReported: groups.reduce((sum, group) => sum + group.agentsReported, 0),
    findings: groups.reduce((sum, group) => sum + group.total, 0),
    duplicates: groups.reduce((sum, group) => sum + group.duplicates, 0),
    distinct: groups.reduce((sum, group) => sum + group.distinct, 0),
    bySeverity: emptyCountMap(SEVERITIES),
    byStatus: emptyCountMap(FINDING_STATUSES),
    byCategory: emptyCountMap(CATEGORIES),
  }

  for (const group of groups) {
    for (const severity of SEVERITIES) totals.bySeverity[severity] += group.bySeverity[severity]
    for (const status of FINDING_STATUSES) totals.byStatus[status] += group.byStatus[status]
    for (const category of CATEGORIES) totals.byCategory[category] += group.byCategory[category]
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    source: {
      convention: "docs/audit/README.md",
      files: GROUPS.map((group) => `docs/audit/${group.id}.md`),
    },
    groups,
    comparisons: DOMAINS.map((domain) => buildComparison(domain, groups)),
    totals,
  }
}
