import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

import { loadOwnedAssessment } from "./authz"

/**
 * The subtopics an assessment actually covers, as a **token list**.
 *
 * ## Why this is a list and not a mastery chart
 *
 * `Question.subtopic` is **model-generated free text**. The vocabulary is chosen by
 * the model per request — when a teacher supplies no tags the prompt says, verbatim,
 * *"The teacher did not specify subtopics; choose 2-4 coherent subtopics yourself."*
 * (`lib/quiz-generation/prompt.ts:61-64`) — and the only constraint is
 * `trim/min(1)/max(200)` (`lib/quiz-generation/parsing.ts:44`). There is no enum, no
 * canonical list, and no reuse across requests; the column is additionally nullable,
 * so hand-authored questions carry none at all.
 *
 * A *mastery score* per tag would therefore be a number attributed to a label the last
 * model call invented, and grouping by exact string yields a long tail of
 * near-duplicates (`slope` / `Slope` / `gradient & intercept`). So this module answers
 * the question the data can support — **"which topics does this assessment cover, and
 * how much of it is each one?"** — and deliberately does not answer "how well did the
 * class do on each", which needs a controlled vocabulary that does not exist yet.
 *
 * ## What it does not do
 *
 * - **No normalisation, no fuzzy matching, no merging.** Two tags that differ by a
 *   character are two tokens, because silently merging them would invent a taxonomy.
 *   If a tag list needs consolidating, that is a product decision about a controlled
 *   vocabulary, not a string-matching heuristic here.
 * - **No mastery number, no threshold, no `null`-because-small-sample.** Every count
 *   below is a fact about rows that exist.
 * - **Untagged questions are reported separately, not as a topic.** Giving them a name
 *   like "Uncategorised" would put a fabricated token in the list next to real ones.
 */

export type QuestionTagInput = {
  id: string
  /** `null` for a hand-authored question the generator never tagged. */
  subtopic: string | null
  /** Available marks, used for the token's weight. */
  points: number
  /**
   * Finalised responses received across the question's options.
   *
   * A count of *responses*, not students: one response per student per question on a
   * finalised attempt, so the two coincide in practice, and counting rows is the
   * honest reading of what is stored.
   */
  responseCount: number
}

export type SubtopicToken = {
  /** The tag **exactly as it was written**. Never trimmed, folded or merged. */
  subtopic: string
  /** Questions on this assessment carrying the tag. */
  questionCount: number
  /** Responses those questions received, across finalised attempts. */
  responseCount: number
  /** Total marks available across those questions. */
  totalMarks: number
}

export type SubtopicBreakdown = {
  tokens: SubtopicToken[]
  /** Questions with no tag. Counted, but never presented as one of the tokens. */
  untagged: { questionCount: number; responseCount: number }
  /** The number of distinct tags — the honest figure for a "N topics" badge. */
  distinctTags: number
}

/**
 * Pure grouping, so the shape of the list has a test that needs no database.
 *
 * Ordered by `questionCount` descending, then by tag ascending. The tie-break is not
 * cosmetic: without it the order of two equally-sized topics would depend on the row
 * order `findMany` happened to return, which makes the page flicker between renders
 * for no reason a reader could perceive.
 */
export function groupSubtopicTokens(questions: readonly QuestionTagInput[]): SubtopicBreakdown {
  const byTag = new Map<string, SubtopicToken>()
  let untaggedQuestionCount = 0
  let untaggedResponseCount = 0

  for (const question of questions) {
    if (question.subtopic === null || question.subtopic.trim() === "") {
      untaggedQuestionCount += 1
      untaggedResponseCount += question.responseCount
      continue
    }

    // Exact string, as a key. No `toLowerCase`, no collapse of internal whitespace.
    const existing = byTag.get(question.subtopic)
    if (existing) {
      existing.questionCount += 1
      existing.responseCount += question.responseCount
      existing.totalMarks += question.points
    } else {
      byTag.set(question.subtopic, {
        subtopic: question.subtopic,
        questionCount: 1,
        responseCount: question.responseCount,
        totalMarks: question.points,
      })
    }
  }

  const tokens = [...byTag.values()].sort(
    (a, b) => b.questionCount - a.questionCount || a.subtopic.localeCompare(b.subtopic),
  )

  return {
    tokens,
    untagged: { questionCount: untaggedQuestionCount, responseCount: untaggedResponseCount },
    distinctTags: tokens.length,
  }
}

