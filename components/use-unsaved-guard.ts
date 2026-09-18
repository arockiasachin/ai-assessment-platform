"use client"

import { useCallback, useEffect } from "react"

/**
 * Protects typed work that has not been saved yet.
 *
 * ## Why this exists
 *
 * Both editors are plain client state — the writing editor is a TipTap document and the
 * code editor is Monaco's `defaultValue` — and neither persisted anything until the
 * student pressed a button. A refresh, a closed tab, or picking a different assessment
 * from the header picker discarded the lot, with no warning and no recovery. That is the
 * worst failure mode in the product: the student has done the work and cannot tell it
 * is gone until they look for it.
 *
 * ## What it covers, and what it cannot
 *
 * - **`beforeunload`** covers refresh, tab close and navigation away from the app. The
 *   browser shows its own generic prompt; the spec forbids custom text, so this is a
 *   backstop rather than a good message.
 * - **`confirmLeave()`** is for in-app navigation, where `beforeunload` does not fire.
 *   Callers run it before a programmatic route change and abort if it returns `false`.
 *   This is where the student actually gets a useful sentence.
 *
 * The hook deliberately does not attempt to persist anything — auto-saving a draft the
 * student has not asked for would be a different, larger decision. It only refuses to
 * lose work silently.
 */
export function useUnsavedWorkGuard(dirty: boolean, message: string) {
  useEffect(() => {
    // Nothing to protect, so no listener is registered at all.
    if (!dirty) return

    function onBeforeUnload(event: BeforeUnloadEvent) {
      // `preventDefault` plus a legacy `returnValue` is the only portable way to make
      // the browser ask; the string is ignored by every modern browser.
      event.preventDefault()
      event.returnValue = message
      return message
    }

    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [dirty, message])

  /**
   * Ask the student before an in-app navigation discards unsaved work.
   *
   * Returns `true` when it is safe to proceed. Not dirty means nothing to ask about, so
   * an untouched editor navigates without a dialog.
   */
  return useCallback(() => {
    if (!dirty) return true
    return window.confirm(message)
  }, [dirty, message])
}
