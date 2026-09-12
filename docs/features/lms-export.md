# Feature: weighted final grades and LMS export (Phase 2, pod 6)

A teacher configures weighted grade categories; the platform combines assessment
results into a final grade per student per offering using **published grades
only**, exports the gradebook as OneRoster 1.2-shaped CSV, and prepares the pure
pieces a real LTI 1.3 Assignment & Grade Services integration will need.

Merged to `dev` in `9117b2e` (`feat(lms-export): weighted final grades, OneRoster CSV and LTI AGS
groundwork`); the `p2/lms-export` branch was deleted after merging.

## Goal and product rules

This pod implements product-spec §7 (grade export and LMS interoperability) and
keeps the rules it touches intact:

- **Only published grades count.** `Grade.publishedAt` is the gate. A pending
  `AIGradeSuggestion` (or an unpublished draft `Grade`) is _excluded_ from the
  final grade — never scored as zero — and is reported back to the caller so the
  exclusion is visible. Publishing is done by a teacher `accept` / `override` in
  `lib/grading/review-service.ts`, or by a teacher entering a manual mark; this
  pod never writes a grade.
- **The modern `Grade` is the only store.** The legacy `AssessmentGrade` model was
  retired and its table dropped; there is no fallback path.
- **A teacher exports only their own offerings; a student only their own rows.**
  Enforced with `requireRole` plus object-level ownership resolved from the
  signed session.
- **No LMS is contacted.** The OneRoster export is a file, and the only LTI
  client shipped is an in-memory dry run. The runtime never reaches the network.

## API surface

### Teacher — `app/api/teacher/export/**`

| Method + path                        | Input                                                                         | Output                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `GET /api/teacher/export`            | `?offeringId=` required                                                       | `{ success, offering, config, assessments[], students[], lti, generatedAt }` |
| `POST /api/teacher/export`           | `{ offeringId, config? }`                                                     | same, with the supplied weight configuration applied                         |
| `GET /api/teacher/export/oneroster`  | `?offeringId=`, `?file=lineItems\|results\|scoreScales` (default `lineItems`) | a `text/csv` attachment                                                      |
| `POST /api/teacher/export/oneroster` | `{ offeringId, file, config? }`                                               | a `text/csv` attachment with the supplied weights                            |
| `POST /api/teacher/export/lti`       | `{ offeringId, config?, ltiUserIds? }`                                        | `AgsDryRunResponse` — built payloads and the dry-run call log                |

### Student — `app/api/student/export/**`

| Method + path                       | Input                    | Output                                                        |
| ----------------------------------- | ------------------------ | ------------------------------------------------------------- |
| `GET /api/student/export`           | `?offeringId=` required  | `{ success, offering, config, finalGrade, lti, generatedAt }` |
| `GET /api/student/export/oneroster` | `?offeringId=`, `?file=` | a `text/csv` attachment containing only the student's results |

The student id is always taken from the signed session and an active `Enrollment`
is required; a non-enrolled student gets 403.

CSV responses carry `Content-Type: text/csv; charset=utf-8`,
`Content-Disposition: attachment; filename="..."`, `Cache-Control: no-store`,
and `X-OneRoster-Rows` / `X-Generated-At` diagnostics.

## How final grades are computed

`lib/lms-export/final-grade.ts` is pure and has three inputs: the weight
configuration, the offering's assessment ids, and each student's raw candidates.

1. **Resolve marks per assessment** (`resolveMarks`):
   - a modern `Grade` with `publishedAt != null` → `modern-grade`;
   - a modern `Grade` with `publishedAt == null` → **excluded**, recorded in
     `excludedUnpublishedAssessmentIds`;
   - an assessment with no modern `Grade` row contributes no mark.
   - Each mark carries `percentage = clamp(points / maxPoints × 100, 0, 100)`.
2. **Score each category.** Within a category the score is a weighted average of
   the assessment percentages:
   `categoryScore = Σ(assessmentPct × assessmentWeight) / Σ(assessmentWeight)`,
   with `assessmentWeight` defaulting to `1`.
