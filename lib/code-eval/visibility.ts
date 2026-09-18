import type { TestResult } from "@/lib/contracts/code-eval"

/**
 * The one place that decides what a student may see of a test case.
 *
 * `TestCase.isHidden` used to exist without ever being read, while the teacher UI
 * claimed "Hidden from students (only pass/fail is shown)". This makes that claim
 * true, in the serializer rather than in the renderer, so no component can
 * forget it: a hidden case reaches a student as **pass/fail plus a name and
 * category**, and its input, expected output, observed output and captured
 * streams are nulled.
 *
 * The set of cases is supplied by the caller from the **current** `TestCase`
 * rows, not from the persisted evidence. That direction matters: un-hiding a case
 * should reveal it on the next read without a migration, and hiding a case must
 * take effect even for a run whose stored evidence recorded it as visible.
 *
 * A result whose case can no longer be found (deleted after the run) is treated
 * as hidden. The case no longer exists to declare itself visible, and revealing
 * detail on an assumption is the failure mode this module exists to prevent.
 */

export type VisibilityTestCase = {
  id: string
  input: string | null
  expectedOutput: string | null
  isHidden: boolean
}

export function applyStudentVisibility(
  results: readonly TestResult[],
  testCases: readonly VisibilityTestCase[],
): TestResult[] {
  const byId = new Map(testCases.map((testCase) => [testCase.id, testCase]))

  return results.map((result) => {
    const testCase = byId.get(result.testCaseId)
    if (!testCase || testCase.isHidden) {
      return {
        ...result,
        description: null,
        isHidden: true,
        input: null,
        expectedOutput: null,
        actualOutput: null,
        stdout: "",
        stderr: "",
        message: "",
      }
    }
    return {
      ...result,
      isHidden: false,
      input: testCase.input,
      expectedOutput: testCase.expectedOutput,
      // The case's captured stdout is what an input/output comparison read.
      actualOutput: result.stdout,
    }
  })
}
