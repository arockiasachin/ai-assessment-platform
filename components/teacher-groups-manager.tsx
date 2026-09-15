"use client"

import { useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { CalendarCheck, Loader2, Plus, Wand2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SUCCESS_TEXT } from "@/components/ui/tone"
import type {
  FormationResultValue,
  RosterStudent,
  TeacherOfferingSummary,
} from "@/lib/contracts/groups"

/**
 * The `teacher/groups` write surface.
 *
 * Every read on the page is server-rendered (see
 * `app/(dashboard)/teacher/groups/page.tsx`); this module is the client island
 * for the six mutations the page still owns — create a group, save roster
 * attributes, form teams, add a milestone, complete a milestone and record a
 * contribution event. Each mutation talks to its existing route handler and then
 * calls `router.refresh()`, so the server re-reads and the page never fetches
 * data it already has.
 *
 * The only navigation these components do is a URL change (offering / group /
 * group-grade selection) — the server resolves it. Nothing here re-fetches a
 * list endpoint on mount.
 */

async function readJson<T>(
  response: Response,
): Promise<{ ok: boolean; data: T & { message?: string } }> {
  const data = (await response.json().catch(() => ({}))) as T & { message?: string }
  return { ok: response.ok, data }
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

function Notice({ notice, error }: { notice: string | null; error: string | null }) {
  if (!notice && !error) return null
  return (
    <>
      {notice && (
        <p role="status" className={`text-sm ${SUCCESS_TEXT}`}>
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  )
}

/**
 * Offering picker. A URL change, not a client fetch: the server re-renders the
 * whole page for the chosen offering, so the four read endpoints that used to be
 * re-fetched here are gone.
 */
export function GroupsOfferingPicker({
  offerings,
  selectedOfferingId,
}: {
  offerings: TeacherOfferingSummary[]
  selectedOfferingId: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  if (offerings.length === 0) return null

  return (
    <Select
      value={selectedOfferingId ?? ""}
      onValueChange={(value: string | null) => {
        if (!value) return
        router.push(`${pathname}?offeringId=${encodeURIComponent(value)}`)
      }}
    >
      <SelectTrigger className="w-[22rem] max-w-full" aria-label="Course offering">
        <SelectValue placeholder="Select an offering" />
      </SelectTrigger>
      <SelectContent>
        {offerings.map((offering) => (
          <SelectItem key={offering.id} value={offering.id}>
            {offering.courseCode} · {offering.className} · {offering.term} {offering.academicYear}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Turn one shared group grade into per-student suggestions. A URL change again:
 * `getOfferingAnalysisForTeacher` computes the suggestions on the server, and
 * nothing is published.
 */
export function GroupGradeSuggestionForm({
  offeringId,
  selectedGroupId,
  groupGrade,
}: {
  offeringId: string
  selectedGroupId: string | null
  groupGrade: number | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [value, setValue] = useState(groupGrade === null ? "" : String(groupGrade))

  function submit() {
    const params = new URLSearchParams({ offeringId })
    if (selectedGroupId) params.set("groupId", selectedGroupId)
    if (value.trim() !== "") params.set("groupGrade", value.trim())
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <Label htmlFor="group-grade">Group grade (optional)</Label>
        <Input
          id="group-grade"
          className="w-32"
          inputMode="decimal"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </div>
      <Button variant="outline" size="sm" onClick={submit}>
        Compute suggestions
      </Button>
      <p className="text-xs text-muted-foreground">
        Suggestions are computed with and without self-ratings. Publishing a grade stays a teacher
        action in the gradebook.
      </p>
    </div>
  )
}

/**
 * Manual team creation plus the CATME formation run, with the roster attributes
 * they read. All three are writes; the resulting groups arrive from the server
 * after `router.refresh()`.
 */
export function GroupFormationPanel({
  offeringId,
  roster,
}: {
  offeringId: string
  roster: RosterStudent[]
}) {
  const router = useRouter()
  const [newGroupName, setNewGroupName] = useState("")
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([])
  const [teamSize, setTeamSize] = useState("3")
  const [criteriaJson, setCriteriaJson] = useState(DEFAULT_CRITERIA)
  const [attributesJson, setAttributesJson] = useState(() => rosterAttributesJson(roster))
  const [availabilityJson, setAvailabilityJson] = useState(() => rosterAvailabilityJson(roster))
  const [persistFormation, setPersistFormation] = useState(true)
  const [formation, setFormation] = useState<FormationResultValue | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function toggleStudent(studentId: string) {
    setSelectedStudentIds((prev) =>
      prev.includes(studentId) ? prev.filter((value) => value !== studentId) : [...prev, studentId],
    )
  }

  async function createGroup() {
    if (newGroupName.trim() === "" || selectedStudentIds.length === 0) {
      setError("Pick a group name and at least one student.")
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
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
      const { ok, data } = await readJson<unknown>(response)
      if (!ok) throw new Error(data.message ?? "Unable to create the group.")
      setNewGroupName("")
      setSelectedStudentIds([])
      setNotice("Group created.")
      router.refresh()
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
    setAttributesJson(rosterAttributesJson(nextRoster))
    setAvailabilityJson(rosterAvailabilityJson(nextRoster))
  }

  async function handleSaveRoster() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await saveRosterProfiles()
      setNotice("Roster attributes saved. Formation now reads the stored values.")
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save roster attributes.")
    } finally {
      setBusy(false)
    }
  }

  async function submitFormation() {
    setBusy(true)
    setError(null)
    setNotice(null)
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
      if (persistFormation) router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to form teams.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-3">
        <h3 className="text-sm font-medium">Create a team manually</h3>
        <Input
          placeholder="Group name"
          aria-label="New group name"
          value={newGroupName}
          onChange={(event) => setNewGroupName(event.target.value)}
        />
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-2">
          {roster.length === 0 && (
            <p className="text-sm text-muted-foreground">No active students in this offering.</p>
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
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Form teams (maximise the worst team)</h3>
        <div className="flex items-center gap-3">
          <Label htmlFor="team-size">Target team size</Label>
          <Input
            id="team-size"
            className="w-24"
            inputMode="numeric"
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
          {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
        <Notice notice={notice} error={error} />
        {formation && (
          <div className="rounded-md border border-border p-2 text-sm">
            <p className="font-medium">
              Worst-team score {formation.objective.toFixed(3)} · {formation.teams.length} teams ·
              schedule compatible: {formation.scheduleCompatible ? "yes" : "no"}
            </p>
            <ul className="mt-1 space-y-1">
              {formation.teams.map((team) => (
                <li key={team.index}>
                  Team {team.index + 1} (score {team.score.toFixed(3)}):{" "}
                  {team.memberIds
                    .map((id) => roster.find((student) => student.studentId === id)?.fullName ?? id)
                    .join(", ")}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

/** Add a milestone to one group. */
export function GroupMilestoneForm({ groupId }: { groupId: string }) {
  const router = useRouter()
  const [title, setTitle] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function addMilestone() {
    if (title.trim() === "") {
      setError("A milestone needs a title.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/teacher/groups/milestones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, title: title.trim() }),
      })
      const { ok, data } = await readJson<unknown>(response)
      if (!ok) throw new Error(data.message ?? "Unable to add the milestone.")
      setTitle("")
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to add the milestone.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-[200px] flex-1">
        <Label htmlFor={`milestone-${groupId}`}>New milestone</Label>
        <Input
          id={`milestone-${groupId}`}
          placeholder="e.g. Proposal draft"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        {error && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <Button variant="outline" size="sm" onClick={() => void addMilestone()} disabled={busy}>
        <CalendarCheck className="size-4" /> Add milestone
      </Button>
    </div>
  )
}

/** Mark one milestone complete (the engine timestamps it). */
export function GroupMilestoneCompleteButton({
  milestoneId,
  title,
}: {
  milestoneId: string
  title: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function completeMilestone() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/teacher/groups/milestones/${milestoneId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "COMPLETED" }),
      })
      const { ok, data } = await readJson<unknown>(response)
      if (!ok) throw new Error(data.message ?? "Unable to complete the milestone.")
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to complete the milestone.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        onClick={() => void completeMilestone()}
        disabled={busy}
        aria-label={`Mark ${title} complete`}
      >
        Mark complete
      </Button>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </>
  )
}

/** Record one secondary contribution event for a member. */
export function GroupContributionForm({
  groupId,
  members,
}: {
  groupId: string
  members: { studentId: string; fullName: string }[]
}) {
  const router = useRouter()
  const [studentId, setStudentId] = useState(members[0]?.studentId ?? "")
  const [type, setType] = useState("COMMIT")
  const [summary, setSummary] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function recordContribution() {
    if (studentId === "") {
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
              studentId,
              type,
              summary: summary.trim() || undefined,
              occurredAt: new Date().toISOString(),
            },
          ],
        }),
      })
      const { ok, data } = await readJson<unknown>(response)
      if (!ok) throw new Error(data.message ?? "Unable to record the contribution.")
      setSummary("")
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to record the contribution.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[180px]">
          <Label htmlFor={`contribution-student-${groupId}`}>Student</Label>
          <select
            id={`contribution-student-${groupId}`}
            className="w-full rounded-md border border-border bg-background p-1.5 text-sm"
            value={studentId}
            onChange={(event) => setStudentId(event.target.value)}
          >
            {members.map((member) => (
              <option key={member.studentId} value={member.studentId}>
                {member.fullName}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[140px]">
          <Label htmlFor={`contribution-type-${groupId}`}>Type</Label>
          <select
            id={`contribution-type-${groupId}`}
            className="w-full rounded-md border border-border bg-background p-1.5 text-sm"
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            {["COMMIT", "PULL_REQUEST", "ISSUE", "REVIEW", "MANUAL", "OTHER"].map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[200px] flex-1">
          <Label htmlFor={`contribution-summary-${groupId}`}>Summary</Label>
          <Input
            id={`contribution-summary-${groupId}`}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void recordContribution()}
          disabled={busy}
        >
          Record evidence
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