3. **Combine categories.** `finalPct = Σ(categoryScore × categoryWeight) /
Σ(categoryWeight)` over the categories that had at least one mark. A category
   with no usable mark is **excluded and renormalised away**, so an ungraded (or
   unpublished-only) category neither helps nor drags the grade to zero.
   `completedWeight` reports how much of the 100 was used and `incomplete` is set
   when anything was excluded. The letter is the app-wide `letterGrade` band
   (A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, else F).

The service (`lib/lms-export/service.ts`) only loads data; the arithmetic is the
pure kernel, which is why the invariant tests run without a database.

### Weight validation

`validateFinalGradeConfig` (`lib/lms-export/weights.ts`) is called on every path
before a grade is computed and throws `LmsExportValidationError` → HTTP 400 with
a readable message:

- at least one and at most 50 categories;
- unique category ids (case-insensitive) and unique names;
- every category weight finite, positive, `≤ 1000`;
- **category weights must sum to 100** within `0.01` tolerance (so
  `33.33 + 33.33 + 33.34` is accepted, `60 + 30` is rejected with
  `Category weights must sum to 100 (they sum to 90).`);
- every category has at least one assessment;
- an assessment may belong to only one category;
- every referenced assessment must belong to the offering (`knownAssessmentIds`);
- optional per-assessment weights must be positive and inside the category.

When a teacher omits `config`, the service derives a single equal-weight
category (`defaultFinalGradeConfig`) containing every assessment.

## Resolved: single grade store

The frozen schema originally carried the legacy `AssessmentGrade` model alongside
the modern `Grade` pipeline. That duality is **resolved**: `AssessmentGrade` has
been retired (its table dropped by migration
`20260912020000_retire_assessment_grade`), every writer now publishes into `Grade`
with an `AuditLog` row, and every reader (this export included) reads only the
modern store. `StudentFinalGrade` no longer carries a
`legacyFallbackAssessmentIds` field, and `resolveMarks` no longer has a
`legacy-grade` origin. See
[`docs/verification/grade-store-unification.md`](../verification/grade-store-unification.md).

## OneRoster 1.2 CSV columns (exact)

One header row per file, RFC 4180 escaping (`"` doubled, fields containing `,`,
`"`, `\r` or `\n` quoted), CRLF line endings, trailing CRLF. `status` is always
`active`; `dateLastModified` is ISO 8601.

**`lineItems.csv`**

| Column             | Meaning                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `sourcedId`        | `lineitem-<assessmentId>`, or `lineitem-final-<offeringId>` for the synthetic weighted final grade |
| `status`           | `active`                                                                                           |
| `dateLastModified` | export timestamp (schema has no `updatedAt` on the assessment relation here)                       |
| `title`            | assessment title / `"<courseCode> final grade"`                                                    |
| `description`      | assessment description when present, else empty                                                    |
| `assignDate`       | mirrors `dueDate` — the frozen schema has no assign date                                           |
| `dueDate`          | assessment due date (ISO)                                                                          |
| `class`            | the offering id (OneRoster class)                                                                  |
| `course`           | the course id                                                                                      |
| `category`         | the configured category name, `Uncategorized` when unconfigured, or `Final Grade`                  |
| `resultValueMin`   | `0`                                                                                                |
| `resultValueMax`   | assessment `maxMarks`, or `100` for the final grade                                                |
| `scoreScale`       | `scales-<assessmentId>` / `scales-final-<offeringId>`                                              |

**`results.csv`**

| Column             | Meaning                                                          |
| ------------------ | ---------------------------------------------------------------- |
| `sourcedId`        | `result-<assessmentId>-<studentId>` / `result-final-<studentId>` |
| `status`           | `active`                                                         |
| `dateLastModified` | `Grade.updatedAt`, or the export timestamp for the final grade   |
| `lineItem`         | the line item `sourcedId`                                        |
| `student`          | the `StudentProfile` id                                          |
| `score`            | numeric result (OneRoster 1.2 numeric scale)                     |
| `scoreStatus`      | `fully graded`                                                   |
| `resultValue`      | the same value as a fixed-2-decimal string (1.1-era consumers)   |
| `comment`          | always empty                                                     |

