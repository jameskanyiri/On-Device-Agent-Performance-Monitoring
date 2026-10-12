"use client"

import { type ReactNode, memo } from "react"
import { ArrowDownIcon, ArrowUpIcon } from "@heroicons/react/20/solid"
import { cn } from "@/lib/utils"
import { Checkbox } from "./checkbox"
import { Frame, FrameBody, FrameCell, FrameHeader, FrameRow } from "./frame"
import type { Icon } from "./icon"

export type SortDirection = "asc" | "desc"

export interface DataColumn<T> {
  key: string
  header: string
  /** A small glyph before the header text (24/outline, drawn at 16 px). */
  icon?: Icon
  /** A fixed width (`"w-32"`); without one, the column shares the remaining space. */
  width?: string
  /** Right-align numbers. */
  align?: "start" | "end"
  /** Set to make the header sort by this key. */
  sortKey?: string
  /** The row's main cell: rendered as a button that opens the row (keyboard reachable). */
  primary?: boolean
  cell: (row: T) => ReactNode
}

export interface DataTableProps<T> {
  /** The table's accessible name. */
  label: string
  columns: readonly DataColumn<T>[]
  rows: readonly T[]
  rowId: (row: T) => string
  /** How a row is named to assistive tech ("Select HCL-0001", "Open HCL-0001"). */
  rowLabel: (row: T) => string
  onOpen?: (row: T) => void
  sort?: { key: string; direction: SortDirection }
  onSort?: (key: string) => void
  /** Turns on the checkbox column. */
  selected?: ReadonlySet<string>
  onSelectedChange?: (next: Set<string>) => void
  /** A row that was just saved: it glows once (`animate-row-highlight`). */
  highlight?: string | null
  /** Rows rise in one after another as they mount (30 ms apart, capped at 12): for a fresh set of rows. */
  stagger?: boolean
  /** Shown in the tray under the card, e.g. bulk actions for the selection. */
  footer?: ReactNode
}

const CHECK = "w-11 flex-none justify-center px-0"

/**
 * The app's table, on `Frame`: column labels (with icons, sortable) in the tray, rows in the card,
 * hairlines between rows and cells. Optional: row selection with a select-all (indeterminate when
 * some are picked), sorting from the headers, a footer in the tray, and a one-shot highlight.
 * Pages of at most 50 rows: not virtualised.
 */
