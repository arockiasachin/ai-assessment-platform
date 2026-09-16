"use client"

import { useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useGradebook } from "@/components/gradebook-provider"
import type { CreateAssessmentRequest } from "@/lib/contracts"

type FormAssessmentType = CreateAssessmentRequest["type"]

const TYPES: FormAssessmentType[] = ["Quiz", "Assignment"]

export function AddAssessmentDialog() {
  const { offerings, addAssessment } = useGradebook()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [offeringId, setOfferingId] = useState("")
  const [type, setType] = useState<FormAssessmentType>("Assignment")
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [maxMarks, setMaxMarks] = useState("50")

  const reset = () => {
    setTitle("")
    setOfferingId(offerings[0]?.id ?? "")
    setType("Assignment")
    setDate(new Date().toISOString().slice(0, 10))
    setMaxMarks("50")
  }

  // Derive the effective offering rather than syncing it into state via an effect.
  const selectedOfferingId = offeringId || offerings[0]?.id || ""

  const submit = () => {
    const max = Number(maxMarks)
    if (!title.trim() || !selectedOfferingId || !Number.isFinite(max) || max <= 0) return
    addAssessment({
      title: title.trim(),
      offeringId: selectedOfferingId,
      type,
      date,
      maxMarks: max,
    })
    reset()
    setOpen(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger render={<Button size="sm" className="gap-1.5" />}>
        <Plus className="size-4" />
        New assessment
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add assessment</DialogTitle>
          <DialogDescription>Create a new assessment column for the whole class.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Trigonometry Test"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="assessment-offering">Class offering</Label>
              <Select
                value={selectedOfferingId}
                onValueChange={(value) => setOfferingId(value ?? "")}
              >
                <SelectTrigger id="assessment-offering">
                  <SelectValue placeholder="Select an offering" />
                </SelectTrigger>
                <SelectContent>
                  {offerings.map((offering) => (
                    <SelectItem key={offering.id} value={offering.id}>
                      {offering.courseName} — {offering.className} ({offering.term}{" "}
                      {offering.academicYear})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="assessment-type">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as FormAssessmentType)}>
                <SelectTrigger id="assessment-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="date">Date</Label>
              <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="max">Max marks</Label>
              <Input
                id="max"
                type="number"
                min={1}
                value={maxMarks}
                onChange={(e) => setMaxMarks(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!title.trim() || !selectedOfferingId}>
            Add assessment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
