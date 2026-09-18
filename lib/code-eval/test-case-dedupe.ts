/**
 * De-duplication for generated test-case drafts (TN-57).
 *
 * The generate path appends new `TestCase` rows at the next order. When a teacher
 * presses *Generate* twice on the same task — the model often returns the same
 * cases for the same prompt — the second run wrote the same three cases again at
 * orders 4-6, and publishing left the task with seven cases and a doubled point
 * total.
 *
 * The prompt already lists the existing test *names* to discourage this, but a
 * prompt is a request, not a guarantee. This is the guarantee: a draft whose
 * fingerprint matches a case already on the task, or an earlier draft in the same
 * run, is dropped before it can be persisted.
 *
 * The fingerprint is the case's content, not just its name. Two cases with the
 * same name but different expected output are a genuine edit and must survive;
 * an exact duplicate is never intentional.
 */

/** The fields that identify a test case's content. */
export type TestCaseFingerprintInput = {
  category: string
  name: string
  input: string | null
  expectedOutput: string | null
}

/**
 * A stable content key for a test case.
 *
 * `\u0000` as the separator because it cannot appear in the fields themselves, so
 * `("a", "b")` and `("ab", "")` cannot collide.
 */
export function testCaseFingerprint(testCase: TestCaseFingerprintInput): string {
  return [testCase.category, testCase.name, testCase.input ?? "", testCase.expectedOutput ?? ""]
    .map((part) => part.trim())
    .join("\u0000")
}

/**
 * The drafts worth persisting: those not already on the task and not repeated
 * within this run, in their original order.
 */
export function withoutDuplicateTestCases<T extends TestCaseFingerprintInput>(
  drafts: readonly T[],
  existing: readonly TestCaseFingerprintInput[],
): T[] {
  const seen = new Set(existing.map(testCaseFingerprint))
  const kept: T[] = []
  for (const draft of drafts) {
    const key = testCaseFingerprint(draft)
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(draft)
  }
  return kept
}
