import type { Metadata } from "next"
import { CheckCheck, Library, Sparkles } from "lucide-react"

import { findNavItem } from "@/components/shell/nav-config"
import { PageHeader } from "@/components/shell/page-header"
import { Button } from "@/components/ui/button"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { PageTabPanel, PageTabs } from "@/components/ui/page-tabs"
import { SectionCard } from "@/components/ui/section-card"
import { StatusPill } from "@/components/ui/status-pill"
import {
  MOCK_DRAFT_QUESTIONS,
  MOCK_ITEM_ANALYSIS,
  MOCK_MATERIALS,
  MOCK_QUIZ_QUESTIONS,
  MOCK_TOPIC_MASTERY,
  formatPercent,
  type ItemAnalysis,
  type MaterialView,
  type QuizQuestion,
} from "@/lib/mock"
import { TeacherProgress } from "../_lib/teacher-progress"

export const metadata: Metadata = {
  title: "Quiz AI",
}

const HREF = "/mockup/teacher/quiz-ai"

const PUBLISHED_QUESTIONS = MOCK_QUIZ_QUESTIONS.filter((question) => question.state === "published")

const QUESTION_TYPE_LABEL: Record<QuizQuestion["type"], string> = {
  MULTIPLE_CHOICE: "Multiple choice",
  MULTIPLE_SELECT: "Multiple select",
  TRUE_FALSE: "True / false",
  SHORT_ANSWER: "Short answer",
}

/** The first indexed material that covers a topic — the grounding source. */
function materialForTopic(topic: string): MaterialView | undefined {
  return MOCK_MATERIALS.find((material) => material.topic === topic && material.indexed)
}

/**
 * Quiz AI — the authoring surface for generated questions.
 *
 * This is the teacher view, so answer keys and distractor rationales are shown
 * on purpose: the reviewer has to see what the model produced before a question
 * is published. A generated question stays a draft until a teacher publishes it.
 */
