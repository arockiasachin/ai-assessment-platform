/**
 * Milestone progress. Instructors define milestones per group; completion is
 * timestamped (`status = COMPLETED`, `completedAt`). These pure helpers turn a
 * group's milestones into the numbers the instructor dashboard shows and decide
 * whether a team is "behind" or "lopsided".
 */

export type MilestoneStatusValue = "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "MISSED"

export type MilestoneInput = {
  status: MilestoneStatusValue | string
  weight: number
  dueDate: Date | string | null
  completedAt: Date | string | null
}

export type MilestoneProgress = {
  total: number
  planned: number
  inProgress: number
  completed: number
  missed: number
  /** Sum of completed weights / sum of all weights, in [0, 1]. */
  weightedCompletion: number
  /** Milestones whose due date has passed and are not completed. */
  overdue: number
  /** Incomplete milestones due within the next seven days. */
  dueSoon: number
  nextDueAt: string | null
  /** Behind = any overdue milestone, or no milestones defined yet. */
  behind: boolean
}

const SOON_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export function summarizeMilestones(
  milestones: readonly MilestoneInput[],
  now: Date = new Date(),
): MilestoneProgress {
  let planned = 0
  let inProgress = 0
  let completed = 0
  let missed = 0
  let totalWeight = 0
  let completedWeight = 0
  let overdue = 0
  let dueSoon = 0
  let nextDue: number | null = null

  for (const milestone of milestones) {
    const weight = Number.isFinite(milestone.weight) && milestone.weight > 0 ? milestone.weight : 1
    totalWeight += weight
    if (milestone.status === "COMPLETED") {
      completed += 1
      completedWeight += weight
    } else if (milestone.status === "IN_PROGRESS") {
      inProgress += 1
    } else if (milestone.status === "MISSED") {
      missed += 1
    } else {
      planned += 1
    }

    if (milestone.dueDate) {
      const due = new Date(milestone.dueDate).getTime()
      const isOpen = milestone.status !== "COMPLETED"
      if (isOpen && due < now.getTime()) overdue += 1
      else if (isOpen && due - now.getTime() <= SOON_WINDOW_MS) dueSoon += 1
      if (isOpen && (nextDue === null || due < nextDue)) nextDue = due
    }
  }

  return {
    total: milestones.length,
    planned,
    inProgress,
    completed,
    missed,
    weightedCompletion: totalWeight > 0 ? completedWeight / totalWeight : 0,
    overdue,
    dueSoon,
    nextDueAt: nextDue === null ? null : new Date(nextDue).toISOString(),
    behind: milestones.length === 0 || overdue > 0,
  }
}

export type GroupProgressInput = {
  groupId: string
  milestones: readonly MilestoneInput[]
}

export type GroupProgress = {
  groupId: string
  progress: MilestoneProgress
  /** Behind the cohort's typical progress, or carrying overdue milestones. */
  behind: boolean
  /** Materially behind the cohort norm — "lopsided" relative to other teams. */
  lopsided: boolean
}

/**
 * Compare groups' weighted completion so the instructor can see which teams are
 * behind. A group is `behind` when it has overdue milestones or is more than one
 * cohort standard deviation below the mean completion; it is `lopsided` when it
 * is `behind` while the cohort has made real progress. With fewer than three
 * groups there is no meaningful cohort norm, so only overdue milestones count.
 */
export function analyzeCohortProgress(
  groups: readonly GroupProgressInput[],
  now: Date = new Date(),
): GroupProgress[] {
  const raw = groups.map((group) => ({
    groupId: group.groupId,
    progress: summarizeMilestones(group.milestones, now),
  }))

  const completions = raw.map((entry) => entry.progress.weightedCompletion)
  const mean =
    completions.length > 0
      ? completions.reduce((sum, value) => sum + value, 0) / completions.length
      : 0
  const variance =
    completions.length > 0
      ? completions.reduce((sum, value) => sum + (value - mean) ** 2, 0) / completions.length
      : 0
  const stdDev = Math.sqrt(variance)
  const hasCohortNorm = raw.length >= 3

  return raw.map((entry) => {
    const belowNorm =
      hasCohortNorm && mean > 0 && entry.progress.weightedCompletion < mean - Math.max(stdDev, 0.1)
    const behind = entry.progress.behind || belowNorm
    return {
      groupId: entry.groupId,
      progress: entry.progress,
      behind,
      lopsided: behind && hasCohortNorm && mean > 0.25,
    }
  })
}
