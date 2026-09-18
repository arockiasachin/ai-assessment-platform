"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { EditorContent, useEditor, useEditorState } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { TableKit } from "@tiptap/extension-table"
import {
  Bold,
  CircleCheck,
  Code,
  FileText,
  Heading1,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Quote,
  Redo2,
  Save,
  Send,
  Strikethrough,
  Table,
  Underline,
  Undo2,
  Upload,
} from "lucide-react"

import { AssessmentPicker, type AssessmentPickerOption } from "@/components/assessment-picker"
import { BackLink } from "@/components/back-link"
import { CollapsibleSection } from "@/components/collapsible-section"
import { EditorWorkspace } from "@/components/editor-workspace"
import { Button } from "@/components/ui/button"
import { KeyValueList } from "@/components/ui/metric-row"
import { Separator } from "@/components/ui/separator"
import { StatusPill, type StatusKey } from "@/components/ui/status-pill"
import { saveDraftAllowed, submissionSubmitAction } from "@/lib/assessment-submission-rules"
import { formatDateTime } from "@/lib/format"
import type { SubmissionState } from "@/lib/student-assessments"

/**
 * The rich-text writing editor for a single written assessment.
 *
 * A Client Component because TipTap owns the DOM. It is deliberately thin: it
 * posts the **same** `POST …/submission` body the old inline textarea did, so the
 * server's release, enrollment, FAT-gate and immutability guards are unchanged.
 * The one difference is that `contentText` is now `editor.getHTML()` rather than
 * plain prose, which the route sanitizes and caps by plain-text length.
 *
 * Uploads go to `POST …/attachment`, which validates by magic bytes and returns
 * sanitized HTML, inserted at the cursor end so nothing the student has already
 * written is replaced.
 */

export type WriteAssessment = {
  id: string
  title: string
  courseCode: string
  courseName: string
  className: string
  dueDate: string
  maxMarks: number
  submissionState: SubmissionState
  /** The saved draft/submission body (sanitized HTML), or `null`. */
  submissionContent: string | null
  /** Why submitting is refused before it is attempted, or `null`. */
  submissionBlockedReason: string | null
}

/**
 * The same 4000-character plain-text budget the route enforces
 * (`SUBMISSION_TEXT_MAX_LENGTH` in `lib/rich-text.ts`); the count shown here is
 * TipTap's own plain text, so it is a close approximation rather than a second
 * definition of the rule.
 */
const TEXT_LIMIT = 4000

/** Student-facing label and tone for each submission state. */
const SUBMISSION_STATE_TO_STATUS: Record<SubmissionState, StatusKey> = {
  not_submitted: "pending",
  draft: "draft",
  submitted: "submitted",
  resubmitted: "resubmitted",
  graded: "graded",
  late: "late",
}

const SUBMISSION_STATE_LABEL: Record<SubmissionState, string> = {
  not_submitted: "Not submitted",
  draft: "Draft",
  submitted: "Submitted",
  resubmitted: "Resubmitted",
  graded: "Graded",
  late: "Late",
}

type EditorStats = {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  bulletList: boolean
  orderedList: boolean
  blockquote: boolean
  codeBlock: boolean
  heading1: boolean
  heading2: boolean
  canUndo: boolean
  canRedo: boolean
  words: number
  characters: number
}

const EMPTY_STATS: EditorStats = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  bulletList: false,
  orderedList: false,
  blockquote: false,
  codeBlock: false,
  heading1: false,
  heading2: false,
  canUndo: false,
  canRedo: false,
  words: 0,
  characters: 0,
}

function countText(text: string): { words: number; characters: number } {
  const trimmed = text.trim()
  return {
    words: trimmed.length > 0 ? trimmed.split(/\s+/).length : 0,
    characters: trimmed.length,
  }
}

function ToolbarButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="size-8 p-0"
    >
      {children}
    </Button>
  )
}

