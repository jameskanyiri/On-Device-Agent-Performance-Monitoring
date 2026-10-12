"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

/**
 * A panel that floats in from the right over the current view, on Shift's
 * dialog (Radix: focus trap, Escape, labelled). Same surface language as the
 * shell's panel: rounded-2xl, shadow-float. Motion is opacity + a short slide,
 * off under Reduce motion.
 */
function Sheet(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />
}

const MIN_WIDTH = 420
const DEFAULT_WIDTH = 960 // 60rem
/** The window margin on each side of the panel (inset-2). */
const MARGIN = 8
const KEY_STEP = 40

/**
 * `expanded` fills the window; otherwise the panel is `width` px wide (default
 * 60rem), leaving the page beside it visible. With `onWidthChange`, its left
 * edge is a resize handle: drag it, or focus it and use the arrow keys;
 * double-click resets the width.
 */
function SheetContent({
  className,
  children,
  expanded = false,
  width,
  onWidthChange,
  onOpenAutoFocus,
  style,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  expanded?: boolean
  width?: number | null
  onWidthChange?: (width: number | null) => void
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const clamp = (w: number) => Math.round(Math.min(window.innerWidth - 2 * MARGIN, Math.max(MIN_WIDTH, w)))

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onWidthChange || e.button !== 0) return
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => onWidthChange(clamp(window.innerWidth - MARGIN - ev.clientX))
    const end = () => {
      handle.removeEventListener("pointermove", move)
      handle.removeEventListener("pointerup", end)
      handle.removeEventListener("pointercancel", end)
    }
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", end)
    handle.addEventListener("pointercancel", end)
  }
  const current = () => ref.current?.getBoundingClientRect().width ?? width ?? DEFAULT_WIDTH
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!onWidthChange) return
    // The panel grows to the left, so ← widens it and → narrows it.
    if (e.key === "ArrowLeft") onWidthChange(clamp(current() + KEY_STEP))
    else if (e.key === "ArrowRight") onWidthChange(clamp(current() - KEY_STEP))
    else return
    e.preventDefault()
  }
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="sheet-overlay"
        className="fixed inset-0 z-50 bg-black/15 duration-150 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none"
      />
      <DialogPrimitive.Content
        ref={ref}
        // Focus the panel itself on open, not its first button (which would pop that button's tooltip).
        onOpenAutoFocus={(e) => {
          onOpenAutoFocus?.(e)
          if (e.defaultPrevented) return
          e.preventDefault()
          ref.current?.focus()
        }}
        data-slot="sheet-content"
        className={cn(
          "fixed inset-y-2 right-2 z-50 flex max-w-[calc(100%-1rem)] flex-col overflow-hidden rounded-2xl bg-background shadow-float outline-none",
          expanded ? "w-[calc(100%-1rem)]" : !width && "w-[min(60rem,calc(100%-1rem))]",
          "data-[state=open]:animate-in data-[state=open]:duration-250 data-[state=open]:ease-[cubic-bezier(0.16,1,0.3,1)] data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-right-4",
          "data-[state=closed]:animate-out data-[state=closed]:duration-150 data-[state=closed]:ease-in data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-right-2",
          // Per state: a bare motion-reduce:animate-none loses to the data-[state] animation classes.
          "motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none",
          className
        )}
        style={!expanded && width ? { ...style, width } : style}
        {...props}
      >
        {onWidthChange && !expanded ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
            aria-valuenow={Math.round(width ?? DEFAULT_WIDTH)}
            aria-valuemin={MIN_WIDTH}
            tabIndex={0}
            onPointerDown={startDrag}
            onKeyDown={onKeyDown}
            onDoubleClick={() => onWidthChange(null)}
            className="group/handle absolute inset-y-0 left-0 z-10 flex w-2.5 cursor-col-resize touch-none items-center justify-center outline-none"
          >
            {/* A quiet grip, shown on hover or keyboard focus. */}
            <span className="h-10 w-1 rounded-full bg-foreground/15 opacity-0 transition-opacity duration-150 group-hover/handle:opacity-100 group-focus-visible/handle:opacity-100 group-focus-visible/handle:bg-ring motion-reduce:transition-none" />
          </div>
        ) : null}
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sheet-header" className={cn("flex items-start gap-3 px-6 pt-5 pb-3 hairline-b", className)} {...props} />
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="sheet-title" className={cn("truncate text-xl font-medium", className)} {...props} />
}

function SheetDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description data-slot="sheet-description" className={cn("text-sm text-muted-foreground", className)} {...props} />
}

const SheetClose = DialogPrimitive.Close

export { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle }
