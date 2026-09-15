/**
 * Build guide for every mockup page.
 *
 * This is the contract the three page-agents follow: which fixtures to render,
 * which primitives to compose, and the section order to use. The stub page
 * renders the same information on screen, so a page-agent can open
 * `/mockup/<role>/<page>` and see exactly what to build without reading this
 * file.
 *
 * Keys are the exact `href`s from `components/shell/nav-config.ts`. Adding a nav
 * item without adding a guide here is a bug — `getPageGuide` falls back to a
 * generic guide, and the mockup index shows the page as "guide missing".
 */

export type PageGuide = {
  /** Fixture exports (from `@/lib/mock`) this page renders. */
  fixtures: string[]
  /** Primitives to compose, by exported component name. */
  primitives: string[]
  /** Section order, top to bottom. */
  structure: string[]
  /** Page-specific gotchas the agent must honour. */
  notes?: string[]
}

const GENERIC: PageGuide = {
  fixtures: ["MOCK_COURSE"],
  primitives: ["PageHeader", "SectionCard", "EmptyState"],
  structure: [
    "PageHeader with breadcrumbs and a primary action",
    "A single SectionCard holding the page's main content",
    "EmptyState for any empty collection",
  ],
}

export const PAGE_GUIDES: Record<string, PageGuide> = {
  // ---------------------------------------------------------------- teacher
  "/mockup/teacher": {
    fixtures: [
      "MOCK_COURSE",
      "MOCK_TEACHER_KPIS",
      "MOCK_ASSESSMENTS",
      "MOCK_PENDING_REVIEWS",
      "MOCK_UPCOMING_EVENTS",
      "MOCK_SPARKLINES",
      "MOCK_SCORE_TREND",
    ],
    primitives: [
      "PageHeader",
      "StatCard",
      "SectionCard",
      "DataTable",
      "StatusPill",
      "Timeline",
      "Sparkline",
      "ProgressBar",
      "EmptyState",
    ],
    structure: [
      "PageHeader (eyebrow = course code, actions = Publish results / New assessment)",
      "KPI row: 4 StatCards from MOCK_TEACHER_KPIS, each with a Sparkline slot",
      'SectionCard "Needs your attention": DataTable of MOCK_PENDING_REVIEWS (top 5) with StatusPill and a Review link per row',
      'Grid: SectionCard "Cohort trend" (TrendChart from @/components/charts) beside SectionCard "Upcoming" (Timeline of MOCK_UPCOMING_EVENTS)',
      'SectionCard "Assessment progress": DataTable of MOCK_ASSESSMENTS with ProgressBar graded/submitted',
    ],
    notes: ["MOCK_TEACHER_KPIS is Kpi[]; map it to StatCard rather than hand-writing each tile."],
  },
  "/mockup/teacher/classes": {
    fixtures: ["MOCK_COURSE", "MOCK_STUDENTS", "MOCK_GROUPS"],
    primitives: [
      "PageHeader",
      "StatCard",
      "FilterBar",
      "DataTable",
      "StatusPill",
      "ProgressBar",
      "EmptyState",
    ],
    structure: [
      "PageHeader (eyebrow = term + section)",
      "FilterBar: search + group select + performance select, resultCount = MOCK_STUDENTS.length",
      "KPI row: enrolled / at risk / groups formed / completion",
      'SectionCard "Roster": DataTable of MOCK_STUDENTS (long-name, null-average and at-risk rows must all render)',
    ],
    notes: [
      'Render `avgPercent: null` as "—", never as 0%.',
      "Alexandria Catherine Montgomery-Worthington is the truncation test case.",
    ],
  },
  "/mockup/teacher/assignments": {
    fixtures: ["MOCK_ASSESSMENTS", "MOCK_RUBRIC", "MOCK_MATERIALS"],
    primitives: [
      "PageHeader",
      "FilterBar",
      "DataTable",
      "StatusPill",
      "ProgressBar",
      "EmptyState",
      "PageTabs",
    ],
    structure: [
      "PageHeader (actions = New assessment)",
      "FilterBar: type select + status select",
      "PageTabs: All / Quiz / Descriptive / Code / Group project",
      'SectionCard "Assessments": DataTable with kind, due date, weight, submissions, mean, StatusPill',
    ],
    notes: [
      "MOCK_ASSESSMENTS[1] (Descriptive) is NOT published — show the unpublished state explicitly.",
      "The draft Quiz 2 row must be visually distinguishable from the published Quiz 1 row.",
    ],
  },
  "/mockup/teacher/quiz-ai": {
    fixtures: [
      "MOCK_QUIZ_QUESTIONS",
      "MOCK_DRAFT_QUESTIONS",
      "MOCK_ITEM_ANALYSIS",
      "MOCK_MATERIALS",
    ],
    primitives: [
      "PageHeader",
      "PageTabs",
      "SectionCard",
      "StatusPill",
      "DataTable",
      "EmptyState",
      "ProgressBar",
    ],
    structure: [
      "PageHeader (actions = Generate questions)",
      "PageTabs: Drafts / Published / Item analysis",
      "Drafts panel: SectionCard per draft question showing options + which is correct, action = Publish",
      "Item analysis panel: DataTable of MOCK_ITEM_ANALYSIS, insufficient-data rows use StatusPill without invented numbers",
      "Topics panel: mastery bars from MOCK_TOPIC_MASTERY",
    ],
    notes: [
      "Answer keys ARE visible on this teacher surface — this is the authoring view, not the student view.",
      "Never render `percentCorrect: null` as 0%.",
    ],
  },
  "/mockup/teacher/rubrics": {
    fixtures: ["MOCK_RUBRIC", "MOCK_ASSESSMENTS"],
    primitives: [
      "PageHeader",
      "SectionCard",
      "KeyValueList",
      "MetricRow",
      "ProgressBar",
      "StatusPill",
      "EmptyState",
    ],
    structure: [
      "PageHeader (actions = New rubric)",
      "SectionCard with rubric metadata via KeyValueList (total weight, ceiling, prompt version)",
      'SectionCard "Criteria": one block per MOCK_RUBRIC.criteria with weight ProgressBar and its levels',
      "Weight check: show that weights sum to 100% and maxPoints sum to the rubric ceiling",
    ],
    notes: [
      "A suggestion may never exceed a criterion's maxPoints — the fixture enforces it, do not display anything that implies otherwise.",
    ],
  },
  "/mockup/teacher/reviews": {
    fixtures: [
      "MOCK_REVIEW_QUEUE",
      "MOCK_PENDING_REVIEWS",
      "MOCK_REVIEW_SUMMARY",
      "MOCK_GRADE_SUGGESTIONS",
      "MOCK_RUBRIC",
    ],
    primitives: [
      "PageHeader",
      "StatCard",
      "FilterBar",
      "DataTable",
      "StatusPill",
      "MetricRow",
      "ProgressBar",
      "EmptyState",
      "Timeline",
      "SectionCard",
    ],
    structure: [
      "PageHeader (eyebrow = assessment title)",
      "KPI row from MOCK_REVIEW_SUMMARY: pending / needs review / auto-accepted / overridden",
      "FilterBar: assessment + status + confidence",
      'SectionCard "Queue": DataTable of MOCK_REVIEW_QUEUE, one row per student, actions = Review',
      "Detail panel (below or beside): criteria list from the row's `criteria` array with suggested vs max, rationale, quoted evidence, confidence MetricRow",
      "When `criteria` is empty, show an EmptyState explaining why (e.g. no submission)",
    ],
    notes: [
      "Every suggestion carries rationale + evidence + confidence + model + prompt version. Do not drop them — explainability is a product rule.",
      "An item with `submittedAt: null` means the attempt was never submitted; label it, do not show a blank date.",
    ],
  },
  "/mockup/teacher/submissions": {
    fixtures: ["MOCK_SUBMISSIONS", "MOCK_ASSESSMENTS", "MOCK_STUDENTS"],
    primitives: [
      "PageHeader",
      "StatCard",
      "FilterBar",
      "DataTable",
      "StatusPill",
      "MetricRow",
      "EmptyState",
    ],
    structure: [
      "PageHeader (actions = Export marks)",
      "KPI row: submitted / late / graded / unpublished",
      "FilterBar: assessment + status + late toggle",
      'SectionCard "Submissions": DataTable of MOCK_SUBMISSIONS with student, assessment, state, marks, published, actions',
    ],
    notes: [
      "`published: false` with marks present is the key state: graded but not released to students.",
      "`points: null` renders as an em dash.",
    ],
  },
  "/mockup/teacher/code-tasks": {
    fixtures: [
      "MOCK_CODE_TASK",
      "MOCK_TEST_CASES",
      "MOCK_TEST_RUNS",
      "MOCK_ACTIVE_RUNS",
      "MOCK_FAILED_RUNS",
      "MOCK_SIMILARITY",
      "MOCK_CODE_TASK_SKELETON",
    ],
    primitives: [
      "PageHeader",
      "PageTabs",
      "StatCard",
      "DataTable",
      "Timeline",
      "StatusPill",
      "ProgressBar",
      "MetricRow",
      "EmptyState",
      "SectionCard",
    ],
    structure: [
      "PageHeader (eyebrow = assessment title)",
      "KPI row: pass rate, average coverage, active runs, flags",
      "PageTabs: Runs / Test cases / Similarity / Task setup",
      "Runs panel: DataTable of MOCK_TEST_RUNS; a run's `stderr` shows in an expandable detail",
      "Test cases panel: DataTable of MOCK_TEST_CASES (hidden cases flagged, `lastResult: null` = not run)",
      "Similarity panel: DataTable of MOCK_SIMILARITY with verdict StatusPill",
    ],
    notes: [
      "Timestamps are null for QUEUED/RUNNING runs — render the state, not a blank date.",
      "The ERROR run must show its stderr; that is the point of the fixture.",
    ],
  },
  "/mockup/teacher/groups": {
    fixtures: ["MOCK_GROUPS", "MOCK_GROUP_BY_ID", "MOCK_UNASSIGNED_STUDENTS"],
    primitives: [
      "PageHeader",
      "StatCard",
      "SectionCard",
      "DataTable",
      "StatusPill",
      "ProgressBar",
      "Timeline",
      "EmptyState",
      "PageTabs",
    ],
    structure: [
      "PageHeader (actions = Form groups)",
      "KPI row: teams, members placed, free-rider signals, unassigned students",
      'SectionCard "Teams": DataTable of MOCK_GROUPS with state, members, avg contribution, last activity, flags',
      "Team detail: PageTabs for Members / Peer evaluation / Milestones / Contributions",
      "Peer evaluation panel: 4x4 matrix or per-evaluator list of MOCK_GROUPS[n].peerEvaluations using the five CATME keys",
      "Milestones panel: Timeline; Contributions panel: Timeline of ContributionEvent[]",
    ],
    notes: [
      "Team Graphs has `peerEvaluations: []` — that panel MUST render an EmptyState, not an empty table.",
      "Team Scalars is FORMING with no members: it exercises the empty roster state.",
      "MOCK_UNASSIGNED_STUDENTS is the list to show beside the teams table.",
    ],
  },
  "/mockup/teacher/planner": {
    fixtures: ["MOCK_CALENDAR_EVENTS", "MOCK_UPCOMING_EVENTS", "MOCK_ASSESSMENTS", "MOCK_COURSE"],
    primitives: ["PageHeader", "SectionCard", "Timeline", "StatusPill", "DataTable", "EmptyState"],
    structure: [
      "PageHeader (actions = Add event)",
      "FilterBar-style month selector row",
      'Two columns: SectionCard "Upcoming" (Timeline of MOCK_UPCOMING_EVENTS) and SectionCard "All events" (Table of MOCK_CALENDAR_EVENTS)',
    ],
    notes: ["Use formatDueLabel()/formatDateTime() for dates; never call `new Date()` in render."],
  },
  "/mockup/teacher/analytics": {
    fixtures: [
      "MOCK_ANALYTICS_SUMMARY",
      "MOCK_GRADE_DISTRIBUTION",
      "MOCK_SCORE_TREND",
      "MOCK_ITEM_ANALYSIS",
      "MOCK_TOPIC_MASTERY",
      "MOCK_AT_RISK_STUDENTS",
      "MOCK_SPARKLINES",
    ],
    primitives: [
      "PageHeader",
      "StatCard",
      "SectionCard",
      "DataTable",
      "StatusPill",
      "ProgressBar",
      "EmptyState",
      "GradeDonut",
      "Sparkline",
    ],
    structure: [
      "PageHeader (actions = Export CSV / Analytics settings)",
      "KPI row: cohort mean, median, completion, at risk",
      "Grid: GradeDonut of MOCK_GRADE_DISTRIBUTION beside TrendChart (MOCK_SCORE_TREND)",
      'SectionCard "Question quality": DataTable of MOCK_ITEM_ANALYSIS, insufficient-data rows use StatusPill "Insufficient data" and an em dash, NEVER 0%',
      'SectionCard "Topic mastery": ProgressBar per MOCK_TOPIC_MASTERY row; null mastery renders as insufficient data',
      'SectionCard "At risk": DataTable of MOCK_AT_RISK_STUDENTS with an intervention action',
    ],
    notes: [
      "Charts come from @/components/charts (ClassAverageChart, GradeDistributionChart, TrendChart) — they already carry screen-reader descriptions.",
      "Do not invent a number where the fixture says null; that is the whole point of the insufficient-data case.",
    ],
  },
  "/mockup/teacher/activity": {
    fixtures: ["MOCK_AUDIT_EVENTS", "MOCK_GRADES", "MOCK_STUDENTS"],
    primitives: [
      "PageHeader",
      "FilterBar",
      "Timeline",
      "DataTable",
      "StatusPill",
      "EmptyState",
      "SectionCard",
    ],
    structure: [
      "PageHeader (actions = Export log)",
      "FilterBar: actor + action + date range",
      'SectionCard "Activity": Timeline of MOCK_AUDIT_EVENTS (newest first) with tone StatusPill per entry',
      'SectionCard "Grading decisions": DataTable of MOCK_GRADES filtered to source = TEACHER_OVERRIDE',
    ],
    notes: ["Actors include SYSTEM workers; label them clearly so they are not read as staff."],
  },
  "/mockup/teacher/export": {
    fixtures: ["MOCK_EXPORT_ROWS", "MOCK_EXPORT_SUMMARY"],
    primitives: [
      "PageHeader",
      "StatCard",
      "FilterBar",
      "DataTable",
      "StatusPill",
      "EmptyState",
      "SectionCard",
    ],
    structure: [
      "PageHeader (actions = Sync now)",
      "KPI row from MOCK_EXPORT_SUMMARY: healthy / needs attention / failing / unmapped users",
      'SectionCard "Integrations": DataTable of MOCK_EXPORT_ROWS with platform, state, mapped/total, last sync, issues',
    ],
    notes: [
      "`lastSyncedAt: null` means never synced — say so.",
      "The FAILED Moodle row must show its `issues` list; that is the actionable content.",
    ],
  },
  "/mockup/teacher/reports": {
    fixtures: [
      "MOCK_COURSE_RATINGS",
      "MOCK_COURSE_RATING_AVERAGE",
      "MOCK_ANALYTICS_SUMMARY",
      "MOCK_STUDENTS",
      "MOCK_ASSESSMENTS",
    ],
    primitives: [
      "PageHeader",
      "StatCard",
      "SectionCard",
      "DataTable",
      "StatusPill",
      "EmptyState",
      "ProgressBar",
    ],
    structure: [
      "PageHeader (actions = Print / Download PDF)",
      "KPI row: course rating, cohort mean, completion, at risk",
      'SectionCard "Student report cards": DataTable of MOCK_STUDENTS with per-assessment marks',
      'SectionCard "Course feedback": DataTable of MOCK_COURSE_RATINGS; a purged comment renders as "Removed by retention policy"',
    ],
    notes: [
      "`comment: null` + `purged: false` means the student left no comment; do not conflate the two.",
    ],
  },
  "/mockup/teacher/settings": {
    fixtures: ["MOCK_COURSE", "MOCK_CURRENT_USER"],
    primitives: [
      "PageHeader",
      "SectionCard",
      "MetricRow",
      "KeyValueList",
      "ProgressBar",
      "StatusPill",
    ],
    structure: [
      "PageHeader",
      'SectionCard "Grading": auto-accept threshold, confidence floor (use MetricRow)',
      'SectionCard "Retention": 15-day window explanation + KeyValueList of dates',
      'SectionCard "Notifications": toggles (static)',
    ],
  },
  "/mockup/teacher/profile": {
    fixtures: ["MOCK_CURRENT_USER", "MOCK_COURSE"],
    primitives: [
      "PageHeader",
      "SectionCard",
      "KeyValueList",
      "MetricRow",
      "StatusPill",
      "EmptyState",
    ],
    structure: [
      "PageHeader",
      'SectionCard "Profile" with KeyValueList (name, email, role StatusPill)',
      'SectionCard "Offerings" listing MOCK_COURSE',
      'SectionCard "Session" with a disabled Sign-out affordance labelled as mockup-only',
    ],
  },

  // ---------------------------------------------------------------- student
  "/mockup/student": {
    fixtures: [
      "MOCK_STUDENT_KPIS",
      "MOCK_STUDENT_ASSESSMENTS",
      "MOCK_UPCOMING_EVENTS",
      "MOCK_SPARKLINES",
      "MOCK_MY_PEER_EVALUATIONS",
      "MOCK_DEMO_STUDENT",
    ],
    primitives: [
      "PageHeader",
      "StatCard",
      "SectionCard",
      "DataTable",
      "StatusPill",
      "Timeline",
      "Sparkline",
      "EmptyState",
      "ProgressBar",
    ],
    structure: [
      "PageHeader (greeting uses MOCK_DEMO_STUDENT.name)",
      "KPI row from MOCK_STUDENT_KPIS with Sparkline slots",
      'SectionCard "Due next": DataTable of MOCK_STUDENT_ASSESSMENTS filtered to unpublished/unsubmitted work',
      'SectionCard "Upcoming": Timeline of MOCK_UPCOMING_EVENTS',
      'SectionCard "Peer evaluation": outstanding count from MOCK_MY_PEER_EVALUATIONS',
    ],
  },
  "/mockup/student/courses": {
    fixtures: [
      "MOCK_COURSE",
      "MOCK_COURSE_RATINGS",
      "MOCK_COURSE_RATING_AVERAGE",
      "MOCK_MATERIALS_SUMMARY",
    ],
    primitives: [
      "PageHeader",
      "SectionCard",
      "ProgressBar",
      "StatusPill",
      "GradeDonut",
      "MetricRow",
      "DataTable",
      "EmptyState",
    ],
    structure: [
      "PageHeader (eyebrow = term)",
      "Course summary card: code, teacher, room, ProgressBar completion",
      "Materials summary from MOCK_MATERIALS_SUMMARY",
      'SectionCard "Course ratings": GradeDonut + DataTable of MOCK_COURSE_RATINGS',
    ],
  },
  "/mockup/student/assessments": {
    fixtures: ["MOCK_STUDENT_ASSESSMENTS", "MOCK_ASSESSMENTS", "MOCK_DEMO_STUDENT"],
    primitives: [
      "PageHeader",
      "FilterBar",
      "DataTable",
      "StatusPill",
      "MetricRow",
      "EmptyState",
      "SectionCard",
      "PageTabs",
    ],
    structure: [
      "PageHeader (eyebrow = course code)",
      "FilterBar: type + status",
      "PageTabs: All / To do / Submitted / Graded",
      'SectionCard "Assessments": DataTable of MOCK_STUDENT_ASSESSMENTS with due date, state, marks, feedback',
    ],
    notes: [
      "`published: false` means the mark exists but is not released — show a StatusPill saying so rather than the number.",
    ],
  },
  "/mockup/student/quizzes": {
    fixtures: ["MOCK_MY_QUIZ_ATTEMPTS", "MOCK_QUIZ_QUESTIONS", "MOCK_DEMO_STUDENT"],
    primitives: [
      "PageHeader",
      "StatCard",
      "SectionCard",
      "DataTable",
      "StatusPill",
      "MetricRow",
      "EmptyState",
      "PageTabs",
    ],
    structure: [
      "PageHeader (actions = Start Quiz 2)",
      "KPI row: attempts used, best score, time spent, questions correct",
      'SectionCard "Attempts": DataTable of MOCK_MY_QUIZ_ATTEMPTS',
      'SectionCard "Per-question feedback": one row per MOCK_QUIZ_QUESTIONS entry with the student answer, the correct answer and the explanation',
    ],
    notes: [
      "This is the STUDENT surface: never render `isCorrect` for a question the student has not attempted, and do not leak another student's attempts.",
    ],
  },
  "/mockup/student/resources": {
    fixtures: ["MOCK_MATERIALS", "MOCK_MATERIALS_SUMMARY", "MOCK_COURSE"],
    primitives: [
      "PageHeader",
      "StatCard",
      "FilterBar",
      "DataTable",
      "StatusPill",
      "EmptyState",
      "SectionCard",
    ],
    structure: [
      "PageHeader",
      "KPI row from MOCK_MATERIALS_SUMMARY",
      "FilterBar: kind + topic",
      'SectionCard "Materials": DataTable of MOCK_MATERIALS; unindexed items show a StatusPill and no chunk count',
    ],
    notes: [
      "`sourceUrl: null` means the material has no file — render it as unavailable, not as a broken link.",
    ],
  },
  "/mockup/student/peer-evaluation": {
    fixtures: ["MOCK_MY_PEER_EVALUATIONS", "MOCK_GROUP_BY_ID", "MOCK_DEMO_STUDENT"],
    primitives: [
      "PageHeader",
      "SectionCard",
      "StatusPill",
      "DataTable",
      "MetricRow",
      "ProgressBar",
      "EmptyState",
    ],
    structure: [
      "PageHeader (eyebrow = team name)",
      "ProgressBar: evaluations submitted / required",
      'SectionCard "Your ratings": one block per MOCK_MY_PEER_EVALUATIONS entry showing the five CATME dimensions with their 1–5 values',
      'SectionCard "Team": DataTable of the team members with submission state',
    ],
    notes: [
      "Dimension keys are `contributing`, `interacting`, `keepingOnTrack`, `expectingQuality`, `knowledgeSkillsAbilities`; label them with the text from lib/groups/dimensions.ts.",
      "Ratings are confidential: never show a teammate's rating of the student here.",
    ],
  },
  "/mockup/student/code-submissions": {
    fixtures: [
      "MOCK_CODE_TASK",
      "MOCK_TEST_CASES",
      "MOCK_TEST_RUNS",
      "MOCK_CODE_TASK_SKELETON",
      "MOCK_DEMO_STUDENT",
    ],
    primitives: [
      "PageHeader",
      "StatCard",
      "SectionCard",
      "PageTabs",
      "DataTable",
      "StatusPill",
      "Timeline",
      "ProgressBar",
      "MetricRow",
    ],
    structure: [
      "PageHeader (eyebrow = assessment title, actions = Submit)",
      "KPI row: tests passed, coverage, runs used, time limit",
      "PageTabs: Task / Test cases / Runs",
      "Task panel: instructions + the starter code from MOCK_CODE_TASK_SKELETON in a <pre>",
      "Runs panel: DataTable of MOCK_TEST_RUNS filtered to the demo student, with stderr for the ERROR run",
    ],
    notes: ["Hidden test cases must not reveal their expected output."],
  },
  "/mockup/student/events": {
    fixtures: ["MOCK_CALENDAR_EVENTS", "MOCK_UPCOMING_EVENTS"],
    primitives: [
      "PageHeader",
      "SectionCard",
      "Timeline",
      "StatusPill",
      "DataTable",
      "FilterBar",
      "EmptyState",
    ],
    structure: [
      "PageHeader",
      "FilterBar: month + kind",
      'SectionCard "Upcoming": Timeline of MOCK_UPCOMING_EVENTS',
      'SectionCard "All events": DataTable of MOCK_CALENDAR_EVENTS with kind StatusPill',
    ],
  },
  "/mockup/student/retake": {
    fixtures: ["MOCK_RETAKE_RECOMMENDATIONS", "MOCK_TOPIC_MASTERY", "MOCK_MY_QUIZ_ATTEMPTS"],
    primitives: [
      "PageHeader",
      "StatCard",
      "SectionCard",
      "DataTable",
      "StatusPill",
      "ProgressBar",
      "EmptyState",
    ],
    structure: [
      "PageHeader (actions = Start retake)",
      "KPI row: topics to revise, questions available, best score, attempts used",
      'SectionCard "Recommended practice": DataTable of MOCK_RETAKE_RECOMMENDATIONS; `mastery: null` shows "Insufficient data"',
      'SectionCard "Topic mastery": ProgressBar per MOCK_TOPIC_MASTERY row',
    ],
    notes: ["`mastery: null` must not render as 0%."],
  },
  "/mockup/student/settings": {
    fixtures: ["MOCK_CURRENT_USER"],
    primitives: ["PageHeader", "SectionCard", "MetricRow", "KeyValueList", "StatusPill"],
    structure: [
      "PageHeader",
      'SectionCard "Accessibility": reduce motion, larger text, high-contrast hints (static controls)',
      'SectionCard "Notifications": assessment reminders and feedback alerts',
      'SectionCard "Session": KeyValueList with the mock session details',
    ],
  },
  "/mockup/student/profile": {
    fixtures: ["MOCK_DEMO_STUDENT", "MOCK_COURSE", "MOCK_STUDENTS"],
    primitives: ["PageHeader", "SectionCard", "KeyValueList", "MetricRow", "StatusPill"],
    structure: [
      "PageHeader",
      'SectionCard "Student profile": KeyValueList (full name, register number, email, group)',
      'SectionCard "Enrolment": MOCK_COURSE details',
      'SectionCard "Peer group": members of MOCK_DEMO_STUDENT.groupId from MOCK_STUDENTS',
    ],
  },

  // ------------------------------------------------------------------ admin
  "/mockup/admin": {
    fixtures: [
      "MOCK_ADMIN_KPIS",
      "MOCK_ADMIN_SUMMARY",
      "MOCK_ADMIN_OFFERINGS",
      "MOCK_ADMIN_USERS",
      "MOCK_EXPORT_ROWS",
    ],
    primitives: [
      "PageHeader",
      "StatCard",
      "SectionCard",
      "DataTable",
      "StatusPill",
      "ProgressBar",
      "Timeline",
      "EmptyState",
    ],
    structure: [
      "PageHeader (actions = Invite user)",
      "KPI row from MOCK_ADMIN_KPIS",
      'SectionCard "Offerings at a glance": DataTable of MOCK_ADMIN_OFFERINGS with capacity ProgressBar',
      'SectionCard "Integration health": DataTable of MOCK_EXPORT_ROWS (state + issues)',
    ],
  },
  "/mockup/admin/users": {
    fixtures: ["MOCK_ADMIN_USERS"],
    primitives: [
      "PageHeader",
      "StatCard",
      "FilterBar",
      "DataTable",
      "StatusPill",
      "EmptyState",
      "SectionCard",
    ],
    structure: [
      "PageHeader (actions = Invite user)",
      "KPI row: active / pending / archived / never signed in",
      "FilterBar: role + status",
      'SectionCard "Accounts": DataTable of MOCK_ADMIN_USERS; `lastLoginAt: null` renders as "Never signed in"',
    ],
  },
  "/mockup/admin/offerings": {
    fixtures: ["MOCK_ADMIN_OFFERINGS", "MOCK_COURSE"],
    primitives: [
      "PageHeader",
      "StatCard",
      "FilterBar",
      "DataTable",
      "StatusPill",
      "ProgressBar",
      "EmptyState",
      "SectionCard",
    ],
    structure: [
      "PageHeader (actions = Create offering)",
      "KPI row: active offerings, seats filled, over capacity, archived",
      "FilterBar: term + course + state",
      'SectionCard "Offerings": DataTable of MOCK_ADMIN_OFFERINGS with a capacity ProgressBar and a teacher column',
    ],
    notes: ["A draft offering with 0 enrolled students exercises the empty case."],
  },
  "/mockup/admin/data": {
    fixtures: ["MOCK_ADMIN_DATASETS", "MOCK_ADMIN_SUMMARY"],
    primitives: [
      "PageHeader",
      "StatCard",
      "FilterBar",
      "DataTable",
      "StatusPill",
      "EmptyState",
      "SectionCard",
    ],
    structure: [
      "PageHeader (actions = Import dataset)",
      "KPI row: datasets, rows, need review, retention due",
      'SectionCard "Datasets": DataTable of MOCK_ADMIN_DATASETS with source, rows, owner, state, retention window',
    ],
    notes: [
      "`retentionUntil: null` means the retention clock has not started because results are unpublished.",
    ],
  },
  "/mockup/admin/tools": {
    fixtures: ["MOCK_ADMIN_TOOLS", "MOCK_FEATURE_FLAGS"],
    primitives: [
      "PageHeader",
      "SectionCard",
      "DataTable",
      "StatusPill",
      "Timeline",
      "MetricRow",
      "EmptyState",
      "ProgressBar",
    ],
    structure: [
      "PageHeader",
      'SectionCard "Maintenance": DataTable of MOCK_ADMIN_TOOLS with category, state, last run; `lastRunAt: null` renders as "Never run"',
      'SectionCard "Feature flags": DataTable of MOCK_FEATURE_FLAGS with rollout ProgressBar',
    ],
    notes: [
      "Flag toggles are inert in mockups — render them as disabled controls with an explanation.",
    ],
  },
  "/mockup/admin/settings": {
    fixtures: ["MOCK_ADMIN_SUMMARY"],
    primitives: ["PageHeader", "SectionCard", "MetricRow", "KeyValueList", "StatusPill"],
    structure: [
      "PageHeader",
      'SectionCard "Institution defaults": term, timezone, grading scale',
      'SectionCard "Access policy": session length, role provisioning',
      'SectionCard "Integrations": OneRoster + LTI registration summary',
    ],
  },
  "/mockup/admin/profile": {
    fixtures: ["MOCK_CURRENT_USER", "MOCK_ADMIN_SUMMARY"],
    primitives: ["PageHeader", "SectionCard", "KeyValueList", "MetricRow", "StatusPill"],
    structure: [
      "PageHeader",
      'SectionCard "Profile": KeyValueList (name, email, role StatusPill)',
      'SectionCard "Platform scope": counts from MOCK_ADMIN_SUMMARY',
      'SectionCard "Session": mock session details',
    ],
  },
}

/** The guide for `href`, or a generic guide when a page has none yet. */
export function getPageGuide(href: string): PageGuide {
  return PAGE_GUIDES[href] ?? GENERIC
}

/** `true` when a route has an explicit guide (used by the mockup index). */
export function hasPageGuide(href: string): boolean {
  return href in PAGE_GUIDES
}
