import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { RolePageShell } from "@/components/role-page-shell"
import { TeacherGroupsManager } from "@/components/teacher-groups-manager"
import { getSessionUser } from "@/lib/auth"
import type { GroupAnalysisResponse, GroupSummary, MilestoneResponse } from "@/lib/contracts/groups"
import {
  getOfferingAnalysisForTeacher,
  listGroupsForTeacher,
  listMilestonesForTeacher,
  listOfferingRosterForTeacher,
  listTeacherOfferings,
  serializeGroupAnalysis,
} from "@/lib/groups"

export const dynamic = "force-dynamic"

type CohortProgress = {
  groupId: string
  behind: boolean
  lopsided: boolean
  weightedCompletion: number
}

export default async function TeacherGroupsPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "teacher") redirect("/login")

  const offerings = await listTeacherOfferings(user)
  const initialOfferingId = offerings[0]?.id ?? null

  let groups: GroupSummary[] = []
  let roster: Awaited<ReturnType<typeof listOfferingRosterForTeacher>> = []
  let analysis: GroupAnalysisResponse[] = []
  let milestones: MilestoneResponse[] = []
  let cohort: CohortProgress[] = []

  if (initialOfferingId) {
    const [groupList, rosterList, offeringAnalysis, milestoneList] = await Promise.all([
      listGroupsForTeacher(user, initialOfferingId),
      listOfferingRosterForTeacher(user, initialOfferingId),
      getOfferingAnalysisForTeacher(user, { offeringId: initialOfferingId }),
      listMilestonesForTeacher(user, { offeringId: initialOfferingId }),
    ])
    groups = groupList
    roster = rosterList
    analysis = offeringAnalysis.groups.map((entry) =>
      serializeGroupAnalysis(
        entry.analysis,
        entry.contributionEvidence,
        entry.suggestedIndividualGrades,
      ),
    )
    milestones = milestoneList.milestones
    cohort = offeringAnalysis.cohortProgress.map((entry) => ({
      groupId: entry.groupId,
      behind: entry.behind,
      lopsided: entry.lopsided,
      weightedCompletion: entry.progress.weightedCompletion,
    }))
  }

  return (
    <RoleGuard role="teacher">
      <RolePageShell
        role="teacher"
        title="Groups & peer evaluation"
        description="Form teams that maximise the worst-fitting team, run confidential CATME-style peer evaluation, spot free-riders, and track milestones. Contribution signals are evidence only, never a grade."
      >
        <TeacherGroupsManager
          offerings={offerings}
          initialOfferingId={initialOfferingId}
          initialGroups={groups}
          initialRoster={roster}
          initialAnalysis={analysis}
          initialMilestones={milestones}
          initialCohort={cohort}
        />
      </RolePageShell>
    </RoleGuard>
  )
}
