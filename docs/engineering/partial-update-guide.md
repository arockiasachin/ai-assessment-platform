# Partial updates: the data-loss bug class and its guard

Audience: anyone writing a route or service that updates an existing database row
from client input.

## The bug class

A **partial updater** is any endpoint that lets the client send _some_ of a
row's fields. The correct behaviour has three distinct states per field:

| Client sent      | Meaning        | Column behaviour |
| ---------------- | -------------- | ---------------- |
| key absent       | omitted        | leave untouched  |
| `field: null`    | explicit clear | set to `NULL`    |
| `field: <value>` | present        | set to `<value>` |

The bug class is treating the first state like the second, then writing every
column unconditionally. It is **data loss**: a request that never mentioned a
column silently destroys it.

This codebase shipped it twice, both High severity:

1. **run-2 BUG-1** — `PUT /api/teacher/offerings/[offeringId]`. A helper
   `parseDateOrNull` collapsed both "omitted" and "invalid" into `null`, and the
   route wrote all four schedule columns unconditionally. `{ "studentLimit": 30 }`
   nulled `registrationOpenAt`, `registrationCloseAt`, `startsOn`, and `endsOn`.
   See [`docs/verification/bugfix-run-2.md`](../verification/bugfix-run-2.md).
2. **run-3 BUG-1** — `PUT /api/teacher/assessments/submissions`. An omitted
   `score` was read as `score: null`, and `status`/`gradedAt`/`gradedById`/
   `feedback` were always written. A feedback-only request reverted a `GRADED`
   submission to `SUBMITTED` and wiped the grade. See
   [`docs/verification/bugfix-run-3.md`](../verification/bugfix-run-3.md).

The same shape hides in plain sight. `x ?? null` and
`x === undefined ? null : x` both turn "omitted" into "clear".

## The correct pattern

`lib/partial-update.ts` centralises it. Instead of the hand-rolled spread guard

```ts
data: {
  ...(request.name !== undefined ? { name: request.name } : {}),
  ...(request.projectTitle !== undefined ? { projectTitle: request.projectTitle } : {}),
}
```

write the allow-list once:

```ts
data: partialUpdate(request, {
  name: true,
  projectTitle: true,
  status: true,
})
```

`true` copies a present value unchanged. A function validates/normalises it:

```ts
data: partialUpdate(request, {
  title: true,
  description: true,
  weight: true,
  dueDate: (value) => (value === null ? null : new Date(value)),
  status: true,
})
```

### API

```ts
export function partialUpdate<
  Request extends object,
  const Spec extends PartialUpdateSpec<Request>,
>(request: Request, spec: Spec): PartialUpdateData<Request, Spec>
```

- **`request`** — a parsed request object. Its optional fields must be typed
  `T | undefined`, and nullable fields `T | null | undefined` (zod's
  `z.infer` of `.optional()` / `.nullable().optional()` gives exactly this).
- **`spec`** — the allow-list. Keys must be keys of `request`. Values are `true`
  or `(presentValue) => output`. The transform never receives `undefined`;
  returning `undefined` omits the column from the write.
- **returns** — a Prisma `data` object containing only the fields the request
  actually sent. Keys are optional and typed from the request value (identity)
  or the transform's return type, so the result drops straight into
  `prisma.model.update({ data })`.

Semantics:

- **Omitted** (`undefined`, or the key absent): the key is not in the result, so
  Prisma does not touch the column.
- **Explicit `null`**: the key is present with `null`, so the column is cleared
  (only valid for nullable columns).
- **Present value**: copied, or passed through the transform.
- **Allow-list**: keys of `request` that are not in `spec` are **ignored, never
  copied**. This is the guarantee that an unexpected key (a roster field, an
  `offeringId`, a typo) cannot reach the write. Ignoring rather than rejecting is
  deliberate: callers routinely pass parsed request objects that carry
  non-column fields (`addStudentIds`, `removeStudentIds`, `studentLimit`)
  alongside column fields, and rejecting would force every caller to pre-strip —
  exactly the hand-rolled duplication this helper exists to remove.
- **Invalid present value**: a transform throws `PartialUpdateError` naming the
  field and the reason. Routes should map it to a `400`; the write never
  happens. (`PUT /api/teacher/offerings/[offeringId]` does this.)

### Where it is used

| Entry point                               | File                                              |
| ----------------------------------------- | ------------------------------------------------- |
| `updateGroupForTeacher`                   | `lib/groups/service.ts`                           |
| `updateMilestoneForTeacher`               | `lib/groups/records.ts`                           |
| `updateTestCaseForTeacher`                | `lib/code-eval/tasks.ts`                          |
| `editGeneratedQuestionForTeacher`         | `lib/quiz-generation/review-service.ts`           |
| `PUT /api/teacher/offerings/[offeringId]` | `app/api/teacher/offerings/[offeringId]/route.ts` |

### Call sites deliberately left un-migrated

- **`recomputeAdjustmentFactorsForGroup`** (`lib/groups/student-service.ts`).
  Writes computed adjustment factors, not request input. Kept as a deterministic
  full overwrite; the values are hoisted out of the payload only so the guard's
  `.update` payload check does not flag a computed `?? null`.
