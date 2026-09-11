/**
 * Presence-aware partial updates.
 *
 * Two High-severity data-loss bugs in this codebase shared one root cause: a
 * route that treated an **omitted** field identically to an explicit value and
 * then wrote every column unconditionally.
 *
 * 1. `PUT /api/teacher/offerings/[offeringId]` collapsed an omitted schedule
 *    date to `null` and nulled four columns (`docs/verification/bugfix-run-2.md`).
 * 2. `PUT /api/teacher/assessments/submissions` read an omitted `score` as
 *    `score: null` and always wrote `status`/`gradedAt`/`gradedById`/`feedback`,
 *    reverting a `GRADED` submission to `SUBMITTED` and wiping the grade
 *    (`docs/verification/bugfix-run-3.md`).
 *
 * The correct form is the spread guard duplicated across the services:
 *
 * ```ts
 * data: {
 *   ...(request.name !== undefined ? { name: request.name } : {}),
 * }
 * ```
 *
 * {@link partialUpdate} centralises it. Given a parsed request and an
 * allow-list of updatable columns it returns a Prisma `data` object that
 * contains **only the keys the client actually sent**, with three distinct
 * states:
 *
 * - **omitted** (`undefined`, or the key absent) → the column is not touched;
 * - **explicit `null`** → the column is cleared (where the column is nullable);
 * - **present value** → the column is set (optionally through a transform).
 *
 * See `docs/engineering/partial-update-guide.md`.
 */

/** The value a request carries for a field once "omitted" (`undefined`) is removed. */
export type PresentValue<T> = Exclude<T, undefined>

/**
 * The allow-list: every key that may reach the Prisma `data` object.
 *
 * Each entry is either `true` (copy the present value unchanged) or a transform
 * that validates/normalises it. A transform receives the *present* value (never
 * `undefined`) and may return `undefined` to omit the column from the write.
 */
export type PartialUpdateSpec<Request extends object> = {
  readonly [K in keyof Request]?: true | ((value: PresentValue<Request[K]>) => unknown)
}

/**
 * The resulting Prisma `data` object: one optional key per allow-listed field,
 * typed from the request value (identity) or the transform's return type.
 */
export type PartialUpdateData<Request extends object, Spec extends PartialUpdateSpec<Request>> = {
  [K in keyof Spec]?: Spec[K] extends (value: never) => infer Out
    ? Out
    : K extends keyof Request
      ? PresentValue<Request[K]>
      : never
}

/**
 * A present value failed validation in a field transform. Routes should map
 * this to a `400`, matching the contract-boundary error they return for the
 * same class of input.
 */
export class PartialUpdateError extends Error {
  readonly field: string

  constructor(field: string, message: string) {
    super(message)
    this.name = "PartialUpdateError"
    this.field = field
  }
}

/**
 * Build a Prisma `data` object containing only the allow-listed fields the
 * request actually sent.
 *
 * Keys of `request` that are absent from `spec` are ignored, never copied. That
 * is deliberate: callers routinely pass request objects carrying non-column
 * fields (`addStudentIds`, `removeStudentIds`, `studentLimit`, `offeringId`)
 * alongside column fields, and the allow-list is the guarantee that an
 * unexpected key can never reach the write.
 */
export function partialUpdate<
  Request extends object,
  const Spec extends PartialUpdateSpec<Request>,
>(request: Request, spec: Spec): PartialUpdateData<Request, Spec> {
  const source = request as Record<string, unknown>
  const fields = spec as Record<string, unknown>
  const data: Record<string, unknown> = {}

  for (const key of Object.keys(fields)) {
    const value = source[key]
    // Omitted (including an explicit `undefined`) means "do not touch".
    if (value === undefined) continue

    const resolver = fields[key]
    if (resolver === true) {
      data[key] = value
      continue
    }
    if (typeof resolver !== "function") {
      throw new PartialUpdateError(
        key,
        `Field "${key}" is not updatable: its spec entry must be true or a transform.`,
      )
    }

    let next: unknown
    try {
      next = (resolver as (input: unknown) => unknown)(value)
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error"
      throw new PartialUpdateError(key, `Invalid value for "${key}": ${reason}`)
    }
    // A transform may opt a value out entirely (treated as omitted).
    if (next === undefined) continue
    data[key] = next
  }

  return data as PartialUpdateData<Request, Spec>
}
