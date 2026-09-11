"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, CalendarDays, ClipboardList, Bell, BookOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { formatDate, type UpcomingEvent } from "@/lib/gradebook"

type Props = {
  role: "teacher" | "student"
  events: UpcomingEvent[]
  onFocusCourse?: (courseId: string) => void
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const

function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function getCalendarDays(monthStart: Date) {
  const gridStart = new Date(monthStart)
  gridStart.setDate(1 - monthStart.getDay())

  return Array.from({ length: 42 }, (_, i) => {
    const day = new Date(gridStart)
    day.setDate(gridStart.getDate() + i)
    return day
  })
}

function eventIcon(type: UpcomingEvent["eventType"]) {
  if (type === "ASSESSMENT") return ClipboardList
  if (type === "REMINDER") return Bell
  return BookOpen
}

export function UpcomingEventsPanel({ role, events, onFocusCourse }: Props) {
  const sortedEvents = useMemo(
    () => [...events].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    [events],
  )

  const firstEventDate = sortedEvents[0] ? new Date(sortedEvents[0].date) : new Date()
  const [monthStart, setMonthStart] = useState(() => startOfMonth(firstEventDate))
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(firstEventDate))
  const didAutoAlignToEvent = useRef(false)

  const eventsByDate = useMemo(() => {
    const map = new Map<string, UpcomingEvent[]>()
    for (const event of sortedEvents) {
      const key = toDateKey(new Date(event.date))
      const bucket = map.get(key)
      if (bucket) {
        bucket.push(event)
      } else {
        map.set(key, [event])
      }
    }
    return map
  }, [sortedEvents])

  const selectedEvents = eventsByDate.get(selectedDate) ?? []
  const calendarDays = useMemo(() => getCalendarDays(monthStart), [monthStart])

  useEffect(() => {
    if (didAutoAlignToEvent.current || sortedEvents.length === 0 || eventsByDate.has(selectedDate)) {
      return
    }

    const first = new Date(sortedEvents[0].date)
    setMonthStart(startOfMonth(first))
    setSelectedDate(toDateKey(first))
    didAutoAlignToEvent.current = true
  }, [eventsByDate, selectedDate, sortedEvents])

  const selectedDateLabel = useMemo(() => {
    const [selectedYear, selectedMonth, selectedDay] = selectedDate.split("-").map((part) => Number(part))
    return formatDate(new Date(selectedYear, selectedMonth - 1, selectedDay, 12, 0, 0).toISOString())
  }, [selectedDate])

  return (
    <Card className="h-fit border-border/70 shadow-sm lg:sticky lg:top-24">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base tracking-tight">
          <CalendarDays className="size-4" />
          Calendar & upcoming events
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-3 rounded-lg border border-border/80 p-3">
          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() =>
                setMonthStart((prev) => startOfMonth(new Date(prev.getFullYear(), prev.getMonth() - 1, 1)))
              }
              aria-label="Previous month"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <p className="text-sm font-semibold">
              {monthStart.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() =>
                setMonthStart((prev) => startOfMonth(new Date(prev.getFullYear(), prev.getMonth() + 1, 1)))
              }
              aria-label="Next month"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
            {WEEKDAYS.map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day) => {
              const dayKey = toDateKey(day)
              const inMonth = day.getMonth() === monthStart.getMonth()
              const isSelected = selectedDate === dayKey
              const count = eventsByDate.get(dayKey)?.length ?? 0

              return (
                <button
                  key={dayKey}
                  type="button"
                  onClick={() => setSelectedDate(dayKey)}
                  className={cn(
                    "relative rounded-md px-1 py-1.5 text-center text-xs transition",
                    inMonth ? "text-foreground" : "text-muted-foreground/50",
                    isSelected ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                  )}
                >
                  <span>{day.getDate()}</span>
                  {count > 0 && (
                    <span
                      className={cn(
                        "absolute bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full",
                        isSelected ? "bg-primary-foreground" : "bg-primary",
                      )}
                    />
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <h4 className="text-sm font-semibold">Upcoming on {selectedDateLabel}</h4>
          {selectedEvents.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No events on this date.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {selectedEvents.map((event) => {
                const Icon = eventIcon(event.eventType)
                const eventTime = new Date(event.date).toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                })

                return (
                  <li key={event.id} className="rounded-md border border-border/80 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{event.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {event.eventType} · {eventTime}
                          {event.courseName ? ` · ${event.courseName}` : ""}
                        </p>
                      </div>
                      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    </div>

                    {(event.description || event.assessmentType) && (
                      <div className="mt-2 rounded-md bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
                        {event.assessmentType ? `${event.assessmentType} assessment` : "Class event"}
                        {event.description ? ` · ${event.description}` : ""}
                      </div>
                    )}

                    <div className="mt-2 flex flex-wrap gap-2">
                      {role === "teacher" && event.courseId && onFocusCourse && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => onFocusCourse(event.courseId!)}
                        >
                          Filter to course
                        </Button>
                      )}
                      {event.assessmentType === "Quiz" && role === "student" && (
                        <Link href="/quiz" className="inline-flex">
                          <Button type="button" variant="outline" size="sm">
                            Open quiz center
                          </Button>
                        </Link>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
