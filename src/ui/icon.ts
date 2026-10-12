import type { ComponentType, SVGProps } from "react";

/**
 * Icons come from Heroicons (@heroicons/react), the same set Workpods and Scopius use:
 * - `24/outline` by default, `24/solid` for the active/selected state
 * - `20/solid` ("mini") for small toolbar glyphs (chevrons, arrows in buttons)
 */
export type Icon = ComponentType<SVGProps<SVGSVGElement> & { title?: string }>;
