import { Badge } from "@/components/ui/badge"
import { SUCCESS_TEXT } from "@/components/ui/tone"
import { cn } from "@/lib/utils"

/**
 * Semantic status vocabulary shared by reviews, submissions, groups, quizzes,
 * exports and integrations. The string keys are stable; the tone mapping is the
 * only thing a redesign needs to change.
 */
export type StatusKey =
  | "draft"
  | "pending"
  | "published"
  | "graded"
  | "late"
  | "flagged"
  | "insufficient-data"
  | "active"
  | "completed"
  | "needs-review"
  | "overridden"
  | "rejected"
  | "in-progress"
  | "missed"
  | "archived"
  | "passed"
  | "failed"
  | "error"
  | "timeout"
  | "queued"
  | "running"
  | "submitted"
  | "resubmitted"
  | "forming"

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger" | "outline"

export const STATUS_META: Record<StatusKey, { label: string; tone: StatusTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  pending: { label: "Pending", tone: "warning" },
  published: { label: "Published", tone: "info" },
  graded: { label: "Graded", tone: "success" },
  late: { label: "Late", tone: "danger" },
  flagged: { label: "Flagged", tone: "danger" },
  "insufficient-data": { label: "Insufficient data", tone: "outline" },
  active: { label: "Active", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  "needs-review": { label: "Needs review", tone: "warning" },
  overridden: { label: "Overridden", tone: "info" },
  rejected: { label: "Rejected", tone: "danger" },
  "in-progress": { label: "In progress", tone: "info" },
  missed: { label: "Missed", tone: "danger" },
  archived: { label: "Archived", tone: "neutral" },
  passed: { label: "Passed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  error: { label: "Error", tone: "danger" },
  timeout: { label: "Timeout", tone: "warning" },
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Running", tone: "info" },
  submitted: { label: "Submitted", tone: "info" },
  resubmitted: { label: "Resubmitted", tone: "info" },
  forming: { label: "Forming", tone: "neutral" },
}

/**
 * Tone classes.
 *
 * Every pair was measured against the tinted background in both themes, and all
 * clear WCAG AA (4.5:1) for small text:
 *
 * - `info`     primary/10 → 5.09 light, primary/12 → 5.01 dark
 * - `success`  success/15 → 5.86 light (a deliberately darker shade of the
 *              `--success` hue; the raw token only reaches 2.76:1 as text),
 *              success/20 → 5.01 dark
 * - `warning`  warning/15 + `--warning-foreground` → 14.11 light,
 *              warning/20 + `--warning` → 5.87 dark
 * - `danger`   destructive/10 → 5.00 light, destructive/12 → 4.88 dark
 * - `neutral`  muted + foreground → 15.79 light, 13.44 dark
 *
 * The success shade now lives in `@/components/ui/tone` (`SUCCESS_TEXT`) so the
 * pill, the `StatCard` delta and `Callout` cannot drift apart. `--success`
 * itself is untouched (the accessibility audit signed it off for fills and
 * icons) while giving small pill text the contrast it needs.
 */
const TONE_PILL: Record<StatusTone, string> = {
  neutral: "border-transparent bg-muted text-foreground",
  info: "border-transparent bg-primary/10 text-primary dark:bg-primary/12",
  success: `border-transparent bg-success/15 ${SUCCESS_TEXT} dark:bg-success/20`,
  warning:
    "border-transparent bg-warning/15 text-warning-foreground dark:bg-warning/20 dark:text-warning",
  danger: "border-transparent bg-destructive/10 text-destructive dark:bg-destructive/12",
  outline: "border-dashed border-border bg-transparent text-muted-foreground",
}

const TONE_DOT: Record<StatusTone, string> = {
  neutral: "bg-muted-foreground",
  info: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  outline: "bg-border",
}

export type StatusPillProps = {
  status: StatusKey
  /** Override the default label (e.g. "Auto-accepted" for one reviewer). */
  label?: string
  /** Show a leading tone dot — a non-colour cue when colour is unavailable. */
  dot?: boolean
  className?: string
}

/**
 * The one status chip used everywhere. Colour never carries meaning alone: the
 * label is always present, and `dot` adds a second visual cue.
 */
export function StatusPill({ status, label, dot = false, className }: StatusPillProps) {
  const meta = STATUS_META[status]
  return (
    <Badge className={cn("h-auto px-2 py-0.5", TONE_PILL[meta.tone], className)}>
      {dot && <StatusDot status={status} className="size-1.5" />}
      {label ?? meta.label}
    </Badge>
  )
}

/**
 * Just the tone dot, for dense lists. Pass `label` when the dot is the only
 * status cue so screen readers get the meaning; otherwise it is decorative.
 */
export function StatusDot({
  status,
  label,
  className,
}: {
  status: StatusKey
  label?: string
  className?: string
}) {
  const tone = STATUS_META[status].tone
  return (
    <span
      className={cn("inline-block size-2 shrink-0 rounded-full", TONE_DOT[tone], className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  )
}
