"use client"

import { useEffect, useMemo, useState } from "react"
import { MessageSquare, Sparkles, Star } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type RatingItem = {
  id: string
  rating: number
  comment: string | null
  studentName: string
  registerNumber: string
  updatedAt: string
}

type OfferingReport = {
  offeringId: string
  courseCode: string
  courseName: string
  className: string
  term: string
  academicYear: number
  ratingsCount: number
  averageRating: number | null
  ratings: RatingItem[]
}

export function TeacherRatingsReport() {
  const [offerings, setOfferings] = useState<OfferingReport[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const response = await fetch("/api/teacher/reports/ratings", { cache: "no-store" })
        if (!response.ok) {
          setError("Unable to load rating analytics.")
          return
        }
        const data = (await response.json()) as { offerings: OfferingReport[] }
        setOfferings(data.offerings)
      } catch {
        setError("Unable to load rating analytics.")
      } finally {
        setIsLoading(false)
      }
    }

    void load()
  }, [])

  const totals = useMemo(() => {
    const count = offerings.reduce((sum, row) => sum + row.ratingsCount, 0)
    const weighted = offerings.reduce((sum, row) => sum + (row.averageRating ?? 0) * row.ratingsCount, 0)
    return {
      count,
      average: count ? weighted / count : null,
      comments: offerings.flatMap((row) => row.ratings).filter((row) => row.comment).length,
    }
  }, [offerings])

  if (isLoading) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading reports…</p>
  }

  if (error) {
    return <p className="py-10 text-center text-sm text-destructive">{error}</p>
  }

  return (
    <div className="space-y-6">
      <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-background to-background shadow-sm">
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Badge variant="outline" className="mb-2 w-fit gap-1.5 border-primary/30 bg-background/70 text-primary">
              <Sparkles className="size-3.5" />
              Feedback intelligence
            </Badge>
            <p className="text-sm font-semibold">Student sentiment and rating trends</p>
            <p className="text-xs text-muted-foreground">See what learners are saying about your course delivery.</p>
          </div>
          <Badge variant="secondary" className="w-fit">{offerings.length} offerings</Badge>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="shadow-sm">
          <CardHeader><CardTitle className="text-sm">Total ratings</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{totals.count}</p></CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader><CardTitle className="text-sm">Average score</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{totals.average !== null ? totals.average.toFixed(2) : "—"}</p></CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader><CardTitle className="text-sm">Comments shared</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{totals.comments}</p></CardContent>
        </Card>
      </div>

      {offerings.length === 0 && (
        <Card className="border-border/70 shadow-sm">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No teacher-owned offerings with rating data yet.
          </CardContent>
        </Card>
      )}

      {offerings.map((offering) => (
        <Card key={offering.offeringId} className="overflow-hidden shadow-sm">
          <CardHeader className="border-b border-border/60 bg-muted/15">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">{offering.courseName}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {offering.courseCode} · {offering.className} · {offering.term} {offering.academicYear}
                </p>
              </div>
              <Badge variant="outline">{offering.ratingsCount} ratings</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1 text-sm">
              <Star className="size-4" />
              Average: {offering.averageRating !== null ? offering.averageRating.toFixed(2) : "No ratings"}
            </p>

            <div className="space-y-2">
              {offering.ratings.map((rating) => (
                <div key={rating.id} className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm shadow-sm">
                  <p className="font-medium">
                    {rating.studentName} ({rating.registerNumber}) · {rating.rating}/5
                  </p>
                  {rating.comment ? (
                    <p className="mt-1 inline-flex items-start gap-1 text-muted-foreground">
                      <MessageSquare className="mt-0.5 size-4" />
                      {rating.comment}
                    </p>
                  ) : (
                    <p className="mt-1 text-muted-foreground">No comment left.</p>
                  )}
                </div>
              ))}
              {offering.ratings.length === 0 && <p className="text-sm text-muted-foreground">No ratings for this course yet.</p>}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
