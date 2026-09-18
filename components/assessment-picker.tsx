"use client"

import { useRouter } from "next/navigation"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export type AssessmentPickerOption = {
  value: string
  label: string
}

export type AssessmentPickerProps = {
  /** The currently selected option's value. */
  value: string
  options: AssessmentPickerOption[]
  /** Route the selection navigates to, e.g. `/student/write`. */
  basePath: string
  /** Query parameter carrying the selection (default `assessmentId`). */
  paramName?: string
  /** Accessible name for the control. */
  label?: string
}

/**
 * The compact assessment switcher for an editor header.
 *
 * Replaces the "Select a task" / "Select an assessment" cards, which spent a
 * full card and a paragraph of copy on a one-line choice. Selecting an option
 * navigates to the same route with a new `assessmentId`; the page's Server
 * Component then resolves the task and server-fetches its data, exactly as the
 * old link list did. Nothing is fetched on the client.
 *
 * Renders nothing when there is only one option: there is nothing to choose
 * between, and the header already names the assessment.
 */
export function AssessmentPicker({
  value,
  options,
  basePath,
  paramName = "assessmentId",
  label = "Assessment",
}: AssessmentPickerProps) {
  const router = useRouter()

  if (options.length <= 1) return null

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (typeof next !== "string" || next === value) return
        // Next 16 removed the query-object form of `router.push`, so the URL is
        // built explicitly. `URLSearchParams` escapes the id.
        const query = new URLSearchParams({ [paramName]: next })
        router.push(`${basePath}?${query.toString()}`)
      }}
    >
      <SelectTrigger size="sm" aria-label={label} className="max-w-64">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
