"use client"

import { useMemo, useState } from "react"
import { CalendarCheck, Loader2, Plus, Users, Wand2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  FormationResultValue,
  GroupAnalysisResponse,
  GroupSummary,
  MilestoneResponse,
  RosterStudent,
  TeacherOfferingSummary,
} from "@/lib/contracts/groups"

/**
 * Teacher groups workspace: manual teams, CATME-style formation, per-group
 * adjustment factors, free-rider signals, contribution evidence and milestones.
 *
 * Contribution metrics arrive pre-labelled as evidence (`gradeBasis: false`) and
 * are rendered as evidence only. Grade suggestions, when shown, are suggestions —
 * publication stays in the gradebook's teacher-approval flow.
 */

type CohortProgress = {
  groupId: string
  behind: boolean
  lopsided: boolean
  weightedCompletion: number
}

type Props = {
  offerings: TeacherOfferingSummary[]
  initialOfferingId: string | null
  initialGroups: GroupSummary[]
  initialRoster: RosterStudent[]
  initialAnalysis: GroupAnalysisResponse[]
  initialMilestones: MilestoneResponse[]
  initialCohort: CohortProgress[]
}

/** Map a roster to the persisted-profile JSON the edit textareas show. */
function rosterAttributesJson(roster: RosterStudent[]): string {
  return JSON.stringify(
    Object.fromEntries(roster.map((student) => [student.studentId, student.attributes])),
    null,
    2,
  )
}

function rosterAvailabilityJson(roster: RosterStudent[]): string {
  return JSON.stringify(
    Object.fromEntries(
      roster
        .filter((student) => student.availability !== null)
        .map((student) => [student.studentId, student.availability]),
    ),
    null,
    2,
  )
}

const DEFAULT_CRITERIA = JSON.stringify(
  [
    { id: "gpa", label: "GPA balance", kind: "numeric-balance", weight: 2, attribute: "gpa" },
    {
      id: "major",
      label: "Major mix",
      kind: "categorical-diversity",
      weight: 1,
      attribute: "major",
    },
  ],
  null,
  2,
)

