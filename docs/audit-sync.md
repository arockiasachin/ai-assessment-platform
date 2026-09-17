# Audit ⇄ Support Desk sync

Keeps the audit reports and the support desk agreeing about one thing: whether a
finding has been dealt with.

```
audit agents ──▶ docs/audit/*.md  ─────────────┐
                                              │  npm run audit:sync
support team ──▶ support-desk tickets  ───────┘
```

## What owns what

Merging the two systems was considered and rejected, because they serve different
audiences: a support agent should not need repository access, and a queue worked by
support staff should not contain `confidentiality-leak` findings. So the split is
by **fact**, not by record:

| Owner             | Holds                                                                   |
| ----------------- | ----------------------------------------------------------------------- |
| `docs/audit/*.md` | A finding's **content** — title, evidence, location, severity, category |
| Support desk      | A finding's **status**, assignee, and the discussion about fixing it    |

The two are joined on `Ticket.externalRef`, which the importer sets to the finding
id. The desk is the system of record for status; a sync pushes report edits to it
and pulls desk decisions back.

## Why three-way, and not last-write-wins

Both sides can change while the other is not looking — an agent resolves a ticket
in the queue, a developer edits `status:` in the markdown. Last-write-wins would
clobber whichever side happened to lose the race, silently.

So the sync keeps a snapshot of what the two sides agreed on last time
(`docs/audit/.sync-state.json`, gitignored) and decides per row:

| Neither changed | Only the report changed | Only the desk changed | Both, agreeing | Both, differing        |
| --------------- | ----------------------- | --------------------- | -------------- | ---------------------- |
| nothing         | push to the desk        | pull into the report  | nothing        | **conflict**, reported |

A conflict is resolved by whichever side was changed more recently, and **printed
with both values** so a wrong resolution can be corrected. It is never guessed
silently.

## Status vocabulary

The two systems have different vocabularies, so the mapping is total in both
directions:

| Finding   | Ticket                   |
| --------- | ------------------------ |
| `open`    | `NEW`, `OPEN`, `PENDING` |
| `fixed`   | `RESOLVED`               |
| `wontfix` | `CLOSED`                 |

`PENDING` maps to `open` deliberately: the report has no "waiting" state, and
inventing one would mean the markdown could hold a value the dashboard cannot
count.

## Duplicates

Five findings are duplicates of another — the same defect filed by two audit
groups. They carry `dupOf`, and the sync makes a duplicate follow the finding it
duplicates. Without that, resolving `TN-1` in the desk would leave `TN-31`
describing the same defect as `open`, and the dashboard would report one bug as
both fixed and unfixed.

## Usage

```bash
npm run audit:import      # file findings as tickets (idempotent)
npm run audit:sync:dry    # show the plan, change nothing
npm run audit:sync        # apply
npm run audit:sync -- --verbose        # include unchanged rows
npm run audit:sync -- --no-markdown    # push only, never edit reports
npm run audit:sync -- --dir <path>     # a different reports directory
```

A first run against a fresh clone **changes nothing** — with no snapshot, every row
is a first sighting and is only recorded. That is the safe default: a new machine
must not start rewriting statuses it has never agreed on.

## Configuration

| Variable                   | Purpose                                           |
| -------------------------- | ------------------------------------------------- |
| `AUDIT_SYNC_DESK_URL`      | The desk's base URL, e.g. `http://localhost:4300` |
| `AUDIT_SYNC_DESK_EMAIL`    | A support-desk member account                     |
| `AUDIT_SYNC_DESK_PASSWORD` | That account's password                           |
| `AUDIT_SYNC_WORKSPACE`     | Workspace slug or id, e.g. `assessment-platform`  |

**Point the email at a dedicated agent account, not at a person's.** The sync signs
in as a member because that is the desk's only credential for its member API — the
workspace API keys are scoped to intake and cannot read the queue or change a
ticket.

This is a real limitation rather than a design: the better shape is a scoped
service token that can read tickets and set status but not administer the
workspace. Until the desk has one, a dedicated account with a long random password
is the least-privilege option available.

## Reporting rather than resolving

The sync never decides that a finding is fixed on its own. It moves a status that a
person or a check already set, in whichever system they set it. `fixed` therefore
means the same thing in both places, and the four findings that the re-verification
pass confirmed are `fixed` in the report and `RESOLVED` in the desk.