**`scoreScales.csv`**

| Column             | Meaning                                                                       |
| ------------------ | ----------------------------------------------------------------------------- |
| `sourcedId`        | `scales-<assessmentId>` / `scales-final-<offeringId>`                         |
| `status`           | `active`                                                                      |
| `dateLastModified` | export timestamp                                                              |
| `title`            | `"<assessment title> score scale"` / `"<courseCode> final grade score scale"` |
| `type`             | `numeric`                                                                     |
| `minimum`          | `0`                                                                           |
| `maximum`          | assessment `maxMarks` / `100`                                                 |

Only the gradebook slice is emitted; `users.csv`, `classes.csv`, `courses.csv`,
`enrollments.csv`, `categories.csv`, and `academicSessions.csv` are out of scope
for this MVP.

## LTI 1.3 AGS payload shapes

Content types: score `application/vnd.ims.lis.v1.score+json`, line item
`application/vnd.ims.lis.v1.lineitem+json`, result
`application/vnd.ims.lis.v1.result+json`.

**AGS score** (`buildAgsScorePayload`, only ever from a published `Grade`):

```json
{
  "userId": "lti-platform-user-id",
  "timestamp": "2026-11-03T10:00:00.000Z",
  "scoreGiven": 16,
  "scoreMaximum": 20,
  "comment": "Assessment \"Midterm\" (lineitem-...).",
  "activityProgress": "Completed",
  "gradingProgress": "FullyGraded"
}
```

`buildAgsScorePayload` throws `LtiUnpublishedGradeError` (409) when
`publishedAt` is null and `LmsExportValidationError` (400) when the score is out
of `[0, scoreMaximum]` or the LTI user id is empty.

**AGS LineItem** (`buildAgsLineItemPayload`):

```json
{
  "scoreMaximum": 20,
  "label": "Midterm",
  "resourceId": "assessment:<assessmentId>",
  "tag": "QUIZ",
  "endDateTime": "2026-10-01T08:00:00.000Z"
}
```

**Typed client interface** (`lib/lms-export/lti-client.ts`):
`LtiAgsClient` composes `LtiAgsLineItemsService` (`createLineItem`,
`listLineItems`, `getLineItem`), `LtiAgsScoresService` (`putScore`), and
`LtiAgsResultsService` (`listResults`). A real implementation would sign a JWT
with the registration key and call these over `fetch`; the only shipped
implementation is `createDryRunLtiAgsClient()`, which records calls in memory and
synthesizes `https://lms.invalid/...` URLs.

**Configuration** (`validateLtiAgsConfig` / `requireLtiAgsConfig`) reads
`LTI_PLATFORM_ISSUER`, `LTI_CLIENT_ID`, `LTI_DEPLOYMENT_ID`, `LTI_KEY_ID`,
`LTI_PRIVATE_KEY`, `LTI_AGS_LINEITEMS_URL`. Missing variables produce a 422 whose
message names them and states that persistence needs a migration.

## Scoping evidence

- `loadOwnedOffering` requires `CourseOffering.teacherId === signed-in staff id`;
  `resolveStudentProfile` + `assertActiveEnrollment` gate the student surface.
- `tests/lms-export-service.test.ts` proves a second teacher gets 403 from the
  JSON export, the CSV export, and the AGS dry run, and sees an empty offering
  list; a student is refused the teacher surface; an unenrolled student is
  refused their own surface; and the student's CSV never contains another
  student's id.
- `tests/lms-export-route-auth.test.ts` proves anonymous → 401 and student → 403
  on the teacher routes (and teacher → 403 on the student routes) **before** the
  service is invoked.

## No network in tests (structural)

- `lib/lms-export/lti-client.ts` imports no HTTP client; the dry-run client only
  touches a `Map` and arrays.
