# Support Desk — Scratchpad

Ideas, evidence and constraints for the support desk, accumulated while the assessment
platform's audit remediation runs. This is a **working note**, not a specification. It is
deliberately unpolished, and it exists so that things learned during the remediation are not
lost before the desk work resumes.

Hand this to the desk's development as a brief when the audit fixes are done.

---

## 1. The desk's intended shape: standalone first, attachable second

Stated by the owner as _"a symbiote that needs another system for the ticket generation while
it can act as its own if needed"_. Unpacked, because the phrasing is the requirement:

**The desk must work with no host at all.** A requester is not necessarily a user of some
other application. They may be:

- a person typing into a form on the desk's own page,
- someone replying to an email the desk sent, or
- someone whose message arrived through some other channel we have not built yet.

In that mode the desk _is_ the whole product. It needs its own identity for a requester, its
own way to receive a message, and its own way to reply. Nothing about it may assume that an
authoritative user table exists somewhere else.

**And it must attach to a host when one exists.** When the assessment platform — or any other
application — is present, it supplies identity and context: who the person is, and what they
were looking at when they hit a problem. That is strictly additive.

### 1.1 The constraint this creates, which binds now

**The desk must never depend on the assessment platform.** Concretely, and checkable:

- No code path may require a host to exist. Every feature works with zero hosts configured.
- A requester without a host identity is a first-class requester, not a degraded one. Today
  the desk's only identity path is host SSO; a typed-in email is not the same thing as a
  verified identity, and the model must be honest about that difference rather than pretending
  they are equivalent.
- The assessment platform appears in the desk's code only as **seed data and test fixtures**.
  If it appears anywhere else, that is a defect against this requirement.

### 1.2 What this changes in the existing design

| Area                      | Change implied                                                                                                                                                                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Authentication**        | A third principal alongside member and contact: an _unverified requester_, identified by an email address and a token, with no host assertion behind them. The authority boundary must handle "we think this is who they say they are" as a distinct state. |
| **Intake**                | Today `POST /api/intake/tickets` requires a workspace API key and a host-supplied `externalId` or `reporterLabel`. A standalone deployment needs a public intake that requires neither.                                                                     |
| **Notifications**         | Currently there are none, and the widget is the only way a requester sees a reply (§6.1 of the system design). A standalone desk with no host _must_ send email, so email moves from "planned, P4" to "required for the standalone mode".                   |
| **The widget**            | Becomes one channel among several rather than the primary surface.                                                                                                                                                                                          |
| **Identity verification** | Needs a decision: an emailed token that confirms the address, or accept unverified and mark it. The trust difference should be visible on the ticket, not implied.                                                                                          |

### 1.3 Open questions this raises

- Does a standalone desk need its own end-user **portal**, or is a form plus email enough?
- What is the workspace model for a single-organisation deployment that has no host? A
  "workspace" is currently identified with a host application; standalone, it is more like an
  organisation or a team.
- Do the two modes share one schema with a nullable host link, or does the host link become a
  separate optional table? The former is simpler; the latter makes "no host" the default
  rather than the exception.
- If a host is added later to a standalone desk, how do existing unverified requesters
  reconcile with host identities? The contact-merge problem, but with a weaker identity to
  merge on.

---

## 2. What the audit's agent runs taught us about agents against this API

The audit was run twice over the same surfaces — once by native agents and once by LangChain
agents driving the running app over HTTP. That second run is direct evidence for the desk's
autonomous-agent design, because the desk's agent will work in exactly that way: an external
process, a member credential, an HTTP API.

### 2.1 Verified observations from the LangChain runs

- **Step caps were hit by 8 of 10 agents.** The harness bounded each agent's steps, and most
  exhausted them. An agent exploring an unfamiliar API spends most of its budget orienting.
  _Implication for the desk's agent:_ a fixed step cap is the wrong control for a task whose
  length the agent cannot predict. Bound by **time and cost**, and make the task smaller.

- **The agents wrote to the database they were auditing.** Not by choice — the API gave them
  write paths and they used them. This produced residue (28 student-visible calendar events)
  and invalidated some of their own evidence: three findings rested on state the agent itself
  had created. _Implication:_ an agent must be **provably unable** to mutate what it is
  inspecting, or its observations are not evidence. For the desk, this is the argument for
  scoped `ServiceToken`s over a borrowed member account — a token that _cannot_ write is
  stronger than an agent that _promises_ not to.

- **The agents found real things the API made awkward to find.** They followed links, checked
  whether a response matched its own documentation, and noticed where a payload carried data
  the UI did not render. Several findings — the RSC-payload leaks, the fabricated percentages
  — came from reading responses rather than screens. _Implication:_ an agent's advantage is
  reading the API exhaustively; that is what it should be given, and the desk's agent should
  be pointed at responses, not just at rendered pages.

