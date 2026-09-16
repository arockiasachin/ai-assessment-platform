"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { SubtopicBreakdownValue } from "@/lib/contracts/analytics"

/**
 * The topics an assessment covers — a **token list**, not a mastery chart.
 *
 * This is decision D4's resolution made visible. `Question.subtopic` is model-generated free text
 * with no controlled vocabulary, so a per-topic *score* would be a number attributed to a label the
 * last model call invented. What the data supports is what this shows: which topics the assessment
 * covers, how many questions each has, and how many responses they have drawn.
 *
 * Two properties the presentation deliberately keeps:
 *
 * - **No normalisation.** Tags differing by case or whitespace are separate tokens. Merging them
 *   would be inventing a taxonomy inside a string heuristic, and a wrong merge is invisible while a
 *   long list is merely untidy. The note under the table says so, so a teacher with `slope` and
 *   `Slope` knows it is the data rather than a bug.
 * - **Untagged questions are counted, not named.** A hand-authored question genuinely has no tag;
 *   calling it "Uncategorised" would put a fabricated token beside real ones.
 */
export function QuizSubtopicsPanel({ breakdown }: { breakdown: SubtopicBreakdownValue | null }) {
  if (breakdown === null) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Select an assessment to see the topics its questions cover.
        </CardContent>
      </Card>
    )
  }

  const hasAnyQuestion = breakdown.tokens.length > 0 || breakdown.untagged.questionCount > 0

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Topics covered</CardTitle>
        <p className="text-xs text-muted-foreground">
          Topic tags are written by the generator, so these are the words it chose — not a fixed
          curriculum list. Tags are matched exactly, which is why near-duplicates may appear side by
          side.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {!hasAnyQuestion ? (
          <p className="text-sm text-muted-foreground">
            This assessment has no questions yet, so it covers no topics.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {breakdown.tokens.map((token) => (
                <span
                  key={token.subtopic}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs"
                >
                  <span className="font-medium">{token.subtopic}</span>
                  <span className="text-muted-foreground">
                    {token.questionCount}q · {token.responseCount} responses · {token.totalMarks}{" "}
                    marks
                  </span>
                </span>
              ))}
            </div>

            {breakdown.untagged.questionCount > 0 && (
              <p className="text-xs text-muted-foreground">
                {breakdown.untagged.questionCount} question
                {breakdown.untagged.questionCount === 1 ? "" : "s"} carry no topic tag — usually
                hand-authored, which the generator does not tag. They are counted here rather than
                given a made-up topic.
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              {breakdown.distinctTags} distinct tag
              {breakdown.distinctTags === 1 ? "" : "s"} across this assessment.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
