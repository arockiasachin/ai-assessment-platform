import type { Metadata } from "next"
import { Bell, ShieldCheck, SlidersHorizontal } from "lucide-react"

import { findNavItem } from "@/components/shell/nav-config"
import { PageHeader } from "@/components/shell/page-header"
import { Label } from "@/components/ui/label"
import { KeyValueList, MetricRow } from "@/components/ui/metric-row"
import { SectionCard } from "@/components/ui/section-card"
import { StatusPill } from "@/components/ui/status-pill"
import {
  MOCK_COURSE,
  MOCK_FEATURE_FLAGS,
  MOCK_GRADE_SUGGESTIONS,
  MOCK_GRADES,
  MOCK_RUBRIC,
  formatConfidence,
  formatDate,
  formatDateTime,
} from "@/lib/mock"

import { AUTO_ACCEPT_FLAG, AUTO_ACCEPT_CONFIDENCE_FLOOR } from "../_lib/labels"

export const metadata: Metadata = {
  title: "Settings",
}

const HREF = "/mockup/teacher/settings"

const AUTO_ACCEPT_FLAG_VIEW = MOCK_FEATURE_FLAGS.find((flag) => flag.key === AUTO_ACCEPT_FLAG)

/** The prompt lineage the current grades were produced with. */
const GRADER = MOCK_GRADE_SUGGESTIONS[0]

/** The moment the retention clock starts: the first published result. */
const FIRST_PUBLISHED = MOCK_GRADES.filter((grade) => grade.published && grade.publishedAt).sort(
  (a, b) => (a.publishedAt ?? "").localeCompare(b.publishedAt ?? ""),
)[0]

const NOTIFICATION_PREFERENCES = [
  {
    id: "pref_queue",
    label: "Email me when the review queue passes five items",
    hint: "A backlog is the only thing that delays feedback for students.",
    enabled: true,
  },
  {
    id: "pref_low_confidence",
    label: "Email me when a suggestion falls below the confidence floor",
    hint: `Anything under ${formatConfidence(AUTO_ACCEPT_CONFIDENCE_FLOOR)} always waits for a teacher.`,
    enabled: true,
  },
  {
    id: "pref_passback",
    label: "Email me when an LMS grade passback fails",
    hint: "A failed passback means marks did not reach students.",
    enabled: true,
  },
  {
    id: "pref_digest",
    label: "Send a weekly cohort digest",
    hint: "A short summary of mastery, missing work and at-risk students.",
    enabled: false,
  },
]

/**
 * Settings — the teacher-side grading defaults, retention policy and alerts.
 *
 * The controls are static mockups: they are rendered disabled rather than
 * pretending to save, and the values shown are read from the same fixtures the
 * review queue uses.
 */
