import { expect } from "vitest"

/**
 * Capture a refused service call so two refusals can be compared.
 *
 * The TN-69 alignment requires that an object a caller may not see and an object
 * that does not exist be indistinguishable: same status and byte-identical body.
 * A test that pins a single status cannot show that, so this returns the thrown
 * error's `status` and `message`, and `expectIndistinguishable` asserts the two
 * match. That is strictly stronger than asserting one specific code.
 */
export async function captureRefusal(
  promise: Promise<unknown>,
): Promise<{ status: number; message: string }> {
  try {
    await promise
  } catch (error) {
    const thrown = error as { status?: unknown; message?: unknown }
    if (typeof thrown.status !== "number") throw error
    return {
      status: thrown.status,
      message: typeof thrown.message === "string" ? thrown.message : "",
    }
  }
  throw new Error("Expected the call to be refused, but it resolved.")
}

/** A foreign id and a missing id must answer identically (TN-69). */
export function expectIndistinguishable(
  foreign: { status: number; message: string },
  missing: { status: number; message: string },
): void {
  expect(foreign).toEqual(missing)
}