export function TeacherGroupsManager({
  offerings,
  initialOfferingId,
  initialGroups,
  initialRoster,
  initialAnalysis,
  initialMilestones,
  initialCohort,
}: Props) {
  const [offeringId, setOfferingId] = useState(initialOfferingId ?? "")
  const [groups, setGroups] = useState(initialGroups)
  const [roster, setRoster] = useState(initialRoster)
  const [analysis, setAnalysis] = useState(initialAnalysis)
  const [milestones, setMilestones] = useState(initialMilestones)
  const [cohort, setCohort] = useState(initialCohort)
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([])
  const [newGroupName, setNewGroupName] = useState("")
  const [teamSize, setTeamSize] = useState("3")
  const [criteriaJson, setCriteriaJson] = useState(DEFAULT_CRITERIA)
  const [attributesJson, setAttributesJson] = useState(() => rosterAttributesJson(initialRoster))
  const [availabilityJson, setAvailabilityJson] = useState(() =>
    rosterAvailabilityJson(initialRoster),
  )
  const [persistFormation, setPersistFormation] = useState(true)
  const [formation, setFormation] = useState<FormationResultValue | null>(null)
  const [gradeInput, setGradeInput] = useState("")
  const [milestoneDrafts, setMilestoneDrafts] = useState<Record<string, string>>({})
  const [contributionDrafts, setContributionDrafts] = useState<
    Record<string, { studentId: string; type: string; summary: string }>
  >({})
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const analysisByGroup = useMemo(
    () => new Map(analysis.map((entry) => [entry.groupId, entry])),
    [analysis],
  )
  const cohortByGroup = useMemo(
    () => new Map(cohort.map((entry) => [entry.groupId, entry])),
    [cohort],
  )
  const offering = offerings.find((entry) => entry.id === offeringId) ?? null

  async function readJson<T>(
    response: Response,
  ): Promise<{ ok: boolean; data: T & { message?: string } }> {
    const data = (await response.json().catch(() => ({}))) as T & { message?: string }
    return { ok: response.ok, data }
  }

  async function loadOffering(id: string, grade?: string) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const gradeQuery =
        grade && grade.trim() !== "" ? `&groupGrade=${encodeURIComponent(grade)}` : ""
      const [groupsRes, rosterRes, analysisRes, milestonesRes] = await Promise.all([
        fetch(`/api/teacher/groups?offeringId=${encodeURIComponent(id)}`),
        fetch(`/api/teacher/groups/roster?offeringId=${encodeURIComponent(id)}`),
        fetch(`/api/teacher/groups/analysis?offeringId=${encodeURIComponent(id)}${gradeQuery}`),
        fetch(`/api/teacher/groups/milestones?offeringId=${encodeURIComponent(id)}`),
      ])
      const groupsData = await readJson<{ groups: GroupSummary[] }>(groupsRes)
      const rosterData = await readJson<{ students: RosterStudent[] }>(rosterRes)
      const analysisData = await readJson<{
        analysis: GroupAnalysisResponse[]
        cohortProgress: CohortProgress[]
      }>(analysisRes)
      const milestonesData = await readJson<{
        milestones: MilestoneResponse[]
        cohortProgress: CohortProgress[]
      }>(milestonesRes)
      if (!groupsData.ok) throw new Error(groupsData.data.message ?? "Unable to load groups.")
      const nextRoster = rosterData.data.students ?? []
      setGroups(groupsData.data.groups ?? [])
      setRoster(nextRoster)
      setAttributesJson(rosterAttributesJson(nextRoster))
      setAvailabilityJson(rosterAvailabilityJson(nextRoster))
      setAnalysis(analysisData.data.analysis ?? [])
      setCohort(analysisData.data.cohortProgress ?? milestonesData.data.cohortProgress ?? [])
      setMilestones(milestonesData.data.milestones ?? [])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load offering.")
    } finally {
      setBusy(false)
    }
  }

  async function handleOfferingChange(id: string) {
    setOfferingId(id)
    setFormation(null)
    await loadOffering(id)
  }

  function toggleStudent(studentId: string) {
    setSelectedStudentIds((prev) =>
      prev.includes(studentId) ? prev.filter((value) => value !== studentId) : [...prev, studentId],
    )
  }

  async function createGroup() {
    if (!offeringId || newGroupName.trim() === "" || selectedStudentIds.length === 0) {
      setError("Pick an offering, a group name, and at least one student.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/teacher/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offeringId,
          name: newGroupName.trim(),
          studentIds: selectedStudentIds,
        }),
      })
      const { ok, data } = await readJson<{ group: GroupSummary }>(response)
      if (!ok) throw new Error(data.message ?? "Unable to create the group.")
      setNewGroupName("")
      setSelectedStudentIds([])
      setNotice("Group created.")
      await loadOffering(offeringId, gradeInput)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create the group.")
    } finally {
      setBusy(false)
    }
  }

  /** The edited textareas, projected onto the current roster. */
  function buildRosterProfiles() {
    const attributes = JSON.parse(attributesJson) as Record<string, Record<string, string | number>>
    const availability = JSON.parse(availabilityJson) as Record<string, string[]>
    return roster.map((student) => ({
      studentId: student.studentId,
      attributes: attributes[student.studentId] ?? {},
      ...(availability[student.studentId] ? { availability: availability[student.studentId] } : {}),
    }))
  }

  /** Persist the roster attributes so the next formation run reads the column. */
  async function saveRosterProfiles(): Promise<void> {
    const response = await fetch("/api/teacher/groups/roster", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offeringId, profiles: buildRosterProfiles() }),
    })
    const { ok, data } = await readJson<{ students: RosterStudent[] }>(response)
    if (!ok) throw new Error(data.message ?? "Unable to save roster attributes.")
    const nextRoster = data.students ?? []
    setRoster(nextRoster)
    setAttributesJson(rosterAttributesJson(nextRoster))
    setAvailabilityJson(rosterAvailabilityJson(nextRoster))
  }

  async function handleSaveRoster() {
    if (!offeringId) {
      setError("Select an offering first.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      await saveRosterProfiles()
      setNotice("Roster attributes saved. Formation now reads the stored values.")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save roster attributes.")
    } finally {
      setBusy(false)
    }
  }

  async function submitFormation() {
    if (!offeringId) {
      setError("Select an offering first.")
      return
    }
    setBusy(true)
    setError(null)
    setFormation(null)
    try {
      const criteria = JSON.parse(criteriaJson) as unknown
      // Persist the edited attributes/availability first, then form from the
      // stored column. The request no longer carries per-student attributes.
      await saveRosterProfiles()
      const response = await fetch("/api/teacher/groups/form", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offeringId,
          criteria,
          teamSize: Number(teamSize) || 3,
          persist: persistFormation,
          groupNamePrefix: "Team",
        }),
      })
      const { ok, data } = await readJson<{ formation: FormationResultValue }>(response)
      if (!ok) throw new Error(data.message ?? "Unable to form teams.")
      setFormation(data.formation)
      setNotice(
        `Formed ${data.formation.teams.length} teams with worst-team score ${data.formation.objective.toFixed(3)}.`,
      )
      if (persistFormation) await loadOffering(offeringId, gradeInput)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to form teams.")
    } finally {
      setBusy(false)
    }
  }

  async function refreshAnalysisWithGrade() {
    if (!offeringId) return
    await loadOffering(offeringId, gradeInput)
    setNotice("Adjustment factors and grade suggestions refreshed.")
  }

  async function addMilestone(groupId: string) {
    const title = (milestoneDrafts[groupId] ?? "").trim()
    if (title === "") {
      setError("A milestone needs a title.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/teacher/groups/milestones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, title }),
      })
      const { ok, data } = await readJson<{ milestone: MilestoneResponse }>(response)
      if (!ok) throw new Error(data.message ?? "Unable to add the milestone.")
      setMilestoneDrafts((prev) => ({ ...prev, [groupId]: "" }))
      await loadOffering(offeringId, gradeInput)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to add the milestone.")
    } finally {
      setBusy(false)
    }
  }

  async function completeMilestone(milestoneId: string) {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/teacher/groups/milestones/${milestoneId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "COMPLETED" }),
      })
      const { ok, data } = await readJson<{ milestone: MilestoneResponse }>(response)
      if (!ok) throw new Error(data.message ?? "Unable to complete the milestone.")
      await loadOffering(offeringId, gradeInput)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to complete the milestone.")
    } finally {
      setBusy(false)
    }
  }

  async function recordContribution(groupId: string) {
    const draft = contributionDrafts[groupId]
    if (!draft || !draft.studentId) {
      setError("Pick a student for the contribution event.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/teacher/groups/contributions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupId,
          events: [
            {
              studentId: draft.studentId,
              type: draft.type,
              summary: draft.summary.trim() || undefined,
              occurredAt: new Date().toISOString(),
            },
          ],
        }),
      })
      const { ok, data } = await readJson<{ recorded: number }>(response)
      if (!ok) throw new Error(data.message ?? "Unable to record the contribution.")
      setNotice("Contribution recorded as secondary evidence (never a grade basis).")
      await loadOffering(offeringId, gradeInput)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to record the contribution.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4" /> Offering
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={offeringId}
              onValueChange={(value) => {
                if (value) void handleOfferingChange(value)
              }}
            >
              <SelectTrigger className="w-[320px]" aria-label="Course offering">
                <SelectValue placeholder="Select an offering" />
              </SelectTrigger>
              <SelectContent>
                {offerings.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.courseCode} · {entry.className} · {entry.term} {entry.academicYear}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {offering && (
              <p className="text-sm text-muted-foreground">
                {offering.courseName} — {offering.groupCount} existing group(s), {roster.length}{" "}
                student(s)
              </p>
            )}
            {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </div>
          {notice && (
            <p
              role="status"
              className="text-sm text-emerald-700 [@media(prefers-color-scheme:dark)]:text-emerald-400"
            >
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Create a team manually</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="Group name"
              aria-label="New group name"
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
            />
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {roster.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No active students in this offering.
                </p>
              )}
              {roster.map((student) => (
                <label key={student.studentId} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedStudentIds.includes(student.studentId)}
                    onChange={() => toggleStudent(student.studentId)}
                  />
                  <span>
                    {student.fullName} ·{" "}
                    <span className="text-muted-foreground">{student.registerNumber}</span>
                  </span>
                </label>
              ))}
            </div>
            <Button onClick={() => void createGroup()} disabled={busy} size="sm">
              <Plus className="size-4" /> Create group
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Wand2 className="size-4" /> Form teams (maximise the worst team)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <Label htmlFor="teamSize">Target team size</Label>
              <Input
                id="teamSize"
                className="w-24"
                value={teamSize}
                onChange={(event) => setTeamSize(event.target.value)}
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={persistFormation}
                  onChange={(event) => setPersistFormation(event.target.checked)}
                />
                Save as groups
              </label>
            </div>
            <div>
              <Label htmlFor="criteria">Criteria (JSON, instructor-weighted)</Label>
              <textarea
                id="criteria"
                className="mt-1 h-40 w-full rounded-md border border-border bg-background p-2 font-mono text-xs"
                value={criteriaJson}
                onChange={(event) => setCriteriaJson(event.target.value)}
              />
            </div>
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                Optional per-student attributes / availability (JSON)
              </summary>
              <div className="mt-2 grid gap-2">
                <textarea
                  aria-label="Attributes by student id"
                  className="h-24 w-full rounded-md border border-border bg-background p-2 font-mono text-xs"
                  value={attributesJson}
                  onChange={(event) => setAttributesJson(event.target.value)}
                />
                <textarea
                  aria-label="Availability by student id"
                  className="h-24 w-full rounded-md border border-border bg-background p-2 font-mono text-xs"
                  value={availabilityJson}
                  onChange={(event) => setAvailabilityJson(event.target.value)}
                />
              </div>
            </details>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => void handleSaveRoster()}
                disabled={busy}
                size="sm"
              >
                Save roster attributes
              </Button>
              <Button onClick={() => void submitFormation()} disabled={busy} size="sm">
                <Wand2 className="size-4" /> Form teams
              </Button>
            </div>
            {formation && (
              <div className="rounded-md border border-border p-2 text-sm">
                <p className="font-medium">
                  Worst-team score {formation.objective.toFixed(3)} · {formation.teams.length} teams
                  · schedule compatible: {formation.scheduleCompatible ? "yes" : "no"}
                </p>
                <ul className="mt-1 space-y-1">
                  {formation.teams.map((team) => (
                    <li key={team.index}>
                      Team {team.index + 1} (score {team.score.toFixed(3)}):{" "}
                      {team.memberIds
                        .map(
                          (id) =>
                            roster.find((student) => student.studentId === id)?.fullName ?? id,
                        )
                        .join(", ")}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Adjustment factors &amp; grade suggestions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="groupGrade">Group grade (optional)</Label>
            <Input
              id="groupGrade"
              className="w-32"
              value={gradeInput}
              onChange={(event) => setGradeInput(event.target.value)}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refreshAnalysisWithGrade()}
            disabled={busy}
          >
            Compute
          </Button>
          <p className="text-xs text-muted-foreground">
            Suggestions are computed with and without self-ratings. Publishing a grade stays a
            teacher action in the gradebook.
          </p>
        </CardContent>
      </Card>

      {groups.length === 0 && (
        <p className="text-sm text-muted-foreground">No groups yet for this offering.</p>
      )}

      {groups.map((group) => {
        const entry = analysisByGroup.get(group.id)
        const flags = cohortByGroup.get(group.id)
        const groupMilestones = milestones.filter((milestone) => milestone.groupId === group.id)
        const contribution = entry?.contributionEvidence
        const draft = contributionDrafts[group.id] ?? {
          studentId: group.members[0]?.studentId ?? "",
          type: "COMMIT",
          summary: "",
        }
        return (
          <Card key={group.id}>
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {group.name}
                <Badge variant="outline">{group.status}</Badge>
                {flags?.behind && <Badge variant="destructive">Behind</Badge>}
                {flags?.lopsided && <Badge variant="destructive">Lopsided</Badge>}
                <span className="text-sm font-normal text-muted-foreground">
                  milestones {group.milestoneProgress.completed}/{group.milestoneProgress.total} ·
                  weighted {Math.round(group.milestoneProgress.weightedCompletion * 100)}%
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p>Members: {group.members.map((member) => member.fullName).join(", ") || "none"}</p>

              {entry && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="py-1 pr-3">Student</th>
                        <th className="py-1 pr-3">Received avg</th>
                        <th className="py-1 pr-3">Factor (no self)</th>
                        <th className="py-1 pr-3">Factor (with self)</th>
                        <th className="py-1 pr-3">Ratings</th>
                        <th className="py-1 pr-3">Free-rider</th>
                        <th className="py-1 pr-3">Survey</th>
                        {entry.suggestedIndividualGrades && (
                          <th className="py-1 pr-3">Suggested grade</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {entry.withoutSelf.map((factor) => {
                        const withSelf = entry.withSelf.find(
                          (value) => value.studentId === factor.studentId,
                        )
                        const signal = entry.freeRiders.find(
                          (value) => value.studentId === factor.studentId,
                        )
                        const suggestion = entry.suggestedIndividualGrades?.find(
                          (value) => value.studentId === factor.studentId,
                        )
                        const name =
                          group.members.find((member) => member.studentId === factor.studentId)
                            ?.fullName ?? factor.studentId
                        return (
                          <tr key={factor.studentId} className="border-b border-border/60">
                            <td className="py-1 pr-3">{name}</td>
                            <td className="py-1 pr-3">
                              {factor.receivedAverage === null
                                ? "—"
                                : factor.receivedAverage.toFixed(2)}
                            </td>
                            <td className="py-1 pr-3">{factor.adjustmentFactor.toFixed(3)}</td>
                            <td className="py-1 pr-3">
                              {withSelf?.adjustmentFactor.toFixed(3) ?? "—"}
                            </td>
                            <td className="py-1 pr-3">{factor.ratingCount}</td>
                            <td className="py-1 pr-3">
                              {signal?.flagged ? (
                                <Badge variant="destructive">{signal.severity}</Badge>
                              ) : signal?.evidenceOnly ? (
                                <Badge variant="outline">evidence only</Badge>
                              ) : (
                                "ok"
                              )}
                            </td>
                            <td className="py-1 pr-3">
                              {signal ? `${Math.round(signal.completionRate * 100)}%` : "—"}
                            </td>
                            {entry.suggestedIndividualGrades && (
                              <td className="py-1 pr-3">
                                {suggestion ? suggestion.individualGrade.toFixed(2) : "—"}
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {entry.freeRiders.some((signal) => signal.reasons.length > 0) && (
                    <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {entry.freeRiders.flatMap((signal) =>
                        signal.reasons.map((reason, index) => (
                          <li key={`${signal.studentId}-${index}`}>
                            {group.members.find((member) => member.studentId === signal.studentId)
                              ?.fullName ?? signal.studentId}
                            : {reason}
                          </li>
                        )),
                      )}
                    </ul>
                  )}
                </div>
              )}

              {contribution && (
                <div className="rounded-md border border-dashed border-border p-2 text-xs">
                  <p className="font-medium">Contribution evidence</p>
                  <p className="text-muted-foreground">{contribution.notice}</p>
                  <ul className="mt-1 space-y-0.5">
                    {contribution.summaries.map((summary) => (
                      <li key={summary.studentId ?? "unattributed"}>
                        {group.members.find((member) => member.studentId === summary.studentId)
                          ?.fullName ??
                          summary.studentId ??
                          "Unattributed"}
                        : {summary.eventCount} event(s), weight {summary.totalWeight}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[200px] flex-1">
                  <Label htmlFor={`milestone-${group.id}`}>New milestone</Label>
                  <Input
                    id={`milestone-${group.id}`}
                    placeholder="e.g. Proposal draft"
                    value={milestoneDrafts[group.id] ?? ""}
                    onChange={(event) =>
                      setMilestoneDrafts((prev) => ({ ...prev, [group.id]: event.target.value }))
                    }
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void addMilestone(group.id)}
                  disabled={busy}
                >
                  <CalendarCheck className="size-4" /> Add
                </Button>
              </div>
              <ul className="space-y-1">
                {groupMilestones.map((milestone) => (
                  <li key={milestone.id} className="flex items-center gap-2">
                    <Badge variant={milestone.status === "COMPLETED" ? "default" : "outline"}>
                      {milestone.status}
                    </Badge>
                    <span>{milestone.title}</span>
                    {milestone.status !== "COMPLETED" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void completeMilestone(milestone.id)}
                        disabled={busy}
                      >
                        Mark complete
                      </Button>
                    )}
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[160px]">
                  <Label htmlFor={`contribution-student-${group.id}`}>Contribution</Label>
                  <select
                    id={`contribution-student-${group.id}`}
                    className="w-full rounded-md border border-border bg-background p-1 text-sm"
                    value={draft.studentId}
                    onChange={(event) =>
                      setContributionDrafts((prev) => ({
                        ...prev,
                        [group.id]: { ...draft, studentId: event.target.value },
                      }))
                    }
                  >
                    {group.members.map((member) => (
                      <option key={member.studentId} value={member.studentId}>
                        {member.fullName}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[140px]">
                  <Label htmlFor={`contribution-type-${group.id}`}>Type</Label>
                  <select
                    id={`contribution-type-${group.id}`}
                    className="w-full rounded-md border border-border bg-background p-1 text-sm"
                    value={draft.type}
                    onChange={(event) =>
                      setContributionDrafts((prev) => ({
                        ...prev,
                        [group.id]: { ...draft, type: event.target.value },
                      }))
                    }
                  >
                    {["COMMIT", "PULL_REQUEST", "ISSUE", "REVIEW", "MANUAL", "OTHER"].map(
                      (type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ),
                    )}
                  </select>
                </div>
                <div className="min-w-[200px] flex-1">
                  <Label htmlFor={`contribution-summary-${group.id}`}>Summary</Label>
                  <Input
                    id={`contribution-summary-${group.id}`}
                    value={draft.summary}
                    onChange={(event) =>
                      setContributionDrafts((prev) => ({
                        ...prev,
                        [group.id]: { ...draft, summary: event.target.value },
                      }))
                    }
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void recordContribution(group.id)}
                  disabled={busy}
                >
                  Record evidence
                </Button>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
