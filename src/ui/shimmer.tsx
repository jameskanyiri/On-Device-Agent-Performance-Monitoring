"use client"

import type { ReactNode } from "react";
import { useDocumentVisible } from "@/lib/use-document-visible";
import { cn } from "@/lib/utils";

/**
 * A label for work in progress ("Searching your files", "Working for 12s"). While `active`, a band
 * of full ink sweeps through it; when the work ends, pass `active={false}` and it settles to plain
 * text in place, so the label never jumps. Pauses while the window is hidden; solid under Reduce
 * motion. Use it on the label itself, never beside it.
 */
export function Shimmer({
  active = true,
  className,
  children,
}: {
  active?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const visible = useDocumentVisible();
  return (
    <span
      data-shimmer={active ? "" : undefined}
      className={cn(active ? "animate-text-shimmer" : "text-subtle-foreground", className)}
      style={active && !visible ? { animationPlayState: "paused" } : undefined}
    >
      {children}
    </span>
  );
}