/**
 * The subtopic tokens for one assessment, from its questions and finalised responses.
 *
 * Scoped by `loadOwnedAssessment`, so a teacher can only read an assessment they
 * created or whose offering they teach — the same rule the item-analysis reader uses.
 *
 * Only **finalised** attempts contribute response counts, matching every other
 * analytics reader: counting an in-progress sitting's answers would report work the
 * student has not submitted.
 */
export async function listAssessmentSubtopics(
  user: AuthUser,
  assessmentId: string,
): Promise<SubtopicBreakdown & { assessmentId: string; assessmentTitle: string }> {
  const assessment = await loadOwnedAssessment(user, assessmentId)

  const questions = await prisma.question.findMany({
    where: { assessmentId: assessment.id },
    orderBy: { order: "asc" },
    select: {
      id: true,
      subtopic: true,
      points: true,
      options: { select: { id: true } },
    },
  })

  // One query for the response counts, grouped by question, rather than a query per
  // question. Restricted to finalised attempts so a sitting in progress contributes
  // nothing.
  const grouped = await prisma.quizResponse.groupBy({
    by: ["questionId"],
    where: {
      question: { assessmentId: assessment.id },
      attempt: { status: { in: ["SUBMITTED", "GRADED"] } },
    },
    _count: { _all: true },
  })

  const responsesByQuestion = new Map(grouped.map((row) => [row.questionId, row._count._all]))

  return {
    assessmentId: assessment.id,
    assessmentTitle: assessment.title,
    ...groupSubtopicTokens(
      questions.map((question) => ({
        id: question.id,
        subtopic: question.subtopic,
        // Prisma `Decimal` does not survive a Server -> Client boundary, so it
        // becomes a number here rather than being carried to the component.
        points: Number(question.points),
        responseCount: responsesByQuestion.get(question.id) ?? 0,
      })),
    ),
  }
}

/**
 * The same breakdown for **many assessments**, in two queries rather than two per assessment.
 *
 * The page that needs this lists every assessment a teacher owns and shows the panel for the
 * selected one, so a per-assessment reader would be an N+1 on page load. Authorisation is the
 * caller's: this takes ids and returns what it finds, so a route must have established that the
 * ids belong to the caller before calling it. `listAssessmentSubtopics` above is the
 * authz-checking variant for a single assessment.
 */
export async function listSubtopicBreakdowns(
  assessmentIds: readonly string[],
): Promise<Map<string, SubtopicBreakdown & { assessmentTitle: string }>> {
  if (assessmentIds.length === 0) return new Map()

  const [questions, grouped] = await Promise.all([
    prisma.question.findMany({
      where: { assessmentId: { in: [...assessmentIds] } },
      orderBy: [{ assessmentId: "asc" }, { order: "asc" }],
      select: {
        id: true,
        assessmentId: true,
        subtopic: true,
        points: true,
        assessment: { select: { title: true } },
      },
    }),
    // Finalised attempts only, matching every other analytics read — a sitting in progress
    // contributes nothing.
    prisma.quizResponse.groupBy({
      by: ["questionId"],
      where: {
        question: { assessmentId: { in: [...assessmentIds] } },
        attempt: { status: { in: ["SUBMITTED", "GRADED"] } },
      },
      _count: { _all: true },
    }),
  ])

  const responsesByQuestion = new Map(grouped.map((row) => [row.questionId, row._count._all]))

  const byAssessment = new Map<string, QuestionTagInput[]>()
  const titles = new Map<string, string>()
  for (const question of questions) {
    titles.set(question.assessmentId, question.assessment.title)
    const list = byAssessment.get(question.assessmentId) ?? []
    list.push({
      id: question.id,
      subtopic: question.subtopic,
      points: Number(question.points),
      responseCount: responsesByQuestion.get(question.id) ?? 0,
    })
    byAssessment.set(question.assessmentId, list)
  }

  const result = new Map<string, SubtopicBreakdown & { assessmentTitle: string }>()
  // **Every requested id gets an entry**, including one with no questions at all: an entry with
  // zero tokens is how the caller distinguishes "this assessment has no questions" from "I did not
  // ask about it". Omitting the empty ones looked tidier and was wrong — the page defaults to the
  // *first* assessment, and if that one has no questions yet the panel silently fell back to its
  // "select an assessment" state while an assessment was in fact selected.
  for (const assessmentId of assessmentIds) {
    const rows = byAssessment.get(assessmentId) ?? []
    result.set(assessmentId, {
      ...groupSubtopicTokens(rows),
      assessmentTitle: titles.get(assessmentId) ?? "",
    })
  }
  return result
}
