'use client';

import { ChevronDoubleLeftIcon, ViewColumnsIcon } from '@heroicons/react/20/solid';
import { useState, type ReactNode } from 'react';

import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Label } from '@/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip';
import type { Column } from '../ui';

/*
 * The parts every explorer shares (traces on a device, runs in an eval):
 * a facet sidebar, a Columns picker remembered per view, and a table that
 * scrolls sideways instead of squeezing.
 */

// ── Facets ─────────────────────────────────────────────────────────────────

export type Facets = Record<string, Set<string>>;
export type FacetGroup = { id: string; title: string; label: (v: string) => string };

/** True when the item's keys match every facet that has something picked. */
export function passesFacets(facets: Facets, keys: Record<string, string[]>) {
  return Object.entries(facets).every(([facet, picked]) => !picked.size || (keys[facet] ?? []).some((k) => picked.has(k)));
}

/** Facet state: what's picked, and toggling a value. */
export function useFacets() {
  const [facets, setFacets] = useState<Facets>({});
  const toggle = (facet: string, value: string, on: boolean) =>
    setFacets((prev) => {
      const next = new Set(prev[facet]);
      if (on) next.add(value);
      else next.delete(value);
      return { ...prev, [facet]: next };
    });
  return { facets, toggle, clear: () => setFacets({}) };
}

/** The Filters sidebar: each group's values with counts (from what's in scope before facets apply). */
export function FacetSidebar({
  groups,
  source,
  facets,
  onToggle,
  onClear,
  onHide,
  idPrefix = 'facet',
}: {
  groups: FacetGroup[];
  source: Record<string, string[]>[];
  facets: Facets;
  onToggle: (facet: string, value: string, on: boolean) => void;
  onClear: () => void;
  onHide: () => void;
  idPrefix?: string;
}) {
  const active = Object.values(facets).reduce((a, s) => a + s.size, 0);
  const counts = (facet: string) => {
    const m = new Map<string, number>();
    for (const keys of source) for (const k of keys[facet] ?? []) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  return (
    <aside aria-label="Filters" className="flex w-52 shrink-0 flex-col gap-5 duration-200 animate-in fade-in slide-in-from-left-1 motion-reduce:animate-none">
      <div className="flex h-9 items-center justify-between">
        <span className="text-sm font-semibold">Filters</span>
        <span className="flex items-center gap-1">
          {active ? (
            <Button variant="ghost" size="xs" className="text-subtle-foreground hover:text-foreground" onClick={onClear}>
              Clear
            </Button>
          ) : null}
          <IconButton label="Hide filters" onClick={onHide}>
            <ChevronDoubleLeftIcon aria-hidden="true" />
          </IconButton>
        </span>
      </div>
      {groups.map((g) => {
        const values = counts(g.id);
        if (!values.length) return null;
        return (
          <fieldset key={g.id} className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-xs text-subtle-foreground">{g.title}</legend>
            {values.map(([value, n]) => {
              const id = `${idPrefix}-${g.id}-${value}`;
              return (
                <div key={value} className="flex items-center gap-2">
                  <Checkbox id={id} checked={facets[g.id]?.has(value) ?? false} onCheckedChange={(v) => onToggle(g.id, value, v === true)} />
                  <Label htmlFor={id} className="min-w-0 flex-1 cursor-pointer truncate font-normal">
                    {g.label(value)}
                  </Label>
                  <span className="text-xs text-subtle-foreground tabular-nums">{n}</span>
                </div>
              );
            })}
          </fieldset>
        );
      })}
    </aside>
  );
}

// ── Columns ────────────────────────────────────────────────────────────────

export type ColumnDef<T> = {
  id: string;
  group: string;
  label: string;
  /** Shown in the Columns menu, to say what the number means. */
  hint?: string;
  col: Omit<Column<T>, 'key' | 'header'>;
};

/** Which columns each view shows, remembered in localStorage under `key`. */
export function useColumns<V extends string>(key: string, defaults: Record<V, string[]>) {
  const [columns, setColumns] = useState<Record<V, string[]>>(() => {
    try {
      const saved = typeof window === 'undefined' ? null : JSON.parse(window.localStorage.getItem(key) ?? 'null');
      return { ...defaults, ...(saved ?? {}) };
    } catch {
      return defaults;
    }
  });
  const set = (view: V, ids: string[]) =>
    setColumns((prev) => {
      const next = { ...prev, [view]: ids };
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // private mode: not remembered
      }
      return next;
    });
  return { columns, set, reset: (view: V) => set(view, defaults[view]) };
}

/** The shown columns, in the registry's order. */
export function pick<T>(defs: ColumnDef<T>[], shown: string[]): Column<T>[] {
  return defs.filter((d) => shown.includes(d.id)).map((d) => ({ ...d.col, key: d.id, header: d.label }));
}

/** Pick columns, grouped (What happened, Model speed, Tokens, Agent, Device impact). */
export function ColumnsMenu({ defs, shown, onChange, onReset }: { defs: readonly Pick<ColumnDef<unknown>, 'id' | 'group' | 'label' | 'hint'>[]; shown: string[]; onChange: (ids: string[]) => void; onReset: () => void }) {
  const groups = [...new Set(defs.map((d) => d.group))];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <ViewColumnsIcon aria-hidden="true" />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex max-h-[70vh] w-72 flex-col gap-4 overflow-y-auto p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Columns</span>
          <Button variant="ghost" size="xs" className="text-subtle-foreground hover:text-foreground" onClick={onReset}>
            Reset
          </Button>
        </div>
        {groups.map((g) => (
          <fieldset key={g} className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-xs text-subtle-foreground">{g}</legend>
            {defs
              .filter((d) => d.group === g)
              .map((d) => {
                const id = `col-${d.id}`;
                const on = shown.includes(d.id);
                return (
                  <div key={d.id} className="flex items-start gap-2">
                    <Checkbox
                      id={id}
                      className="mt-0.5"
                      checked={on}
                      onCheckedChange={(v) => onChange(v === true ? [...shown, d.id] : shown.filter((x) => x !== d.id))}
                    />
                    <Label htmlFor={id} className="flex min-w-0 cursor-pointer flex-col items-start gap-0 font-normal">
                      <span>{d.label}</span>
                      {d.hint ? <span className="text-xs text-subtle-foreground">{d.hint}</span> : null}
                    </Label>
                  </div>
                );
              })}
          </fieldset>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** Lets a wide table scroll sideways inside the page instead of squeezing its columns. */
export function WideTable({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
      <div className="w-max min-w-full">{children}</div>
    </div>
  );
}

export function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} className="text-subtle-foreground hover:text-foreground">
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// ── Small maths shared by explorers ────────────────────────────────────────

/** Nearest-rank percentile. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}

export const THERMAL_ORDER = ['nominal', 'fair', 'light', 'moderate', 'serious', 'severe', 'critical', 'emergency', 'shutdown'];

/** The hotter of two thermal states. */
export const hotter = (a: string | null, b: string | null | undefined) => (b && (!a || THERMAL_ORDER.indexOf(b) > THERMAL_ORDER.indexOf(a)) ? b : a);
