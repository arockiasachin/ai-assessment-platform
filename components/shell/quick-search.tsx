"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Loader2, Search } from "lucide-react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { isSearchableQuery, normalizeSearchQuery, type SearchResponse } from "@/lib/search"

/** How long after the last keystroke a request is issued. */
const DEBOUNCE_MS = 200

type FlatHit = {
  id: string
  label: string
  description: string | null
  href: string
  groupLabel: string
}

/**
 * The real quick-search in the top bar's centre zone.
 *
 * Deliberately a **search form, not a global command palette**: it queries
 * `GET /api/search`, which is role-scoped to entities the caller can already
 * list, so it is a faster way to reach your own pages and never a directory of
 * anyone else's.
 *
 * Keyboard: ⌘K (or Ctrl-K) focuses the field, ArrowUp/ArrowDown move through the
 * hits, Enter opens the active one, Escape closes the panel. The hits are real
 * `<Link>`s, so a middle-click or "open in new tab" still works.
 *
 * Requests are debounced and aborted on the next keystroke, and a query below
 * the shared floor is never sent — the floor is enforced again in the route, so
 * the client is a convenience rather than the boundary.
 */
export function QuickSearch({
  placeholder = "Search your courses and assessments…",
  className,
}: {
  placeholder?: string
  className?: string
}) {
  const router = useRouter()
  const reactId = useId()
  const inputId = `${reactId}-input`
  const listId = `${reactId}-results`

  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [query, setQuery] = useState("")
  const [response, setResponse] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  /**
   * The active row, tagged with the query it belongs to.
   *
   * Deriving the index from a `{ query, index }` pair rather than resetting a
   * plain index in an effect means a new result set simply invalidates the old
   * selection during render — no cascading render, and no chance of the old
   * index highlighting an unrelated row in the new results.
   */
  const [active, setActive] = useState<{ query: string; index: number }>({
    query: "",
    index: -1,
  })

  const normalized = normalizeSearchQuery(query)
  const searchable = isSearchableQuery(normalized)
  const activeIndex = active.query === normalized ? active.index : -1

  const hits = useMemo<FlatHit[]>(
    () =>
      (response?.groups ?? []).flatMap((group) =>
        group.items.map((item) => ({
          id: item.id,
          label: item.label,
          description: item.description,
          href: item.href,
          groupLabel: group.label,
        })),
      ),
    [response],
  )

  // Debounced fetch, aborted when the query changes or the component unmounts.
  useEffect(() => {
    // Below the floor there is nothing to ask for. The panel is not rendered
    // either, so a stale response from a previous query cannot show through —
    // which is why this branch does not need to clear state.
    if (!searchable) return

    const controller = new AbortController()
    const handle = setTimeout(() => {
      setLoading(true)
      setError(null)
      fetch(`/api/search?q=${encodeURIComponent(normalized)}`, { signal: controller.signal })
        .then(async (res) => {
          const body: (SearchResponse & { message?: string }) | null = await res
            .json()
            .catch(() => null)
          if (!res.ok) throw new Error(body?.message ?? "Search failed.")
          setResponse(body)
          setError(null)
        })
        .catch((caught: unknown) => {
          if (caught instanceof DOMException && caught.name === "AbortError") return
          setError(caught instanceof Error ? caught.message : "Search failed.")
          setResponse(null)
        })
        .finally(() => setLoading(false))
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(handle)
      controller.abort()
    }
  }, [normalized, searchable])

  // ⌘K / Ctrl-K focuses the field from anywhere on the page.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  // Close when the pointer goes down outside the field and its panel.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [open])

  const panelOpen = open && searchable
  // `response !== null` matters: between the second keystroke and the debounced
  // request nothing has been searched yet, and "No matches" would flash before
  // the first result arrives.
  const showEmpty =
    panelOpen && response !== null && !loading && error === null && hits.length === 0

  function goTo(index: number) {
    const hit = hits[index]
    if (!hit) return
    setOpen(false)
    setQuery("")
    router.push(hit.href)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setOpen(true)
      setActive((previous) => ({
        query: normalized,
        index: Math.min((previous.query === normalized ? previous.index : -1) + 1, hits.length - 1),
      }))
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((previous) => ({
        query: normalized,
        index: Math.max((previous.query === normalized ? previous.index : 0) - 1, 0),
      }))
      return
    }
    if (event.key === "Enter") {
      if (activeIndex >= 0) {
        event.preventDefault()
        goTo(activeIndex)
      }
      return
    }
    if (event.key === "Escape") {
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} className={cn("relative w-full max-w-md", className)}>
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault()
          goTo(activeIndex >= 0 ? activeIndex : 0)
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          {placeholder}
        </label>
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id={inputId}
          ref={inputRef}
          type="search"
          value={query}
          autoComplete="off"
          placeholder={placeholder}
          role="combobox"
          aria-expanded={panelOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `${reactId}-option-${activeIndex}` : undefined}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="pl-8 pr-12"
        />
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.65rem] text-muted-foreground"
        >
          ⌘K
        </kbd>
      </form>

      {panelOpen && (
        <div
          id={listId}
          role="listbox"
          aria-label="Search results"
          className="absolute top-full right-0 left-0 z-50 mt-2 max-h-96 overflow-y-auto rounded-xl border border-border bg-popover py-1 text-sm text-popover-foreground shadow-md"
        >
          {loading && (
            <p className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Searching…
            </p>
          )}
          {error && (
            <p role="alert" className="px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          {showEmpty && (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              No matches in your courses, assessments, or resources.
            </p>
          )}

          {!loading &&
            !error &&
            response?.groups.map((group) => (
              <div key={group.key} role="group" aria-label={group.label}>
                <p className="px-3 pt-2 pb-1 text-[0.7rem] font-semibold tracking-wider text-muted-foreground uppercase">
                  {group.label}
                </p>
                <ul role="presentation">
                  {group.items.map((item) => {
                    const index = hits.findIndex((hit) => hit.id === item.id)
                    const isActive = index === activeIndex
                    return (
                      <li
                        key={`${group.key}-${item.id}`}
                        id={`${reactId}-option-${index}`}
                        role="option"
                        aria-selected={isActive}
                        className={cn(
                          "mx-1 rounded-md",
                          isActive ? "bg-muted" : "hover:bg-muted/60",
                        )}
                      >
                        <Link
                          href={item.href}
                          onClick={() => {
                            setOpen(false)
                            setQuery("")
                          }}
                          onMouseEnter={() => setActive({ query: normalized, index })}
                          className="block px-2 py-1.5 outline-none"
                        >
                          <span className="block truncate font-medium">{item.label}</span>
                          {item.description && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {item.description}
                            </span>
                          )}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