- `tests/lms-export-lti.test.ts` stubs `globalThis.fetch` to throw and asserts it
  is never called.
- `tests/lms-export-service.test.ts` does the same around the full dry-run
  service call, so a regression that introduced a live call would fail the test.

## Tests

| File                                   | Coverage                                                                                                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/lms-export-weights.test.ts`     | Coherent/valid configs, sum-check 400s, duplicates, cross-category assignment, unknown assessments, empty categories, per-assessment weights, default config.                           |
| `tests/lms-export-final-grade.test.ts` | Published-only exclusion, category/assessment weighting, renormalisation, the "unpublished never influences" invariant.                                                                 |
| `tests/lms-export-oneroster.test.ts`   | Exact headers and column values, sourcedId schemes, CRLF, and CSV escaping of quotes/commas/newlines in free text.                                                                      |
| `tests/lms-export-lti.test.ts`         | AGS score and LineItem shapes, unpublished refusal, config validation and 422, dry-run client determinism, and the fetch-stubbed no-network property.                                   |
| `tests/lms-export-service.test.ts`     | DB-backed: published/draft resolution, the DB-level unpublished invariant, weight 400s, cross-teacher/student/unenrolled denials, OneRoster published-only output, and the AGS dry run. |
| `tests/lms-export-route-auth.test.ts`  | Route-level role enforcement, malformed-input 400s, CSV headers, and service-not-called-on-denial.                                                                                      |
| `tests/fixtures/lms-export.ts`         | Spine + roster + three assessments and published/draft modern-grade helpers.                                                                                                            |

## New files

- `lib/lms-export/` — `errors.ts`, `csv.ts`, `weights.ts`, `final-grade.ts`,
  `oneroster.ts`, `lti.ts`, `lti-client.ts`, `authz.ts`, `http.ts`, `service.ts`,
  `index.ts` (pure barrel; the DB service is imported directly by routes).
- `lib/contracts/lms-export.ts`.
- `app/api/teacher/export/route.ts`, `app/api/teacher/export/oneroster/route.ts`,
  `app/api/teacher/export/lti/route.ts`, `app/api/student/export/route.ts`,
  `app/api/student/export/oneroster/route.ts`.
- `components/teacher-lms-export.tsx`,
  `app/(dashboard)/teacher/export/page.tsx`.
- Tests listed above and `tests/fixtures/lms-export.ts`.

## Shared files touched

- `lib/contracts/index.ts` — one line: re-exports the LMS-export contract.
- `components/role-routes-menu.tsx` — one teacher nav entry ("Export") and its
  `Share2` icon import.

`prisma/schema.prisma`, `prisma/migrations/**`, `package.json`, and
`package-lock.json` are unchanged. No new dependency was added.

## Deferred items and limits (human decisions)

- **LTI registration persistence needs a migration.** There are no LTI models in
  the frozen schema, so the registration is read from environment variables and
  the LTI `userId` is supplied explicitly. Persisting a registration and a
  per-student LTI user mapping requires a schema change — deliberately not made.
- **No live LMS calls.** The typed client is the seam; a live implementation
  (OAuth2 client-credentials + JWT signing, `fetch` transport) is not shipped
  because there is no LMS and no network egress. No OIDC login, deep linking, or
  NRPS either.
- **No grade write-back.** Export is read-only; this pod never publishes or
  alters a `Grade`. Posting scores to an LMS stays gated on `publishedAt`.
- **OneRoster is the gradebook slice only**, with a single header row, numeric
  score scales only, and no `users.csv`/`classes.csv`/etc. `assignDate` mirrors
  `dueDate` because the schema has no assign date.
- **`resultValue` duplication.** `score` is the OneRoster 1.2 numeric field;
  `resultValue` carries the same value as a string for 1.1-era consumers. If a
  stricter 1.2-only consumer is the target, `resultValue` can be dropped behind a
  flag without changing the pipeline.
- **Weights are not persisted.** The schema has no settings column, so a
  configuration arrives per request and the default lives in code. A future
  migration could persist per-offering weights.