- **Two independent groups found the same defects.** Five findings were duplicates across the
  native and LangChain runs. That convergence is the strongest signal in the audit — when two
  methods agree, the finding is real. _Implication:_ the desk's agent should be one of several
  methods, not the only one, and agreement between them should be measured rather than
  assumed.

### 2.2 What the harness got wrong, that the desk's agent should not repeat

| Mistake                              | What happened                                       | What the desk should do instead                                 |
| ------------------------------------ | --------------------------------------------------- | --------------------------------------------------------------- |
| Writing while auditing               | Residue, and evidence that invalidated itself       | Read-only by construction                                       |
| A fixed step cap                     | 8/10 agents ran out                                 | Bound by wall-clock and cost                                    |
| Filing raw findings                  | 129 tickets, 5 of them duplicates                   | Deduplicate before filing (already specified, §11.1)            |
| No idempotency marker                | A re-run would have re-filed everything             | The ledger, keyed on an idempotency key                         |
| Classifying with an LLM before dedup | Both stages cost tokens on the same content         | Cheap deterministic filters first; the model sees what survives |
| No provenance on the message         | Agent replies were indistinguishable from a human's | AI-attributed writes (already fixed at the service layer)       |

---

## 3. UI fixes and ideas for the desk

Collected from using the desk and from the audit's findings about the host app's UI, many of
which generalise.

### 3.1 From the desk's own UI, as built

- **The queue has no bulk actions.** An agent clearing a backlog acts one ticket at a time.
- **Nothing indicates a ticket changed since you last looked.** There is no "new since" marker,
  and no `updatedSince` on the list (§OD-15, deferred to filtering client-side in v1).
- **The ticket detail has no history view.** `TicketEvent` is written faithfully and never
  rendered, which is a shame — it is the most complete record in the product.
- **Status is conveyed by colour and text**, which is fine, but there is no icon and no
  grouping in the queue beyond sort order.
- **No keyboard path.** The queue is mouse-driven, which is wrong for a tool someone uses all
  day (WB §D6 already requires this).

### 3.2 Generalisable from the audit's findings about the host app

The audit found 10 `missing-empty-state`, 10 `dead-control`, and 34 `inconsistency` findings in
the host application. The desk will have the same classes of defect unless it is built
against them:

- **A dead control is worse than an absent one.** The host's `CLOSED` status option was
  offered everywhere and worked nowhere. An option that always fails teaches the user to
  distrust the interface. _Rule for the desk:_ a control that cannot succeed for the current
  state must not be rendered, and the reason should be stated, not implied.
- **Empty states must distinguish "none exist" from "none match".** The host says "No
  assessments match the current filters" when no filter is set and there are no assessments.
  It reads as a bug.
- **Two views of one number must never disagree.** 34 `inconsistency` findings, many of them
  the same fact rendered two ways with different values ("Enrolled 5" on one page, "Enrolled
  48" on another). _Rule for the desk:_ a count is computed once and passed, never recomputed
  per surface.
- **Raw enum values leak into the UI.** The host renders `QUIZ`, `CODE`, `GROUP_PROJECT` and
  internal ids where friendly labels belong. The desk has a `lib/labels.ts` for exactly this;
  the rule is that no enum reaches a screen.

### 3.3 Ideas worth considering

- **A queue that explains itself.** The operating model's sorting is status, then priority,
  then age. A one-line explanation of why a ticket is where it is — "urgent, unassigned, 4h
  old" — costs nothing and removes the "why is this at the top" question.
- **Show the promise, not just the state.** The desk's whole thesis is that a ticket is a
  promise with a clock. The queue should show time remaining against it, not just an age.
- **Make the audit trail visible.** `TicketEvent` is complete and unread. Rendering it as the
  ticket's timeline would make the product's honesty visible rather than merely true.
- **A "needs me" view**, per member, derived from assignment plus mentions plus the
  awaiting-team flag. Today an agent has to build that by filtering.
- **Draft replies as a first-class object.** The agent design needs proposals; a human wants
  drafts. They are the same shape, and building one would serve both.

---

## 4. Notes that are not yet decisions

- The desk's own test suite has **no route-level tests**, and every authority leak it had was
  a route-level behaviour. Route-auth tests are the host's convention and the desk's gap.
- The desk has **no observability at all** — `console.error` is its entire operational output,
  while the host has structured logs, request timing, redaction and a careful health endpoint.
- The desk's README does not mention that it can run standalone, because it cannot yet. When
  §1 above is implemented, that becomes its headline.