export default function TeacherQuizAiPage() {
  const publishedColumns: Column<QuizQuestion>[] = [
    {
      id: "question",
      header: "Question",
      cell: (row) => (
        <div className="min-w-0">
          <p className="max-w-[26rem] truncate font-medium" title={row.prompt}>
            {row.order}. {row.prompt}
          </p>
          <p className="text-xs text-muted-foreground">
            {QUESTION_TYPE_LABEL[row.type]} · {row.topic}
          </p>
        </div>
      ),
    },
    {
      id: "points",
      header: "Points",
      align: "right",
      cell: (row) => <span className="font-mono tabular-nums">{row.points}</span>,
    },
    {
      id: "difficulty",
      header: "Difficulty",
      align: "right",
      hideBelow: "sm",
      cell: (row) => (
        <span className="font-mono tabular-nums">
          {row.difficulty === null ? "—" : formatPercent(row.difficulty * 100)}
        </span>
      ),
    },
    {
      id: "answer",
      header: "Answer key",
      cell: (row) => (
        <span className="font-mono text-xs">
          {row.options
            .filter((option) => option.isCorrect)
            .map((option) => option.label)
            .join(", ")}
        </span>
      ),
    },
    {
      id: "state",
      header: "State",
      cell: (row) => <StatusPill status={row.state} dot />,
    },
  ]

  const analysisColumns: Column<ItemAnalysis>[] = [
    {
      id: "question",
      header: "Question",
      cell: (row) => (
        <div className="min-w-0">
          <p className="max-w-[24rem] truncate font-medium" title={row.prompt}>
            {row.order}. {row.prompt}
          </p>
          <p className="text-xs text-muted-foreground">{row.topic}</p>
        </div>
      ),
    },
    {
      id: "responses",
      header: "Responses",
      align: "right",
      cell: (row) => <span className="font-mono tabular-nums">{row.responses}</span>,
    },
    {
      id: "facility",
      header: "Correct",
      align: "right",
      cell: (row) => (
        <span className="font-mono tabular-nums">
          {formatPercent(row.percentCorrect === null ? null : row.percentCorrect * 100)}
        </span>
      ),
    },
    {
      id: "discrimination",
      header: "Discrimination",
      align: "right",
      hideBelow: "sm",
      cell: (row) => (
        <span className="font-mono tabular-nums">
          {row.discrimination === null ? "—" : row.discrimination.toFixed(2)}
        </span>
      ),
    },
    {
      id: "flag",
      header: "Quality",
      cell: (row) => <StatusPill status={row.flag} dot />,
    },
    {
      id: "note",
      header: "Reviewer note",
      hideBelow: "lg",
      cell: (row) => (
        <span className="block max-w-[24rem] whitespace-normal text-xs text-muted-foreground">
          {row.note}
        </span>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        eyebrow="Question generation"
        title="Quiz AI"
        description={findNavItem(HREF)?.item.description}
        breadcrumbs={[
          { label: "Mockup index", href: "/mockup" },
          { label: "Teacher workspace", href: "/mockup/teacher" },
          { label: "Quiz AI" },
        ]}
        actions={
          <Button>
            <Sparkles className="size-4" aria-hidden="true" />
            Generate questions
          </Button>
        }
      />

      <PageTabs
        className="[&_[data-slot=tabs-list]]:overflow-x-auto"
        items={[
          { value: "drafts", label: "Drafts", count: MOCK_DRAFT_QUESTIONS.length },
          { value: "published", label: "Published", count: PUBLISHED_QUESTIONS.length },
          { value: "analysis", label: "Item analysis", count: MOCK_ITEM_ANALYSIS.length },
          { value: "topics", label: "Topics", count: MOCK_TOPIC_MASTERY.length },
        ]}
        label="Quiz authoring sections"
      >
        <PageTabPanel value="drafts" className="space-y-6">
          <SectionCard
            title="Generation source"
            description="Generated questions are grounded in indexed course material. Anything not indexed cannot be retrieved from."
            action={<Library className="size-4 text-muted-foreground" aria-hidden="true" />}
          >
            <ul className="space-y-3">
              {MOCK_MATERIALS.map((material) => (
                <li
                  key={material.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3 last:border-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium" title={material.title}>
                      {material.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {material.topic} · {material.chunks} retrieval chunks
                    </p>
                  </div>
                  {material.indexed ? (
                    <StatusPill status="completed" label="Indexed" dot />
                  ) : (
                    <StatusPill status="pending" label="Not indexed" dot />
                  )}
                </li>
              ))}
            </ul>
          </SectionCard>

          {MOCK_DRAFT_QUESTIONS.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title="No draft questions"
              description="Generate a set from the course material, then review and publish the ones you want."
              action={<Button>Generate questions</Button>}
            />
          ) : (
            MOCK_DRAFT_QUESTIONS.map((question) => (
              <SectionCard
                key={question.id}
                title={`Q${question.order} — ${question.prompt}`}
                description={`Draft · ${QUESTION_TYPE_LABEL[question.type]} · ${question.points} pts · ${
                  question.difficulty === null
                    ? "no difficulty estimate"
                    : `${formatPercent(question.difficulty * 100)} estimated difficulty`
                }`}
                action={
                  <Button size="sm">
                    <CheckCheck className="size-3.5" aria-hidden="true" />
                    Publish
                  </Button>
                }
              >
                <div className="space-y-4">
                  <ol className="space-y-2">
                    {question.options.map((option) => (
                      <li
                        key={option.id}
                        className="flex items-start gap-3 rounded-lg border border-border p-3"
                      >
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-xs">
                          {option.label}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{option.text}</p>
                          {option.isCorrect ? (
                            <p className="mt-1">
                              <StatusPill status="graded" label="Correct answer" />
                            </p>
                          ) : (
                            option.rationale && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Distractor — {option.rationale}
                              </p>
                            )
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>

                  <div className="rounded-lg bg-muted/50 p-3">
                    <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                      Explanation shown after submission
                    </h3>
                    <p className="mt-1 text-sm">{question.explanation}</p>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Topic: {question.topic}.{" "}
                    {materialForTopic(question.topic)
                      ? `Grounded in “${materialForTopic(question.topic)?.title}”.`
                      : "No indexed material covers this topic yet — the question is not grounded in the current material set."}
                  </div>
                </div>
              </SectionCard>
            ))
          )}
        </PageTabPanel>

        <PageTabPanel value="published">
          <SectionCard
            title="Published questions"
            description="Answer keys are visible here because this is the authoring view; students never see them before submitting."
          >
            <DataTable
              caption="Published quiz questions"
              columns={publishedColumns}
              rows={PUBLISHED_QUESTIONS}
              getRowId={(row) => row.id}
              empty={
                <EmptyState
                  title="No published questions"
                  description="Publish a draft to make it part of the next quiz."
                />
              }
            />
          </SectionCard>
        </PageTabPanel>

        <PageTabPanel value="analysis">
          <SectionCard
            title="Item analysis"
            description="Facility and discrimination per question. A question with too few responses reports insufficient data instead of a misleading number."
          >
            <DataTable
              caption="Item analysis"
              columns={analysisColumns}
              rows={MOCK_ITEM_ANALYSIS}
              getRowId={(row) => row.questionId}
              empty={
                <EmptyState
                  title="No responses to analyse"
                  description="Item analysis appears once a published quiz has been attempted."
                />
              }
            />
          </SectionCard>
        </PageTabPanel>

        <PageTabPanel value="topics">
          <SectionCard
            title="Topic mastery"
            description="Cohort mastery per topic, from Quiz 1 responses."
          >
            <ul className="space-y-4">
              {MOCK_TOPIC_MASTERY.map((topic) => (
                <li key={topic.topic}>
                  {topic.mastery === null ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{topic.topic}</p>
                        <p className="text-xs text-muted-foreground">
                          {topic.responses} {topic.responses === 1 ? "response" : "responses"} — not
                          enough to report mastery
                        </p>
                      </div>
                      <StatusPill status="insufficient-data" dot />
                    </div>
                  ) : (
                    <TeacherProgress
                      value={topic.mastery}
                      max={100}
                      label={`${topic.topic} — mastery across ${topic.responses} responses`}
                      valueText={formatPercent(topic.mastery)}
                      tone={
                        topic.mastery >= 80
                          ? "success"
                          : topic.mastery >= 60
                            ? "primary"
                            : "warning"
                      }
                    />
                  )}
                </li>
              ))}
            </ul>
          </SectionCard>
        </PageTabPanel>
      </PageTabs>
    </>
  )
}
