"use client"

import * as React from "react"
import { Slot } from "radix-ui"
import { cn } from "@/lib/utils"

/**
 * Shift's surface language: a tinted tray (`Frame`) with a quiet header strip (`FrameHeader`,
 * muted 13 px labels) holding a white card (`FrameBody`) edged in hairlines. Rows inside the card
 * are split by hairlines; in a table, cells are too. Depth comes from a layered hairline shadow,
 * never from a heavy border.
 *
 *   <Frame>
 *     <FrameHeader>Account</FrameHeader>
 *     <FrameBody>…rows…</FrameBody>
 *   </Frame>
 */
function Frame({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="frame"
      className={cn("flex flex-col overflow-hidden rounded-xl bg-surface text-sm shadow-frame", className)}
      {...props}
    />
  )
}

function FrameHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="frame-header"
      className={cn("flex items-center px-3 py-1.5 font-medium text-subtle-foreground", className)}
      {...props}
    />
  )
}

/** The card. Children are rows: each but the last gets a hairline beneath it. `asChild` to render a list. */
function FrameBody({ className, asChild = false, ...props }: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "div"
  return (
    <Comp
      data-slot="frame-body"
      className={cn(
        "frame-inset flex flex-col rounded-t-xl bg-card hairline [&>*:not(:last-child)]:hairline-b",
        className
      )}
      {...props}
    />
  )
}

/** A table row of `FrameCell`s, split by hairlines. Use inside `FrameHeader` or `FrameBody`. */
function FrameRow({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="frame-row" role="row" className={cn("flex w-full", className)} {...props} />
}

/** A cell: equal width by default (`className="flex-none w-32"` to fix one), text ellipsed. */
function FrameCell({ className, header = false, ...props }: React.ComponentProps<"div"> & { header?: boolean }) {
  return (
    <div
      data-slot="frame-cell"
      role={header ? "columnheader" : "cell"}
      className={cn(
        "flex min-w-0 flex-1 basis-0 items-center truncate px-3 not-last:hairline-r",
        header ? "py-1.5" : "py-2",
        className
      )}
      {...props}
    />
  )
}

export { Frame, FrameBody, FrameCell, FrameHeader, FrameRow }
