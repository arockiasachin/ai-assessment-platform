# Student-work retention policy

This document is the authoritative description of the data-retention policy for
the AI assessment platform: what is deleted, what is redacted, what is kept
forever, and why. It implements the product owner's policy, stated verbatim:

> "Student work is retained till he gets graded for the whole course and 15 days
> after results are published."

## The policy in plain language

A student's **work artifacts** are kept while the course is in progress. They are
only ever removed once **both** of these are true:

1. the course offering's **results have been published**, and
2. **15 days** have elapsed since that publication.

Nothing is removed while a course is ungraded or its results are unpublished. The
academic record — published grades and the audit trail — is **never** removed,
by this policy or any other.

## The retention anchor

The anchor is **`CourseOffering.resultsPublishedAt DateTime?`**, set by an
explicit teacher action (`POST /api/teacher/offerings/[offeringId]/results`).

- **Why an explicit column rather than inferring from `endsOn`.** Results
  publication is a deliberate act that ends grading; a course can end without
  results being published (grading continues afterwards). Inferring from
  `endsOn` would start the deletion clock before grades were final — the exact
  opposite of "retained till he gets graded".
- **Why per-offering rather than per-enrollment.** Results are published for a
  whole course cohort at one moment; the policy speaks of "the whole course".
  A per-enrollment anchor would let an individual student's work be deleted while
  the course cohort's results were still unpublished, and the schema has no
  per-student "course graded" concept — `Enrollment.status` is an
  active/waitlisted-style enrollment state, not a grading state.
- **Publish-once semantics.** The timestamp is set once and never moved.
  Re-publishing an already-published offering is reported as
  `already-published` and leaves the anchor unchanged. Moving it later would
  extend retention; moving it earlier would shorten it. Neither is a decision a
  repeat click may make.
- **Server-side cutoff.** Eligibility is always derived from the stored anchor
  and the server clock. No request may nominate an offering, a cutoff, or a
  deletion date. The pure decision lives in `lib/retention/policy.ts`; the purge
  in `lib/retention/purge.ts` only reads the anchor and calls it.

The boundary is **inclusive**: at exactly `resultsPublishedAt + 15 days` the
offering is eligible; one millisecond earlier it is not.

## Entity-by-entity disposition

**"Redact"** means the row survives (so references and history stay intact) but
the listed personal content fields are cleared and `purgedAt` is stamped.
**"Retain"** means the purge never touches the row or field.

### Permanently retained — never deleted, never redacted

