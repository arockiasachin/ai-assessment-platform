"use client"

import { useId, useRef, useState } from "react"
import { PanelLeftClose, PanelLeftOpen } from "lucide-react"

import { Button } from "@/components/ui/button"
import { clampSplit, splitForKey, splitFromPointer } from "@/lib/editor-workspace"
import { cn } from "@/lib/utils"

/** Left pane width bounds, as a percentage of the workspace. */
const MIN_SPLIT = 22
const MAX_SPLIT = 60
/** Arrow-key resize step, in percent. */
const KEY_STEP = 2
/** The width the pane collapses to on `md` and up. */
const COLLAPSED_WIDTH = "2.75rem"

export type EditorWorkspaceProps = {
  /** Collapsible left pane — the task brief, limits and history. */
  left: React.ReactNode
  /** Main pane — the editor and its output panel. */
  right: React.ReactNode
  /** Accessible name for the left region and its toggle. */
  leftLabel?: string
  /** Initial left-pane width in percent (default 38). */
  defaultSplit?: number
  minSplit?: number
  maxSplit?: number
  className?: string
}

/**
 * A full-height two-pane editor workspace.
 *
 * Built here rather than pulled from a dependency: `components/ui/` has no
 * resizable, collapsible, sheet or accordion primitive and the repo does not
 * add one for a single page. The split is driven by one CSS custom property
 * (`--pane-left`), so dragging updates a single class target instead of
 * re-laying out both panes from JavaScript.
 *
 * **Monaco resize.** The divider deliberately never touches a Monaco instance.
 * The editor is mounted with `automaticLayout: true`, which observes its
 * container with a `ResizeObserver`; resizing the *container* (which this
 * component does) lets Monaco coalesce its own relayout, whereas calling
 * `editor.layout()` on every `pointermove` would thrash it.
 *
 * **Keyboard.** The divider is a real `role="separator"` with
 * `aria-orientation="vertical"` and `aria-valuenow`/`min`/`max`, and responds to
 * ArrowLeft/ArrowRight (2% per press) plus Home/End. The collapse toggle is a
 * button with `aria-expanded` and `aria-controls`.
 *
 * **Narrow viewports.** Below `md` the panes stack, the divider is hidden, and
 * the left pane spans the full width above the editor; the collapse toggle still
 * folds it away.
 */
export function EditorWorkspace({
  left,
  right,
  leftLabel = "Task brief",
  defaultSplit = 38,
  minSplit = MIN_SPLIT,
  maxSplit = MAX_SPLIT,
  className,
}: EditorWorkspaceProps) {
  const reactId = useId()
  const leftId = `${reactId}-left`
  const [split, setSplit] = useState(() =>
    clampSplit(defaultSplit, { min: minSplit, max: maxSplit }),
  )
  const [collapsed, setCollapsed] = useState(false)
  const [dragging, setDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const rectRef = useRef<DOMRect | null>(null)

  function beginDrag(event: React.PointerEvent<HTMLDivElement>) {
    const container = containerRef.current
    if (!container) return
    rectRef.current = container.getBoundingClientRect()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }

  function moveDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return
    const rect = rectRef.current
    if (!rect) return
    const next = splitFromPointer(event.clientX, rect.left, rect.width, {
      min: minSplit,
      max: maxSplit,
    })
    if (next !== null) setSplit(next)
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    rectRef.current = null
    setDragging(false)
  }

  function resizeWithKeyboard(event: React.KeyboardEvent<HTMLDivElement>) {
    const next = splitForKey(split, event.key, { min: minSplit, max: maxSplit }, KEY_STEP)
    if (next === null) return
    event.preventDefault()
    setSplit(next)
  }

  return (
    <div
      ref={containerRef}
      style={{ "--pane-left": collapsed ? COLLAPSED_WIDTH : `${split}%` } as React.CSSProperties}
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-3 md:flex-row md:gap-0",
        dragging && "cursor-col-resize select-none",
        className,
      )}
    >
      <aside
        id={leftId}
        aria-label={leftLabel}
        className="flex min-h-0 w-full flex-col overflow-hidden rounded-lg border border-border bg-card md:w-[var(--pane-left)] md:shrink-0"
      >
        {collapsed ? (
          <div className="flex flex-1 flex-row items-center gap-2 px-2 py-2 md:flex-col md:justify-start">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setCollapsed(false)}
              aria-label={`Expand ${leftLabel}`}
              aria-expanded={false}
              aria-controls={leftId}
            >
              <PanelLeftOpen className="size-4" aria-hidden="true" />
            </Button>
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase [writing-mode:vertical-rl] max-md:hidden">
              {leftLabel}
            </span>
          </div>
        ) : (
          <>
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
              <h2 className="truncate text-sm font-semibold">{leftLabel}</h2>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setCollapsed(true)}
                aria-label={`Collapse ${leftLabel}`}
                aria-expanded
                aria-controls={leftId}
              >
                <PanelLeftClose className="size-4" aria-hidden="true" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">{left}</div>
          </>
        )}
      </aside>

      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${leftLabel} panel`}
          aria-controls={leftId}
          aria-valuemin={minSplit}
          aria-valuemax={maxSplit}
          aria-valuenow={Math.round(split)}
          aria-valuetext={`${Math.round(split)} percent wide`}
          tabIndex={0}
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={resizeWithKeyboard}
          className={cn(
            "group hidden shrink-0 touch-none cursor-col-resize items-center justify-center outline-none md:flex",
            dragging && "cursor-col-resize",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "h-10 w-1 rounded-full bg-border transition-colors group-hover:bg-primary group-focus-visible:bg-primary",
              dragging && "bg-primary",
            )}
          />
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:pl-3">{right}</div>
    </div>
  )
}
