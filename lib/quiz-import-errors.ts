import type { ZodError } from "zod"

/**
 * Layman-friendly messages for the JSON quiz import (`POST /api/teacher/quiz`).
 *
 * This is the one contract a *teacher* fills in by hand, so a raw zod default —
 * "Too small: expected string to have >=1 characters" — is a leak, not an error
 * message. `firstIssueMessage` (`lib/contracts/common.ts`) is deliberately left
 * alone: other routes still use it and pin its behaviour, so this mapper is
 * opt-in for the import only.
 *
 * Two shapes feed the same mapper. The **minimal** shape (`courseCode`, `title`,
 * `question`, `answer`) is what the downloadable template ships; the **rich**
 * shape (`offeringId`, `quizMetadata.title`, `questionText`, `correctIndex`/
 * `correctAnswerId`) is the historical one. Both are described here so a teacher
 * reading an error always sees the same sentence-case wording.
 */

/** Error thrown by the import service when one or more problems are recoverable. */
export class QuizImportError extends Error {
  /**
   * Every problem found, in question order, not just the first. The route hands
   * the list to the client so the import card can render a checklist instead of
   * making the teacher fix one issue per upload.
   */
  readonly errors: string[]

  constructor(errors: string[]) {
    super(errors[0] ?? "The quiz import is not valid.")
    this.name = "QuizImportError"
    this.errors = errors.length > 0 ? errors : ["The quiz import is not valid."]
  }
}

/**
 * Path segment → the word a teacher would use for it. This is the map the plan
 * calls for; it is intentionally keyed by *payload key*, because that is what a
 * zod issue path names, while the value is plain English.
 */
const LABEL_BY_SEGMENT: Record<string, string> = {
  offeringId: "offering",
  courseCode: "course code",
  assessmentId: "assessment",
  title: "title",
  quizMetadata: "quiz metadata",
  dueDate: "due date",
  totalMarks: "total marks",
  questions: "questions",
  questionText: "question text",
  question: "question text",
  options: "options",
  optionId: "option id",
  text: "option text",
  correctIndex: "correct answer index",
  correctAnswerId: "correct answer id",
  answer: "answer",
  marks: "marks",
}

/** The English label for a path segment, falling back to the raw key. */
export function segmentLabel(segment: string): string {
  return LABEL_BY_SEGMENT[segment] ?? segment
}

/** `A`, `B`, … for an option position (0-based), matching the contract's default ids. */
export function optionLetter(index: number): string {
  return String.fromCharCode(65 + index)
}

/** `A–D` for a question with `count` options; an en dash, matching the copy. */
export function optionLetters(count: number): string {
  if (count <= 1) return optionLetter(0)
  return `${optionLetter(0)}–${optionLetter(count - 1)}`
}

/** The plan's example wording, shared by the normaliser and the mapper. */
export function answerLetterOutOfRange(
  questionNumber: number,
  letter: string,
  optionCount: number,
): string {
  return `Question ${questionNumber}: the answer letter ${letter} does not match any of its ${optionCount} options (${optionLetters(optionCount)}).`
}

type ImportIssue = ZodError["issues"][number]

/** Whether an issue path points inside one of the `questions`. */
function questionContext(path: readonly PropertyKey[]) {
  if (path[0] !== "questions" || typeof path[1] !== "number") return null
  const number = path[1] + 1
  const field = typeof path[2] === "string" ? path[2] : null
  // A fourth segment is an option position, e.g. questions[0].options[1].
  const optionIndex = typeof path[3] === "number" ? path[3] : null
  return { number, field, optionIndex }
}

/**
 * One issue → one sentence. Known (path, code) pairs get hand-written copy;
 * anything else falls back to zod's own message, which at that point is either
 * a message this codebase wrote or a genuinely unexpected shape.
 */
function describeIssue(issue: ImportIssue): string {
  const path = issue.path
  const question = questionContext(path)

  if (question) {
    const { number, field, optionIndex } = question

    if (field === "questionText" || field === "question") {
      return `Question ${number}: the question text is required.`
    }
    if (field === "options") {
      if (optionIndex !== null) {
        return `Question ${number}: option ${optionLetter(optionIndex)} needs some text.`
      }
      return `Question ${number}: at least two options are required.`
    }
    if (field === "answer") {
      return `Question ${number}: the answer must be a letter (A), a number, or the exact option text.`
    }
    if (field === "correctIndex") {
      return `Question ${number}: correctIndex must be a whole number.`
    }
    if (field === "correctAnswerId") {
      return `Question ${number}: correctAnswerId must be text.`
    }
    if (field === "marks") {
      return `Question ${number}: marks must be a positive number.`
    }
    return `Question ${number}: ${issue.message}`
  }

  const segment = typeof path[0] === "string" ? path[0] : ""
  if (segment === "title" || (segment === "quizMetadata" && path[1] === "title")) {
    return "Give the quiz a title."
  }
  if (segment === "questions") {
    return "Add at least one question."
  }
  if (segment === "quizMetadata") {
    return "Check the quiz metadata."
  }
  if (segment) {
    return `The ${segmentLabel(segment)} is not valid — check it and try again.`
  }
  return issue.message
}

/** Deduplicate while preserving order, so repeated per-option issues collapse. */
function unique(messages: string[]): string[] {
  return [...new Set(messages)]
}

/**
 * Turn a failed import `safeParse` into the list of sentences a teacher reads.
 * Always non-empty: a `ZodError` with no issues is itself a bug worth surfacing.
 */
export function mapQuizImportIssues(error: ZodError): string[] {
  const messages = unique(error.issues.map(describeIssue))
  return messages.length > 0 ? messages : ["The quiz import is not valid."]
}