| Entity                                                                                                              | Fields                                            | Why                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Grade`                                                                                                             | all                                               | The transcript. Deleting a published grade is a serious error; the purge never references the table.                                                           |
| `AuditLog`                                                                                                          | all                                               | The evidence trail. The purge only ever **appends** its own `retention.purged` rows; it never deletes one.                                                     |
| `GradeReview`                                                                                                       | all (`notes`, `decisionsJson`, status, decisions) | Grade provenance: which human decided what, and when. Tied to a published grade.                                                                               |
| `CourseOffering`, `Course`, `ClassRoom`, `Enrollment`                                                               | all                                               | Course structure and the roster; no student-authored content.                                                                                                  |
| `Assessment`, `Question`, `QuestionOption`, `Rubric`, `RubricCriterion`, `CodeTask`, `TestCase`                     | all                                               | Assessment definitions and published question content — instructor-authored, not student work.                                                                 |
| `Group`, `GroupMember`, `Milestone`                                                                                 | all                                               | Group structure and numeric adjustment factors.                                                                                                                |
| `ContributionEvent`                                                                                                 | all                                               | Contribution evidence (commit/PR summaries, weights). Retained; flagged below.                                                                                 |
| `SimilarityCheck`                                                                                                   | all, including `evidence`                         | `evidence` holds only aggregate metrics (token counts, shared-shingle counts, threshold) — verified in `lib/code-eval/similarity.ts` — not student code spans. |
| `Material`, `MaterialChunk`                                                                                         | all                                               | Course material the instructor supplied (may be third-party); not student work.                                                                                |
| `LtiRegistration`, `LtiUserMapping`                                                                                 | all                                               | Integration configuration and opaque user mapping, no student content.                                                                                         |
| `CalendarEvent`                                                                                                     | all                                               | Schedule metadata.                                                                                                                                             |
| `Submission.feedback` and all non-content columns (`status`, timestamps, `gradedById`, …)                           | as listed                                         | Teacher-authored feedback is part of the academic record; timestamps/status are provenance.                                                                    |
| `QuizAttempt` row (`score`, `status`, timestamps)                                                                   | as listed                                         | The attempt's numeric outcome and lifecycle are assessment/analytics history; only its responses' answers are redacted.                                        |
| `CourseRating.rating`                                                                                               | numeric                                           | Retained for aggregate reporting (the teacher ratings report).                                                                                                 |
| `PeerEvaluation.dimensions`, `overallScore`, `status`                                                               | numeric/enum                                      | Retained for group-adjustment history; only the free text is redacted.                                                                                         |
| `AIGradeSuggestion` numeric/provenance fields (`suggestedPoints`, `maxPoints`, `confidence`, `model`, token counts) | as listed                                         | Needed to show how a grade was drafted; contains no student text.                                                                                              |

### Redacted after the retention window

| Entity              | Redacted fields                                                                  | Row survives because                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `Submission`        | `contentText`, `artifactUrl`                                                     | It is the grade's provenance and is referenced by versions, suggestions and test runs.                                            |
| `SubmissionVersion` | `contentText`, `artifactUrl`                                                     | Preserves that versions existed (number, word count, timestamps) without the content.                                             |
| `QuizResponse`      | `selectedOptionIds`, `answerText`, `rationale`                                   | Keeps `isCorrect`/`pointsAwarded` for history and referential integrity with `AIGradeSuggestion`.                                 |
| `TestRun`           | `sourceCode`, `stdout`, `stderr`, `resultsJson`                                  | Keeps status and pass/fail counts as run history.                                                                                 |
| `AIGradeSuggestion` | `rationale` (set to `[redacted by retention policy]`), `evidence`, `rawResponse` | Keeps scores/model/token provenance. **`evidence` is quoted student text** — the highest-risk field this policy exists to remove. |
| `CourseRating`      | `comment`                                                                        | Keeps the numeric rating for aggregate reporting.                                                                                 |
| `PeerEvaluation`    | `comments`                                                                       | Keeps numeric dimensions/scores for adjustment history.                                                                           |

### Deleted rows

**None.** This policy is **redact-only**: no row is deleted. Redacting fields
achieves the privacy goal (the personal content is gone) while leaving every
foreign key intact, so it cannot orphan a grade chain, a suggestion, or an audit
reference. A future policy that wanted row removal could do so for
`SubmissionVersion`/`QuizResponse` (no inbound references), but that is a
deliberate non-goal here: retaining the now-content-free rows is the
conservative choice.

## Judgement calls (each flagged, each reversible)

1. **Redact rather than delete.** Preferred because it cannot break referential
   integrity or accidentally cascade into the academic record.
2. **`Submission.feedback` is retained.** It is teacher-authored and part of the
   grade record; it is not "student work". (If a reviewer judges that feedback
   may quote student text and should go, add it to the redaction in
   `purgeOffering` and the tests.)
3. **`CourseRating` keeps the number, loses the comment.** Ratings feed aggregate
   reporting; the free-text comment is student personal data. Flagged: if the
   owner wants comments kept for course-improvement review, remove `comment`
   from the redaction.
4. **`PeerEvaluation` keeps dimensions/score, loses comments.** The numbers drive
   adjustment factors; confidential peer comments are personal. Flagged for the
   same reason.
5. **`GradeReview.notes` is retained.** It is the human grading rationale tied to
   a published grade (academic/evidence record), analogous to `AuditLog`. Flagged
   as the one retained field that could contain a staff member's quote of student
   text.
6. **`SimilarityCheck.evidence` is retained** because it stores aggregate metrics
   only. Verified against the implementation; if it ever starts storing code
   spans, it must be redacted.
7. **`ContributionEvent` is retained.** Commit/PR/issue summaries are
   contribution evidence for group grading, not student coursework.
8. **`AuditLog` snapshots are retained in full.** The mandate is that audit rows
   are never deleted; the purge does not mutate them either. `AuditLog.before`/
   `after` can embed grade snapshots. Flagged as a residual risk: redacting inside
   an append-only audit row would weaken the evidence trail, so it is out of
   scope for this policy and left for a human decision.
9. **`QuizAttempt` rows are retained** (only responses are redacted): the numeric
   attempt outcome is assessment history, not personal free text.
10. **`AIGradeSuggestion` numbers are retained** so the provenance of a published
    grade remains legible; only the model's free text and quoted evidence go.
11. **Dry run is the default** at every entry point; destructive execution is
    always opt-in (`dryRun: false` / `--execute`).
12. **Publishing is one-way.** There is no "unpublish" endpoint; retracting a
    publication would need an explicit product decision about whether the clock
    rewinds.

## Running a dry run

Dry run reports exactly what would be redacted and **writes nothing** (no row
updates, no audit rows).

**As an admin, over HTTP:**

```bash
# Dry run (default) — report only.
curl -sS -X POST https://app.example.com/api/admin/retention/purge \
  -H 'content-type: application/json' \
  -b 'auth-user=<admin session cookie>' \
  -d '{"dryRun": true}'

# Execute (irreversible redaction).
curl -sS -X POST https://app.example.com/api/admin/retention/purge \
  -H 'content-type: application/json' \
  -b 'auth-user=<admin session cookie>' \
  -d '{"dryRun": false}'
```

The route is guarded by `requireRole("admin")`; it derives eligibility
server-side and cannot be pointed at a specific offering.

**As an operator, on the box:**

```bash
DATABASE_URL="postgresql://…" npm run retention:purge               # dry run
DATABASE_URL="postgresql://…" npm run retention:purge -- --execute  # execute
```

Both print a JSON report: `eligibleOfferings`, skipped counts by reason
(`unpublished`, `withinWindow`, `invalidAnchor`), and per-entity row counts.

## Scheduling it

The project has **no always-on worker and no job-scheduler dependency**, so the
purge is a run-to-completion command an operator schedules externally. A daily
cron entry:

```cron
15 3 * * * cd /srv/assessment && DATABASE_URL="postgresql://…" npm run retention:purge -- --execute >> /var/log/retention.log 2>&1
```

Run the dry run once before enabling `--execute`, and alert on a non-zero exit
code. Idempotency means a missed or repeated run is safe: a second execution
selects nothing and changes nothing.

## Tests that enforce this document

- `tests/retention-policy.test.ts` — the pure decision, including the inclusive
  15-day boundary and the unpublished/within-window cases.
- `tests/retention-purge.test.ts` — dry run modifies nothing; unpublished and
  within-window offerings are never purged; execution redacts each entity while
  proving every `Grade` and `AuditLog` row survives; a second run is a no-op.
- `tests/retention-route-auth.test.ts` — the admin purge and teacher publish
  routes enforce their roles and contracts before any service runs.