- **Upsert `update` branches** — `upsertCodeTaskForTeacher`
  (`lib/code-eval/tasks.ts`), `saveLtiRegistration` (`lib/lms-export/registrations.ts`),
  `upsertRubricForTeacher` (`lib/rubric-grading/rubric-service.ts`), and the
  peer-evaluation upsert (`lib/groups/student-service.ts`). These are
  **create-or-replace** endpoints: the client is expected to send the whole
  resource, and normalising an optional input to `null` is intended replacement
  semantics, not a partial update. Migrating them would change behaviour.
- **`toFormationProfileJson` / `toFormationStudent`**
  (`lib/groups/formation-profile.ts`) and `saveFormationProfilesForTeacher`
  (`lib/groups/service.ts`). These shape a **JSON column value**
  (`StudentProfile.formationProfile`), not a Prisma `data` object, and
  `availability` has no explicit-`null` state (`string[] | undefined`), so the
  omitted-vs-null distinction does not apply.
- **`lib/lms-export/lti.ts`** and **`lib/llm/providers/ollama.ts`**. Build an
  outbound payload/request body, not a database write.
- **`PUT /api/teacher/assessments/submissions`**. Kept on its explicit
  `Object.prototype.hasOwnProperty` guards: it has no zod contract (the body is
  ad hoc) and `status`/`gradedAt`/`gradedById` are **derived** from `score`
  rather than copied from the request, so the helper's copy semantics do not
  fit cleanly. Its dedicated regression test
  (`tests/teacher-submissions-partial-update.test.ts`) still pins the behaviour.

## The guard

Two layers enforce the invariant. Both must pass in `npm run verify`.

### 1. Static: the `local/no-unguarded-partial-write` ESLint rule

Defined plugin-free in `eslint-rules/no-unguarded-partial-write.mjs` and wired in
`eslint.config.mjs` over `app/**/*.ts` and `lib/**/*.ts`. `npm run lint` (part of
`npm run verify`, and therefore CI) fails on a reintroduction.

It inspects the `data` payload of a Prisma `.update(...)` / `.updateMany(...)`
call and reports:

- `x ?? null` — collapses `undefined` into an explicit clear;
- a conditional that conflates `undefined` with `null` and yields `null` in one
  branch (`x === undefined ? null : x`, `x == null ? null : x`,
  `x !== undefined ? x : null`, …). Strict `x === null ? null : x` is **not**
  flagged: `null` is an explicit value, not a conflated one;
- `data: <raw request object>` where the identifier is `body`, `request`, `req`,
  `rawBody`, `parsedBody`, or `payload` — writing the whole object straight
  through is the same class of mistake.

**Why an ESLint rule?** It is the only mechanism that covers _new, unenumerated_
code automatically. A contract test only covers entry points someone remembered
to register; a lint rule runs over every file on every CI run. It needs no
dependency (the rule is a plain module), and it is high-signal enough to run at
`error` on the whole repo (zero false positives at the time of writing).

### 2. Behavioral: the contract test

`tests/partial-update-guard.test.ts` enumerates every service entry point
migrated onto `partialUpdate()` and, for each, sets a **single** field (and, for
nullable fields, an explicit `null`) and asserts that **every other column is
byte-for-byte unchanged**. It also self-tests the ESLint rule by linting fixture
source, so the rule cannot silently stop matching.

The two route-level bugs additionally have dedicated regression tests:
`tests/offering-partial-update.test.ts` and
`tests/teacher-submissions-partial-update.test.ts`.

## What the guard does NOT catch

Be honest about the gaps; a clean lint run is not a proof of correctness.

- **The rule is syntactic, not type-aware.** It does not know a value came from
  a request body unless the anti-pattern or the raw-payload identifier is
  present.
- **Payloads built elsewhere.** A collapse hoisted into a local
  (`const score = raw === undefined ? null : raw`) or produced by a builder
  function, then passed as `data: { score }`, is not seen. The same is true when
  `data` is a variable identifier assigned field-by-field
  (`const data = {}; data.x = …; tx.model.update({ data })`).
- **`upsert` is not checked.** Its `update` branch is create-or-replace
  semantics (see above), so `x ?? null` there is intentional and the rule would
  be noise.
- **`create` / `createMany` are not checked.** There is no prior value to
  destroy.
- **Only `.update` / `.updateMany` object literals** in files matching
  `app/**/*.ts` / `lib/**/*.ts`. Other write shapes (raw SQL, a Prisma extension)
  are outside its reach.
- **The contract test only knows its registry.** A new partial-update route is
  not covered until it is added to `CASES`; the lint rule is the automatic
  backstop in the meantime.
- **It cannot detect a _missing_ field.** It catches "omitted became null". An
  update that is _too narrow_ (never writes a field it should) is a different bug.

## Adding a new partial updater

1. Give the field a zod contract with `.optional()` / `.nullable().optional()`.
2. Build the payload with `partialUpdate(request, { …allow-list })`. Use a
   transform for dates/numbers so a malformed present value throws
   `PartialUpdateError` instead of writing garbage; map it to a `400`.
3. Add a case to `CASES` in `tests/partial-update-guard.test.ts`.
4. Run `npm run verify` and `npm test`.

```ts
import { partialUpdate } from "@/lib/partial-update"

await tx.widget.update({
  where: { id: widgetId },
  data: partialUpdate(request, {
    name: true,
    description: true,
    dueDate: (value) => (value === null ? null : new Date(value)),
  }),
})
```