export default function TeacherSettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Account · grading defaults"
        title="Settings"
        description={findNavItem(HREF)?.item.description}
        breadcrumbs={[
          { label: "Mockup index", href: "/mockup" },
          { label: "Teacher workspace", href: "/mockup/teacher" },
          { label: "Settings" },
        ]}
      />

      <div className="space-y-6">
        <SectionCard
          title="Grading"
          description="How much of the model's work is taken on trust, and where a teacher's decision is required."
          action={<SlidersHorizontal className="size-4 text-muted-foreground" aria-hidden="true" />}
        >
          <MetricRow
            label="Auto-accept threshold"
            value={formatConfidence(AUTO_ACCEPT_CONFIDENCE_FLOOR)}
            hint="At or above this confidence a criterion is provisionally accepted, then spot-checked"
          />
          <MetricRow
            label="Confidence floor"
            value={formatConfidence(AUTO_ACCEPT_CONFIDENCE_FLOOR)}
            hint="Below this a suggestion always waits for a teacher — it is never published automatically"
          />
          <MetricRow
            label="Rubric in force"
            value={MOCK_RUBRIC.title}
            hint={`${MOCK_RUBRIC.criteria.length} criteria · ceiling ${MOCK_RUBRIC.maxPoints} points`}
          />
          <MetricRow
            label="Grader version"
            value={
              <span className="font-mono text-xs">
                {GRADER?.model ?? "—"} · {GRADER?.promptVersion ?? "—"}
              </span>
            }
            hint="Stored with every suggestion so a decision can be replayed"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <span className="text-xs text-muted-foreground">
              Feature flag{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.7rem]">
                {AUTO_ACCEPT_FLAG}
              </code>
            </span>
            {AUTO_ACCEPT_FLAG_VIEW ? (
              <>
                <StatusPill
                  status={AUTO_ACCEPT_FLAG_VIEW.enabled ? "active" : "archived"}
                  label={AUTO_ACCEPT_FLAG_VIEW.enabled ? "Enabled" : "Disabled"}
                  dot
                />
                <StatusPill
                  status="completed"
                  label={`${AUTO_ACCEPT_FLAG_VIEW.rolloutPercent}% rollout`}
                />
              </>
            ) : (
              <StatusPill status="insufficient-data" label="Not configured" />
            )}
          </div>
        </SectionCard>

        <SectionCard
          title="Retention"
          description="Student free text is kept for 15 days after results are published, then redacted. Marks and the grade record are retained."
          action={<ShieldCheck className="size-4 text-muted-foreground" aria-hidden="true" />}
        >
          <p className="text-sm text-muted-foreground">
            The window exists so a teacher can answer a query about feedback while it is fresh, and
            so the platform does not sit on student prose indefinitely. When the window closes, free
            text — comments, feedback notes, peer-evaluation prose — is replaced with a redaction
            marker. The numeric mark, its rubric breakdown and the audit trail are unaffected.
          </p>
          <div className="mt-4">
            <KeyValueList
              items={[
                {
                  id: "window",
                  label: "Retention window",
                  value: "15 days",
                  hint: "Measured from the first publication of results for an offering",
                },
                {
                  id: "term-start",
                  label: "Term started",
                  value: formatDate(MOCK_COURSE.startsOn),
                  hint: `${MOCK_COURSE.term} · ${MOCK_COURSE.section}`,
                },
                {
                  id: "term-end",
                  label: "Term ends",
                  value: formatDate(MOCK_COURSE.endsOn),
                },
                {
                  id: "published",
                  label: "First results published",
                  value: formatDateTime(FIRST_PUBLISHED?.publishedAt),
                  hint: FIRST_PUBLISHED
                    ? `${FIRST_PUBLISHED.assessmentTitle} · approved by ${
                        FIRST_PUBLISHED.approvedBy ?? "—"
                      }`
                    : undefined,
                },
                {
                  id: "redaction",
                  label: "What gets redacted",
                  value: "Free text only",
                  hint: "Rating comments, feedback prose and peer-evaluation comments",
                },
              ]}
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Notifications"
          description="What the platform emails you about. Static in this mockup — the controls are disabled rather than pretending to save."
          action={<Bell className="size-4 text-muted-foreground" aria-hidden="true" />}
        >
          <fieldset disabled className="divide-y divide-border">
            <legend className="sr-only">Grading and integration notifications</legend>
            {NOTIFICATION_PREFERENCES.map((preference) => (
              <div key={preference.id} className="flex items-start gap-3 py-3">
                <input
                  id={preference.id}
                  type="checkbox"
                  defaultChecked={preference.enabled}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                />
                <div className="min-w-0">
                  <Label htmlFor={preference.id} className="text-sm font-medium">
                    {preference.label}
                  </Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">{preference.hint}</p>
                </div>
              </div>
            ))}
          </fieldset>
          <p className="mt-3 text-xs text-muted-foreground">
            Mockup only — changing these values does nothing.
          </p>
        </SectionCard>
      </div>
    </>
  )
}
