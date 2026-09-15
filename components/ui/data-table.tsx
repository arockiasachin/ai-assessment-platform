import { EmptyState } from "@/components/ui/empty-state"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

export type Column<T> = {
  /** Stable id used for React keys. */
  id: string
  /** Header cell content. Rendered inside `<th scope="col">`. */
  header: React.ReactNode
  cell: (row: T) => React.ReactNode
  align?: "left" | "center" | "right"
  className?: string
  headerClassName?: string
  /** Hide this column below a breakpoint. */
  hideBelow?: "sm" | "md" | "lg"
}

export type DataTableProps<T> = {
  /** Required: becomes the `<caption>`, so the table is never unlabelled. */
  caption: string
  columns: Column<T>[]
  rows: readonly T[]
  getRowId: (row: T) => string
  /** Optional trailing cell, e.g. a "Review" link per row. */
  rowActions?: (row: T) => React.ReactNode
  /** Replaces the default empty state when `rows` is empty. */
  empty?: React.ReactNode
  /** Keeps the header visible while the table scrolls. */
  stickyHeader?: boolean
  /** Visually hide the caption (it stays available to screen readers). */
  hideCaption?: boolean
  className?: string
}

const ALIGN: Record<NonNullable<Column<unknown>["align"]>, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
}

const HIDE_BELOW: Record<NonNullable<Column<unknown>["hideBelow"]>, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
}

/**
 * Column-driven table.
 *
 * Always a real `<table>` with a `<caption>` and `<th scope="col">` headers, so
 * screen readers get the same structure a sighted user sees. An empty `rows`
 * array renders `empty` (or the default `EmptyState`) inside the table body
 * rather than collapsing the table, which would make the page look broken.
 */
export function DataTable<T>({
  caption,
  columns,
  rows,
  getRowId,
  rowActions,
  empty,
  stickyHeader = true,
  hideCaption = true,
  className,
}: DataTableProps<T>) {
  const columnCount = columns.length + (rowActions ? 1 : 0)

  return (
    <Table className={className}>
      <TableCaption className={hideCaption ? "sr-only" : undefined}>{caption}</TableCaption>
      <TableHeader className={cn(stickyHeader && "sticky top-0 z-10 bg-card")}>
        <TableRow>
          {columns.map((column) => (
            <TableHead
              key={column.id}
              scope="col"
              className={cn(
                ALIGN[column.align ?? "left"],
                column.hideBelow && HIDE_BELOW[column.hideBelow],
                column.headerClassName,
              )}
            >
              {column.header}
            </TableHead>
          ))}
          {rowActions && (
            <TableHead scope="col" className="text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={columnCount} className="py-4 whitespace-normal">
              {empty ?? (
                <EmptyState
                  size="sm"
                  title="Nothing to show"
                  description="This list is empty for the current selection."
                />
              )}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow key={getRowId(row)}>
              {columns.map((column) => (
                <TableCell
                  key={column.id}
                  className={cn(
                    ALIGN[column.align ?? "left"],
                    column.hideBelow && HIDE_BELOW[column.hideBelow],
                    column.className,
                  )}
                >
                  {column.cell(row)}
                </TableCell>
              ))}
              {rowActions && <TableCell className="text-right">{rowActions(row)}</TableCell>}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}
