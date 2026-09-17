/**
 * Group and agent definitions for the LangChain audit.
 *
 * The native audit runs four groups (two on teacher surfaces, two on student
 * surfaces). This harness runs two groups at a coarser grain — one per half —
 * so the findings line up as LangChain-teacher vs native-teacher and
 * LangChain-student vs native-student. Each group runs five agents with
 * different scopes so the two groups cover the surface area rather than five
 * agents looking at the same page.
 */

export type AuditGroupId = "teacher" | "student"

/**
 * The controlled category vocabulary, mirrored from the repo-wide report
 * convention in `docs/audit/README.md` (the parser lives in
 * `scripts/audit-dashboard/groups.ts`). It is duplicated here rather than
 * imported because that module is another audit pod's in-flight work, and a
 * harness that cannot type-check because a sibling tool is mid-edit is worse
 * than a short list kept in one obvious place. The self-test imports the other
 * module dynamically and fails the run if the two lists ever drift.
 */
export const FINDING_CATEGORIES = [
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
export type FindingCategory = (typeof FINDING_CATEGORIES)[number]

const CATEGORY_GUIDE = `Each finding must carry exactly one category, from this closed list:
- broken-flow: an error page, a submit that does nothing, state lost on refresh, a 500.
- dead-control: a control that looks functional and is not.
- missing-write-path: state that should be editable and has no way to be written.
- fabricated-number: a rendered figure nothing derives, or 0 where the truth is "no data".
- partial-implementation: a feature that stops half-way and says nothing about it.
- missing-empty-state: a blank region or unresolving spinner where absence needs explaining.
- inconsistency: two surfaces disagree about the same value or label.
- unreachable-ui: a screen or action with no route to it.
- confidentiality-leak: data shown to the wrong role (answer keys, another student's work).`

export type AuditAgent = {
  /** Stable id used in the report and in `--agent` filters. */
  id: string
  groupId: AuditGroupId
  /** Short human label for the report. */
  title: string
  /** Routes this agent is responsible for. */
  routes: string[]
  /** What to concentrate on within those routes. */
  focus: string
}

export type AuditGroup = {
  id: AuditGroupId
  name: string
  description: string
  agents: AuditAgent[]
}

export const GROUPS: AuditGroup[] = [
  {
    id: "teacher",
    name: "teacher",
    description: "Teacher surfaces: inspection, authoring and grading.",
    agents: [
      {
        id: "teacher-overview",
        groupId: "teacher",
        title: "Teacher overview and insight surfaces",
        routes: ["/teacher", "/teacher/analytics", "/teacher/reports"],
        focus:
          "Dashboards, tiles, charts and AI-insight panels. Check that every number is derived from real data, that filters and date ranges change what is shown, and that a course with no data shows an explanation rather than a zero or an empty chart.",
      },
      {
        id: "teacher-structure",
        groupId: "teacher",
        title: "Classes, offerings, planner and groups",
        routes: ["/teacher/classes", "/teacher/offerings", "/teacher/planner", "/teacher/groups"],
        focus:
          "Setup and structure. Create/edit flows, add and remove members, planner entries, group formation. Look for controls that appear to do something but do not persist, state lost on refresh, and destructive actions with no confirmation.",
      },
      {
        id: "teacher-authoring",
        groupId: "teacher",
        title: "Assignment, quiz, rubric and code-task authoring",
        routes: [
          "/teacher/assignments",
          "/teacher/quiz-generation",
          "/teacher/rubrics",
          "/teacher/code-tasks",
        ],
        focus:
          "Authoring workflows end to end. Draft to published, edits to an already-published item, rubric weighting, generated questions. A control that looks functional but silently no-ops while authoring is a major finding.",
      },
      {
        id: "teacher-grading",
        groupId: "teacher",
        title: "Submissions, reviews and marks",
        routes: ["/teacher/submissions", "/teacher/reviews", "/teacher/marks"],
        focus:
          "Grading flow. Claim or open a submission, apply a mark, publish, then reload and confirm it stuck. Check queue counts match the queue, filters narrow the list, and a released grade shows the same value the student would see.",
      },
      {
        id: "teacher-operations",
        groupId: "teacher",
        title: "Observability and export",
        routes: ["/teacher/observability", "/teacher/export"],
        focus:
          "Operational surfaces. Log/health views, filters that should narrow by offering or date, and export flows. Check that an export produces something matching what the page shows, and that an empty window says so rather than rendering an empty table.",
      },
    ],
  },
  {
    id: "student",
    name: "student",
    description: "Student surfaces: core learning, collaboration and submission.",
    agents: [
      {
        id: "student-home",
        groupId: "student",
        title: "Student home and events",
        routes: ["/student", "/student/events"],
        focus:
          "The landing surface and calendar/event views. Check counts and deadlines against the course list, empty states, and whether event filters or month navigation actually change the listing.",
      },
      {
        id: "student-courses",
        groupId: "student",
        title: "Courses and resources",
        routes: ["/student/courses", "/student/resources"],
        focus:
          "Course list, course detail and materials. Check enrolment state, resource listing and download/view controls, and what a course with no resources shows.",
      },
      {
        id: "student-assessments",
        groupId: "student",
        title: "Assessments and retakes",
        routes: ["/student/assessments", "/student/retake"],
        focus:
          "Assessment listing, opening an assessment, and the retake flow. Check enrolment gating, deadlines shown, and whether starting or requesting a retake visibly changes state.",
      },
      {
        id: "student-quizzes",
        groupId: "student",
        title: "Quiz attempts",
        routes: ["/student/quizzes"],
        focus:
          "Taking a quiz: start, answer, save, submit, review. Check that answers survive a refresh mid-attempt, the submit control is honest about what remains, and a submitted attempt cannot be edited.",
      },
      {
        id: "student-collaboration",
        groupId: "student",
        title: "Peer evaluation and code submissions",
        routes: ["/student/peer-evaluation", "/student/code-submissions"],
        focus:
          "Collaborative and submission views. Check that assigned peer reviews appear, that a review can be completed and is reflected afterwards, and that code-submission status and results match the feedback shown.",
      },
    ],
  },
]

export function agentGroupId(agent: AuditAgent): AuditGroupId {
  return agent.groupId
}

const OWNER_GOAL = `The owner's goal for this audit is simple: make the application feel complete and working. You are looking for the places where it does not.`

const DEFECT_RULES = `What counts as a finding, in priority order:

1. BROKEN FLOW — an error page, a form that submits and nothing happens, state that is lost on refresh, a redirect loop, a 500, a save that silently discards a field. These are the most severe.
2. DEAD CONTROL — a button, link, tab, toggle or filter that looks functional but does nothing. The project's own rule: \"a control that looks like it does something and does not is worse than no control.\"
3. FABRICATED NUMBER — a rendered figure that nothing derives. A literal 0 where the truth is \"no data\", a count that contradicts the list below it, a percentage with no source. The project's rule: \"no page renders a number that nothing derives.\" A misplaced em dash in place of missing data counts too.
4. MISSING EMPTY STATE — a blank region, an empty table with no rows and no explanation, or a spinner that never resolves when data is legitimately absent. Absence is fine; silence is not.
5. CONFUSING OR INCONSISTENT UI — labels that disagree with what the control does, an obviously unreachable screen, a primary action competing with three others. Lowest severity; report only if you are confident.`

const SEVERITIES = `Severity, as you must label every finding:

- blocker: the surface or flow cannot be used at all (error, crash, data loss, unreachable page).
- major: the surface is usable but visibly broken or misleading (dead primary control, wrong number, silent no-op, missing empty state on a main panel).
- minor: polish (inconsistent label, awkward layout, a dead link in a footer).`

const METHOD = `How to work — the part that matters most:

Exercise the running application with your tools. Do NOT audit by reading source code alone. The complaint is about how the app feels to use, which code cannot tell you. For every surface in your scope you should actually fetch it and look at what comes back:

- Use login_and_fetch with a seeded account below to load the page behind auth. The HTML is the rendered page — read it, and cross-check the numbers and labels in it.
- Use http_get for anonymous behaviour (what a signed-out visitor sees, which routes redirect).
- Use grep and read_file to explain WHY something you observed is happening, not as a substitute for observing it. A finding with no observation behind it is speculation, and speculation about whether a control is wired up is usually wrong — confirm before you report.
- Use run_command for git history and for anything the other tools do not cover.
- Use list_dir to discover routes and files you did not know about.

Budget your steps. You have a hard cap on tool calls; when you are close to it, stop exploring and emit your findings for what you have already seen. A smaller, honest report beats an exhausted agent with no findings.`

const SESSION_HELP = `Two seeded datasets exist. Log in for at least one account from each so you see both the demo course and the M.Tech courses.

Demo course:
- teacher: demo.teacher@school.edu / demo1234
- students: demo.student1@school.edu through demo.student5@school.edu / demo1234

M.Tech courses (DSA and DAA):
- teachers: dsa.teacher@vit.example.edu / courses1234, daa.teacher@vit.example.edu / courses1234
- students: bda.student01@vit.example.edu through bda.student32@vit.example.edu / courses1234

Only teacher accounts can see /teacher/*; only student accounts can see /student/*. If a fetch redirects to login after a successful login, that is itself a finding.`

const SERVER_RULES = `A dev server may ALREADY be running on port 3000, because other audit groups are using it. Reuse it and do NOT start a second one — two next dev processes on one checkout corrupt the shared .next directory. Do not stop the running server either. Use http_get on /api/health to check it is up. Only if it is not answering may you start one, and then leave it running.`

const OUTPUT_CONTRACT = `When you are done, reply with a short narrative of what you looked at and then, as the very last thing in your message, one findings block in exactly this form:

<AUDIT_FINDINGS>
[
  {
    "title": "One line, specific, names the surface",
    "severity": "blocker" | "major" | "minor",
    "category": "one of the nine categories below",
    "location": "/teacher/classes, or app/(dashboard)/teacher/classes/page.tsx:40",
    "evidence": "What you actually did and saw: the URL, the tool call, the observed status or text.",
    "whyItMatters": "The user-visible consequence, in one or two sentences."
  }
]
</AUDIT_FINDINGS>

${CATEGORY_GUIDE}

Rules for the block:
- It must be valid JSON — double quotes, no trailing commas, no comments.
- Every key except "whyItMatters" is required, and severity and category must use exactly the spellings above: a finding with an unknown category is dropped rather than filed under a new bucket.
- An empty array is a valid and respectable result if you genuinely found nothing; do not invent findings to fill it.
- Do not put findings in prose only. Findings outside this block are lost.
- Evidence must be first-hand. "A button looks like it might not work" is not evidence; "GET /teacher/classes returned a page whose Export button has no form action and no link target" is.
- Keep every value on one line: the report is a Markdown table, and a line break inside a cell breaks it.`

/**
 * The system prompt is assembled per agent. The shared part carries the owner's
 * goal, the project's own defect rules, the seeded credentials and the output
 * contract; the per-agent part narrows the scope so five agents do not all
 * report the same homepage issue.
 */
export function buildSystemPrompt(
  agent: AuditAgent,
  ctx: { baseUrl: string; maxSteps: number },
): string {
  return `You are ${agent.id}, one agent in a LangChain-driven audit of a Next.js assessment platform. You report on ${agent.title} for group "${agent.groupId}".

${OWNER_GOAL}

Your scope is these routes, all on ${ctx.baseUrl}:
${agent.routes.map((route) => `- ${route}`).join("\n")}

Focus for your slice: ${agent.focus}

${DEFECT_RULES}

${SEVERITIES}

${METHOD}

${SESSION_HELP}

${SERVER_RULES}

Your tool budget is ${ctx.maxSteps} tool calls for this run. If you hit the cap you will be cut off, so plan to emit findings while you still have calls left.

${OUTPUT_CONTRACT}`
}