export function StudentWriteEditor({
  assessment,
  options,
}: {
  assessment: WriteAssessment
  /** The student's other written assessments, for the compact header picker. */
  options: AssessmentPickerOption[]
}) {
  const router = useRouter()
  const readOnly = assessment.submissionState === "graded"

  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const editor = useEditor(
    {
      // Next.js renders this on the server first; letting TipTap render
      // immediately would produce a hydration mismatch.
      immediatelyRender: false,
      editable: !readOnly,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          // StarterKit v3 registers Link and Underline. A link opens on click
          // would swallow a click meant to place the cursor.
          link: { openOnClick: false, autolink: true, linkOnPaste: true },
        }),
        TableKit.configure({ table: { resizable: false } }),
      ],
      content: assessment.submissionContent ?? "",
      editorProps: {
        attributes: {
          class:
            "rich-editor min-h-full w-full px-4 py-3 text-base leading-7 focus:outline-none " +
            "[&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 " +
            "[&_h1]:mt-4 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:text-lg [&_h2]:font-semibold " +
            "[&_h3]:mt-3 [&_h3]:text-base [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:pl-3 " +
            "[&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:font-mono [&_pre]:text-xs " +
            "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:px-2 " +
            "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1",
        },
      },
    },
    [],
  )

  const stats =
    useEditorState({
      editor,
      selector: (snapshot): EditorStats => {
        const current = snapshot.editor
        if (!current) return EMPTY_STATS
        const counted = countText(current.getText())
        return {
          bold: current.isActive("bold"),
          italic: current.isActive("italic"),
          underline: current.isActive("underline"),
          strike: current.isActive("strike"),
          bulletList: current.isActive("bulletList"),
          orderedList: current.isActive("orderedList"),
          blockquote: current.isActive("blockquote"),
          codeBlock: current.isActive("codeBlock"),
          heading1: current.isActive("heading", { level: 1 }),
          heading2: current.isActive("heading", { level: 2 }),
          canUndo: current.can().undo(),
          canRedo: current.can().redo(),
          words: counted.words,
          characters: counted.characters,
        }
      },
    }) ?? EMPTY_STATS

  const submitAction = submissionSubmitAction(assessment.submissionState)
  const draftAllowed = saveDraftAllowed(assessment.submissionState)
  const blocked = assessment.submissionBlockedReason !== null
  const overLimit = stats.characters > TEXT_LIMIT

  async function save(action: "saveDraft" | "submit" | "resubmit") {
    if (!editor) return
    setBusy(true)
    setMessage(null)
    setError(null)
    try {
      const response = await fetch(`/api/student/assessments/${assessment.id}/submission`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentText: editor.getHTML(), action }),
      })
      const data = (await response.json()) as { message?: string }
      if (!response.ok) {
        setError(data.message ?? "Unable to save your work.")
        return
      }
      setMessage(data.message ?? "Saved.")
      router.refresh()
    } catch {
      setError("Unable to save your work.")
    } finally {
      setBusy(false)
    }
  }

  async function upload(file: File) {
    if (!editor) return
    setUploading(true)
    setMessage(null)
    setError(null)
    try {
      const body = new FormData()
      body.append("file", file)
      const response = await fetch(`/api/student/assessments/${assessment.id}/attachment`, {
        method: "POST",
        body,
      })
      const data = (await response.json()) as {
        message?: string
        content?: { html?: string }
      }
      if (!response.ok || !data.content?.html) {
        setError(data.message ?? "Unable to read that file.")
        return
      }
      // Append at the end rather than replacing: the student may have typed
      // before choosing a file, and an extraction must never discard their work.
      editor.chain().focus("end").insertContent(data.content.html).run()
      setMessage(data.message ?? "File extracted into the editor.")
    } catch {
      setError("Unable to upload that file.")
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ""
    }
  }

  function setLink() {
    if (!editor) return
    const previous = (editor.getAttributes("link").href as string | undefined) ?? ""
    const url = window.prompt("Link URL", previous || "https://")
    if (url === null) return
    if (url.trim() === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run()
  }

  const toolbar = !readOnly ? (
    <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Formatting">
      <ToolbarButton
        label="Bold"
        active={stats.bold}
        onClick={() => editor?.chain().focus().toggleBold().run()}
      >
        <Bold className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        active={stats.italic}
        onClick={() => editor?.chain().focus().toggleItalic().run()}
      >
        <Italic className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Underline"
        active={stats.underline}
        onClick={() => editor?.chain().focus().toggleUnderline().run()}
      >
        <Underline className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Strikethrough"
        active={stats.strike}
        onClick={() => editor?.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className="size-4" />
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <ToolbarButton
        label="Heading 1"
        active={stats.heading1}
        onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        <Heading1 className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Heading 2"
        active={stats.heading2}
        onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 className="size-4" />
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <ToolbarButton
        label="Bullet list"
        active={stats.bulletList}
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
      >
        <List className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        active={stats.orderedList}
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Quote"
        active={stats.blockquote}
        onClick={() => editor?.chain().focus().toggleBlockquote().run()}
      >
        <Quote className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Code block"
        active={stats.codeBlock}
        onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
      >
        <Code className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Insert link" onClick={setLink}>
        <Link2 className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Insert table"
        onClick={() =>
          editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        }
      >
        <Table className="size-4" />
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <ToolbarButton
        label="Undo"
        disabled={!stats.canUndo}
        onClick={() => editor?.chain().focus().undo().run()}
      >
        <Undo2 className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Redo"
        disabled={!stats.canRedo}
        onClick={() => editor?.chain().focus().redo().run()}
      >
        <Redo2 className="size-4" />
      </ToolbarButton>
    </div>
  ) : null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Compact header: title, picker, submission state. The old "Select an
          assessment" card and the long page description are gone. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <BackLink pathname="/student/write" className="mb-1" />
          <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Write
          </p>
          <h1 className="truncate text-lg font-semibold tracking-tight">{assessment.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AssessmentPicker
            value={assessment.id}
            options={options}
            basePath="/student/write"
            label="Select an assessment"
          />
          <StatusPill
            status={SUBMISSION_STATE_TO_STATUS[assessment.submissionState]}
            label={SUBMISSION_STATE_LABEL[assessment.submissionState]}
            dot
          />
        </div>
      </div>

      {message && (
        <div
          role="status"
          className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400"
        >
          {message}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <EditorWorkspace
        leftLabel="Assessment brief"
        left={
          <div className="space-y-5">
            <CollapsibleSection title="Details" icon={FileText}>
              <KeyValueList
                className="text-base [&_dd]:text-base [&_dt]:text-base"
                items={[
                  {
                    id: "course",
                    label: "Course",
                    value: `${assessment.courseCode} · ${assessment.courseName}`,
                  },
                  { id: "class", label: "Class", value: assessment.className },
                  {
                    id: "due",
                    label: "Due",
                    value: (
                      <span className="font-mono tabular-nums">
                        {formatDateTime(assessment.dueDate)}
                      </span>
                    ),
                  },
                  {
                    id: "marks",
                    label: "Marks",
                    value: (
                      <span className="font-mono tabular-nums">{assessment.maxMarks} marks</span>
                    ),
                  },
                ]}
              />
            </CollapsibleSection>

            <Separator />

            <CollapsibleSection title="Submission" icon={CircleCheck}>
              <div className="max-w-[65ch] space-y-3">
                <StatusPill
                  status={SUBMISSION_STATE_TO_STATUS[assessment.submissionState]}
                  label={SUBMISSION_STATE_LABEL[assessment.submissionState]}
                  dot
                />
                {readOnly ? (
                  <p className="text-base leading-7 text-muted-foreground">
                    This submission has been graded and can no longer be changed.
                  </p>
                ) : (
                  <p className="text-base leading-7 text-muted-foreground">
                    Save a draft as you work. Uploading a PDF, DOCX, TXT, or MD file extracts its
                    text into the editor at your cursor — review it before saving.
                  </p>
                )}
                {assessment.submissionBlockedReason && (
                  <p role="alert" className="text-base leading-7 text-destructive">
                    {assessment.submissionBlockedReason}
                  </p>
                )}
              </div>
            </CollapsibleSection>
          </div>
        }
        right={
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {toolbar}

            <div className="flex h-[60vh] min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card md:h-auto md:flex-1">
              <EditorContent editor={editor} className="min-h-0 flex-1 overflow-y-auto" />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
              <span>
                {stats.words} word{stats.words === 1 ? "" : "s"}
              </span>
              <span className={overLimit ? "font-medium text-destructive" : undefined}>
                {stats.characters}/{TEXT_LIMIT} characters
              </span>
            </div>

            {readOnly ? (
              <p className="rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                This submission has been graded and can no longer be changed.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInput}
                  type="file"
                  accept=".pdf,.docx,.txt,.md"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void upload(file)
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={uploading || busy}
                  onClick={() => fileInput.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Upload className="size-4" />
                  )}
                  {uploading ? "Extracting…" : "Upload PDF, DOCX, TXT, or MD"}
                </Button>

                <span className="mx-1 h-5 w-px bg-border" aria-hidden />

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || !draftAllowed || blocked}
                  onClick={() => void save("saveDraft")}
                >
                  <Save className="size-4" />
                  Save draft
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || submitAction === null || blocked || overLimit}
                  onClick={() => void save(submitAction === "resubmit" ? "resubmit" : "submit")}
                >
                  <Send className="size-4" />
                  {submitAction === "resubmit" ? "Resubmit" : "Submit"}
                </Button>
              </div>
            )}
          </div>
        }
      />
    </div>
  )
}