function DataTableInner<T>({
  label,
  columns,
  rows,
  rowId,
  rowLabel,
  onOpen,
  sort,
  onSort,
  selected,
  onSelectedChange,
  highlight = null,
  stagger = false,
  footer,
}: DataTableProps<T>) {
  const selectable = selected !== undefined && onSelectedChange !== undefined
  const ids = rows.map(rowId)
  const picked = ids.filter((id) => selected?.has(id)).length
  const all = picked > 0 && picked === ids.length

  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected)
    if (on) next.add(id)
    else next.delete(id)
    onSelectedChange?.(next)
  }

  return (
    <Frame role="table" aria-label={label}>
      <FrameHeader role="rowgroup" className="p-0">
        <FrameRow>
          {selectable && (
            <FrameCell header className={CHECK}>
              <Checkbox
                aria-label="Select all"
                checked={all ? true : picked > 0 ? "indeterminate" : false}
                onCheckedChange={() => onSelectedChange?.(all ? new Set() : new Set(ids))}
              />
            </FrameCell>
          )}
          {columns.map((c) => {
            const sorted = sort && c.sortKey === sort.key ? sort.direction : null
            const content = (
              <>
                {c.icon && <c.icon className="size-4 shrink-0" aria-hidden="true" />}
                <span className="truncate">{c.header}</span>
                {sorted && (
                  <span key={sorted} className="duration-150 animate-in fade-in zoom-in-75 motion-reduce:animate-none">
                    {sorted === "asc" ? (
                      <ArrowUpIcon className="size-3.5 text-foreground" aria-hidden="true" />
                    ) : (
                      <ArrowDownIcon className="size-3.5 text-foreground" aria-hidden="true" />
                    )}
                  </span>
                )}
              </>
            )
            return (
              <FrameCell
                key={c.key}
                header
                aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                className={cn(c.width && `${c.width} flex-none`, c.align === "end" && "justify-end")}
              >
                {c.sortKey && onSort ? (
                  <button
                    type="button"
                    onClick={() => onSort(c.sortKey!)}
                    className={cn(
                      "-mx-1 flex min-w-0 items-center gap-1.5 rounded-md px-1 outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      sorted && "text-foreground",
                    )}
                  >
                    {content}
                  </button>
                ) : (
                  <span className="flex min-w-0 items-center gap-1.5">{content}</span>
                )}
              </FrameCell>
            )
          })}
        </FrameRow>
      </FrameHeader>

      <FrameBody role="rowgroup" className={cn(footer && "frame-inset-x rounded-b-xl")}>
        {rows.map((row, i) => {
          const id = rowId(row)
          const isSelected = selected?.has(id) ?? false
          // The highlight is an animation too: a highlighted row glows instead of rising.
          const rise = stagger && id !== highlight
          return (
            <FrameRow
              key={id}
              style={rise ? { animationDelay: `${Math.min(i, 12) * 30}ms` } : undefined}
              onClick={onOpen ? () => onOpen(row) : undefined}
              aria-selected={selectable ? isSelected : undefined}
              data-highlight={id === highlight || undefined}
              className={cn(
                "transition-colors duration-150 first:rounded-t-xl last:rounded-b-xl hover:bg-muted/40 data-highlight:animate-row-highlight",
                isSelected && "bg-muted/70 hover:bg-muted/70",
                rise && "ease-out [animation-fill-mode:both] animate-in fade-in slide-in-from-bottom-1 motion-reduce:animate-none",
              )}
            >
              {selectable && (
                <FrameCell className={CHECK} onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    aria-label={`Select ${rowLabel(row)}`}
                    checked={isSelected}
                    onCheckedChange={(on) => toggle(id, on === true)}
                  />
                </FrameCell>
              )}
              {columns.map((c) => (
                <FrameCell
                  key={c.key}
                  className={cn(c.width && `${c.width} flex-none`, c.align === "end" && "justify-end tabular-nums", c.primary && "py-1.5")}
                >
                  {c.primary && onOpen ? (
                    <button
                      type="button"
                      aria-label={`Open ${rowLabel(row)}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpen(row)
                      }}
                      className="flex max-w-full min-w-0 items-center gap-2.5 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      {c.cell(row)}
                    </button>
                  ) : (
                    c.cell(row)
                  )}
                </FrameCell>
              ))}
            </FrameRow>
          )
        })}
      </FrameBody>

      {footer && (
        <div className="flex min-h-11 items-center gap-1 px-3 py-1.5 text-sm duration-200 animate-in fade-in slide-in-from-top-1 motion-reduce:animate-none">
          {footer}
        </div>
      )}
    </Frame>
  )
}

/** Generic and memoised: a parent re-rendering with the same props doesn't redraw the rows. */
export const DataTable = memo(DataTableInner) as typeof DataTableInner

/**
 * The table's shape while its first page loads: the same frame and headers, placeholder bars.
 * Static (nothing loops); it fades in only after 150 ms, so a fast load never flashes.
 */
export function DataTableSkeleton<T>({
  label,
  columns,
  rows = 6,
  selectable = false,
}: {
  label: string
  columns: readonly DataColumn<T>[]
  rows?: number
  selectable?: boolean
}) {
  const widths = ["w-24", "w-32", "w-20", "w-28", "w-16", "w-36"]
  return (
    <div
      role="status"
      aria-label={label}
      className="delay-150 duration-300 [animation-fill-mode:both] animate-in fade-in motion-reduce:animate-none"
    >
      <Frame aria-hidden="true">
        <FrameHeader className="p-0">
          <FrameRow>
            {selectable && <FrameCell header className={CHECK} />}
            {columns.map((c) => (
              <FrameCell key={c.key} header className={cn(c.width && `${c.width} flex-none`)}>
                <span className="flex items-center gap-1.5">
                  {c.icon && <c.icon className="size-4" />}
                  {c.header}
                </span>
              </FrameCell>
            ))}
          </FrameRow>
        </FrameHeader>
        <FrameBody>
          {Array.from({ length: rows }, (_, i) => (
            <FrameRow key={i}>
              {selectable && (
                <FrameCell className={CHECK}>
                  <span className="size-4 rounded-[4px] bg-muted" />
                </FrameCell>
              )}
              {columns.map((c, j) => (
                <FrameCell key={c.key} className={cn("py-3", c.width && `${c.width} flex-none`)}>
                  <span className={cn("h-2.5 rounded-full bg-muted", c.width ? "w-3/5" : widths[(i + j) % widths.length])} />
                </FrameCell>
              ))}
            </FrameRow>
          ))}
        </FrameBody>
      </Frame>
    </div>
  )
}
