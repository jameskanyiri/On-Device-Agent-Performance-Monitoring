'use client';

import { ChevronDoubleLeftIcon, ChevronDoubleRightIcon, ClockIcon, MagnifyingGlassIcon, ViewColumnsIcon } from '@heroicons/react/20/solid';
import { useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip';
import { ago, fmtDur, fmtMB, fmtNum, fmtPct } from '../format';
import { Chip, StatusChip, Table, ThermalChip, type Column } from '../ui';

/*
 * The device's traces, explored like LangSmith: group by Threads (conversations),
 * Traces (replies and model loads) or Runs (each model call and tool call),
 * narrow by time and search, and filter with the facets on the left.
 */

export type TraceRow = {
  traceId: string;
  name: string;
  start: number;
  durationMs: number;
  status: string;
  kind: string;
  model: string | null;
  modelCalls: number;
  generatedTokens: number;
  toolCalls: number;
  tools: string[];
  peakMemMB: number | null;
  cpuPct: number | null;
  threadId: string | null;
  input: string | null;
  output: string | null;
  error: string | null;
  firstTokenMs: number | null;
  decodeTps: number | null;
  promptTokens: number | null;
  contextUsed: number | null;
  memAddedMB: number | null;
  minHeadroomMB: number | null;
  thermalMax: string | null;
  batteryStart: number | null;
  batteryEnd: number | null;
  charging: boolean;
  energyJ: number | null;
};

export type RunRow = {
  runId: string;
  traceId: string;
  traceName: string;
  threadId: string | null;
  model: string | null;
  kind: 'generation' | 'tool';
  name: string;
  start: number;
  durationMs: number;
  status: string;
  tokens: number | null;
  tokensPerSec: number | null;
  promptTokens: number | null;
  firstTokenMs: number | null;
  resultChars: number | null;
  path: string | null;
};

type View = 'threads' | 'traces' | 'runs';
type Range = '1h' | '24h' | '7d' | 'all';

const RANGES: { id: Range; label: string; ms: number }[] = [
  { id: '1h', label: 'Last hour', ms: 60 * 60_000 },
  { id: '24h', label: 'Last day', ms: 24 * 60 * 60_000 },
  { id: '7d', label: 'Last 7 days', ms: 7 * 24 * 60 * 60_000 },
  { id: 'all', label: 'All', ms: Infinity },
];

const STATUS_LABEL: Record<string, string> = { ok: 'OK', error: 'Error', timeout: 'Timed out' };
const TYPE_LABEL: Record<string, string> = { turn: 'Reply', load: 'Model load', generation: 'Model call', tool: 'Tool call' };
const NO_TOOLS = '(no tools)';
const UNKNOWN_THREAD = 'unknown';

type Facets = Record<string, Set<string>>;

/** Nearest-rank percentile. */
function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}

export function TraceExplorer({
  traces,
  runs,
  now,
  onOpenTrace,
  onOpenThread,
}: {
  traces: TraceRow[];
  runs: RunRow[];
  now: number;
  onOpenTrace: (traceId: string) => void;
  onOpenThread: (threadId: string) => void;
}) {
  const [view, setView] = useState<View>('traces');
  const [range, setRange] = useState<Range>('7d');
  const [query, setQuery] = useState('');
  const [facets, setFacets] = useState<Facets>({});
  const [sidebar, setSidebar] = useState(true);
  const [columns, setColumns] = useState<Record<View, string[]>>(readColumns);
  const setViewColumns = (v: View, ids: string[]) =>
    setColumns((prev) => {
      const next = { ...prev, [v]: ids };
      writeColumns(next);
      return next;
    });

  const since = now - RANGES.find((r) => r.id === range)!.ms;
  const q = query.trim().toLowerCase();
  const threadOf = (id: string | null) => id ?? UNKNOWN_THREAD;

  // Threads take their title from their first message.
  const threadTitles = new Map<string, string>();
  for (const t of [...traces].sort((a, b) => a.start - b.start)) {
    const id = threadOf(t.threadId);
    if (!threadTitles.has(id) && t.kind !== 'load') threadTitles.set(id, t.input ?? t.name);
  }
  const threadTitle = (id: string) => (id === UNKNOWN_THREAD ? 'Unknown thread (traced before threads)' : (threadTitles.get(id) ?? 'Untitled thread'));

  // ── Traces (also what Threads groups) ──
  const traceKeys = (t: TraceRow): Record<string, string[]> => ({
    status: [t.status],
    type: [t.kind === 'load' ? 'load' : 'turn'],
    model: [t.model ?? 'Unknown'],
    tool: t.kind === 'load' ? [] : t.tools.length ? t.tools : [NO_TOOLS],
  });
  const tracesInScope = traces.filter(
    (t) =>
      t.start >= since && (!q || [t.name, t.input, t.output].some((s) => s?.toLowerCase().includes(q)))
  );

  // ── Runs ──
  const runKeys = (r: RunRow): Record<string, string[]> => ({
    status: [r.status],
    type: [r.kind],
    model: [r.model ?? 'Unknown'],
    tool: r.kind === 'tool' ? [r.name] : [],
  });
  const runsInScope = runs.filter(
    (r) =>
      r.start >= since && (!q || [r.name, r.traceName, r.path].some((s) => s?.toLowerCase().includes(q)))
  );

  const passes = (keys: Record<string, string[]>) =>
    Object.entries(facets).every(([facet, picked]) => !picked.size || (keys[facet] ?? []).some((k) => picked.has(k)));

  const shownTraces = tracesInScope.filter((t) => passes(traceKeys(t)));
  const shownRuns = runsInScope.filter((r) => passes(runKeys(r)));

  // Facet values and counts come from what's in scope (time, search, thread) before facets apply.
  const facetSource = view === 'runs' ? runsInScope.map(runKeys) : tracesInScope.map(traceKeys);
  const facetGroups: { id: string; title: string; label: (v: string) => string }[] = [
    { id: 'status', title: 'Status', label: (v) => STATUS_LABEL[v] ?? v },
    { id: 'type', title: 'Type', label: (v) => TYPE_LABEL[v] ?? v },
    { id: 'model', title: 'Model', label: (v) => v },
    { id: 'tool', title: 'Tools', label: (v) => v },
  ];
  const counts = (facet: string) => {
    const m = new Map<string, number>();
    for (const keys of facetSource) for (const k of keys[facet] ?? []) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const toggleFacet = (facet: string, value: string, on: boolean) =>
    setFacets((prev) => {
      const next = new Set(prev[facet]);
      if (on) next.add(value);
      else next.delete(value);
      return { ...prev, [facet]: next };
    });
  const activeFilters = Object.values(facets).reduce((a, s) => a + s.size, 0);

  // ── Threads ──
  const threadRows = [...groupBy(shownTraces, (t) => threadOf(t.threadId)).entries()]
    .map(([id, items]) => {
      const replies = items.filter((t) => t.kind !== 'load');
      return {
        id,
        title: threadTitle(id),
        replies: replies.length,
        lastAt: Math.max(...items.map((t) => t.start)),
        errors: replies.filter((t) => t.status !== 'ok').length,
        p50: percentile(replies.map((t) => t.durationMs), 50),
        p95: percentile(replies.map((t) => t.durationMs), 95),
        ttftP50: percentile(replies.map((t) => t.firstTokenMs).filter((x): x is number => x !== null), 50),
        tokens: replies.reduce((a, t) => a + t.generatedTokens, 0),
        context: [...replies].sort((a, b) => b.start - a.start)[0]?.contextUsed ?? null,
        peakMemMB: maxOf(items.map((t) => t.peakMemMB)),
        minHeadroomMB: minOf(items.map((t) => t.minHeadroomMB)),
        thermalMax: items.map((t) => t.thermalMax).reduce<string | null>((a, b) => (b && (!a || THERMAL_ORDER.indexOf(b) > THERMAL_ORDER.indexOf(a)) ? b : a), null),
        models: [...new Set(items.map((t) => t.model).filter(Boolean))].join(', '),
      };
    })
    .sort((a, b) => b.lastAt - a.lastAt);

  // Latency tone: a reply (or run) taking more than twice the typical (P50) one is marked slow,
  // once there are enough to tell. (With few traces, P95 is just the slowest, so it can't mark anything.)
  const replyTimes = shownTraces.filter((t) => t.kind !== 'load').map((t) => t.durationMs);
  const p50 = percentile(replyTimes, 50);
  const p95 = percentile(replyTimes, 95);
  const slowReply = p50 !== null && replyTimes.length >= 5 ? 2 * p50 : null;
  // Model calls only: tool calls take milliseconds and would make every model call look slow.
  const callTimes = shownRuns.filter((r) => r.kind === 'generation').map((r) => r.durationMs);
  const runP50 = percentile(callTimes, 50);
  const slowRun = runP50 !== null && callTimes.length >= 5 ? 2 * runP50 : null;
  const latency = (ms: number, slowAbove: number | null) => (
    <Chip tone={slowAbove !== null && ms > slowAbove ? 'serious' : 'neutral'} className="gap-1">
      <ClockIcon className="size-3" aria-hidden="true" />
      {fmtDur(ms)}
    </Chip>
  );

  // ── Columns: what each view can show, grouped; which are shown is remembered per view. ──
  const dash = <span className="text-subtle-foreground">–</span>;
  const n = (v: number | null, d = 0) => (v === null ? dash : fmtNum(v, d));
  const dur = (v: number | null) => (v === null ? dash : fmtDur(v));
  const mb = (v: number | null) => (v === null ? dash : fmtMB(v));
  const isLoad = (t: TraceRow) => t.kind === 'load';

  const traceColumns: ColumnDef<TraceRow>[] = [
    { id: 'status', group: 'What happened', label: 'Status', col: { width: 'w-24', cell: (t) => <StatusChip status={t.status} /> } },
    {
      id: 'input',
      group: 'What happened',
      label: 'Input',
      col: { width: 'w-72', primary: true, cell: (t) => <span className="truncate">{isLoad(t) ? <span className="text-muted-foreground">{t.name}</span> : (t.input ?? t.name)}</span> },
    },
    { id: 'output', group: 'What happened', label: 'Output', col: { width: 'w-64', cell: (t) => <span className="truncate text-muted-foreground">{t.output ?? '–'}</span> } },
    { id: 'error', group: 'What happened', label: 'Error', col: { width: 'w-48', cell: (t) => (t.error ? <span className="truncate text-destructive">{t.error}</span> : dash) } },
    { id: 'type', group: 'What happened', label: 'Type', col: { width: 'w-28', cell: (t) => <Chip>{TYPE_LABEL[isLoad(t) ? 'load' : 'turn']}</Chip> } },
    { id: 'start', group: 'What happened', label: 'Started', col: { width: 'w-28', cell: (t) => <span className="truncate text-muted-foreground">{ago(t.start, now)}</span> } },
    { id: 'thread', group: 'What happened', label: 'Thread', col: { width: 'w-48', cell: (t) => <span className="truncate text-muted-foreground">{threadTitle(threadOf(t.threadId))}</span> } },
    { id: 'model', group: 'What happened', label: 'Model', col: { width: 'w-28', cell: (t) => <span className="truncate text-muted-foreground">{t.model ?? '–'}</span> } },
    { id: 'latency', group: 'Model speed', label: 'Latency', hint: 'The whole reply', col: { width: 'w-28', align: 'end', cell: (t) => latency(t.durationMs, isLoad(t) ? null : slowReply) } },
    { id: 'ttft', group: 'Model speed', label: 'First token', hint: 'Reading the prompt + first word', col: { width: 'w-28', align: 'end', cell: (t) => dur(t.firstTokenMs) } },
    { id: 'speed', group: 'Model speed', label: 'Decode speed', hint: 'Tokens per second while writing', col: { width: 'w-32', align: 'end', cell: (t) => (t.decodeTps === null ? dash : `${fmtNum(t.decodeTps, 1)} tok/s`) } },
    { id: 'calls', group: 'Model speed', label: 'Model calls', col: { width: 'w-28', align: 'end', cell: (t) => (isLoad(t) ? dash : fmtNum(t.modelCalls)) } },
    { id: 'promptTokens', group: 'Tokens', label: 'Prompt tokens', col: { width: 'w-32', align: 'end', cell: (t) => n(t.promptTokens) } },
    { id: 'tokens', group: 'Tokens', label: 'Tokens out', col: { width: 'w-28', align: 'end', cell: (t) => (isLoad(t) ? dash : fmtNum(t.generatedTokens)) } },
    { id: 'context', group: 'Tokens', label: 'Context used', hint: 'Tokens in the model’s memory after the reply', col: { width: 'w-28', align: 'end', cell: (t) => n(t.contextUsed) } },
    { id: 'toolCalls', group: 'Agent', label: 'Tool calls', col: { width: 'w-24', align: 'end', cell: (t) => (isLoad(t) ? dash : fmtNum(t.toolCalls)) } },
    {
      id: 'tools',
      group: 'Agent',
      label: 'Tools used',
      col: {
        width: 'w-48',
        cell: (t) =>
          t.tools.length ? (
            <span className="flex min-w-0 gap-1 overflow-hidden">
              {t.tools.map((name) => (
                <Chip key={name} className="font-mono">
                  {name}
                </Chip>
              ))}
            </span>
          ) : (
            dash
          ),
      },
    },
    { id: 'peakMem', group: 'Device impact', label: 'Peak memory', col: { width: 'w-28', align: 'end', cell: (t) => mb(t.peakMemMB) } },
    { id: 'memAdded', group: 'Device impact', label: 'Memory added', hint: 'Peak minus where the reply started', col: { width: 'w-32', align: 'end', cell: (t) => (t.memAddedMB === null ? dash : `+${fmtMB(t.memAddedMB)}`) } },
    {
      id: 'headroom',
      group: 'Device impact',
      label: 'Lowest headroom',
      hint: 'How close iOS came to stopping the app',
      col: { width: 'w-36', align: 'end', cell: (t) => (t.minHeadroomMB === null ? dash : <span className={cn(t.minHeadroomMB < 300 && 'text-destructive')}>{fmtMB(t.minHeadroomMB)}</span>) },
    },
    { id: 'cpu', group: 'Device impact', label: 'CPU', hint: '100% is one core', col: { width: 'w-20', align: 'end', cell: (t) => (t.cpuPct === null ? dash : fmtPct(t.cpuPct)) } },
    { id: 'thermal', group: 'Device impact', label: 'Hottest', col: { width: 'w-28', cell: (t) => (t.thermalMax ? <ThermalChip state={t.thermalMax} /> : dash) } },
    {
      id: 'battery',
      group: 'Device impact',
      label: 'Battery',
      hint: 'Change during the reply',
      col: {
        width: 'w-32',
        align: 'end',
        cell: (t) =>
          t.batteryStart === null || t.batteryEnd === null ? (
            dash
          ) : (
            <span className="truncate">
              {fmtPct(t.batteryEnd * 100)}
              <span className="text-subtle-foreground">{t.charging ? ' · charging' : t.batteryEnd < t.batteryStart ? ` · −${fmtPct((t.batteryStart - t.batteryEnd) * 100)}` : ''}</span>
            </span>
          ),
      },
    },
    { id: 'energy', group: 'Device impact', label: 'Energy', hint: 'Android only', col: { width: 'w-24', align: 'end', cell: (t) => (t.energyJ === null ? dash : `${fmtNum(t.energyJ, 1)} J`) } },
  ];

  const threadColumns: ColumnDef<(typeof threadRows)[number]>[] = [
    { id: 'thread', group: 'Thread', label: 'Thread', col: { width: 'w-80', primary: true, cell: (r) => <span className={cn('truncate', r.id === UNKNOWN_THREAD && 'text-muted-foreground')}>{r.title}</span> } },
    { id: 'replies', group: 'Thread', label: 'Replies', col: { width: 'w-24', align: 'end', cell: (r) => <Chip>{r.replies}</Chip> } },
    { id: 'last', group: 'Thread', label: 'Last activity', col: { width: 'w-32', cell: (r) => <span className="truncate text-muted-foreground">{ago(r.lastAt, now)}</span> } },
    { id: 'errors', group: 'Thread', label: 'Errors', col: { width: 'w-24', align: 'end', cell: (r) => <Chip tone={r.errors ? 'critical' : 'success'}>{r.errors}</Chip> } },
    { id: 'model', group: 'Thread', label: 'Model', col: { width: 'w-28', cell: (r) => <span className="truncate text-muted-foreground">{r.models || '–'}</span> } },
    { id: 'p50', group: 'Model speed', label: 'P50 reply', col: { width: 'w-28', align: 'end', cell: (r) => (r.p50 === null ? dash : latency(r.p50, slowReply)) } },
    { id: 'p95', group: 'Model speed', label: 'P95 reply', col: { width: 'w-28', align: 'end', cell: (r) => (r.p95 === null ? dash : latency(r.p95, slowReply)) } },
    { id: 'ttft', group: 'Model speed', label: 'P50 first token', col: { width: 'w-32', align: 'end', cell: (r) => dur(r.ttftP50) } },
    { id: 'tokens', group: 'Tokens', label: 'Tokens out', col: { width: 'w-28', align: 'end', cell: (r) => fmtNum(r.tokens) } },
    { id: 'context', group: 'Tokens', label: 'Context used', hint: 'After the latest reply', col: { width: 'w-28', align: 'end', cell: (r) => n(r.context) } },
    { id: 'peakMem', group: 'Device impact', label: 'Peak memory', col: { width: 'w-28', align: 'end', cell: (r) => mb(r.peakMemMB) } },
    { id: 'headroom', group: 'Device impact', label: 'Lowest headroom', col: { width: 'w-36', align: 'end', cell: (r) => mb(r.minHeadroomMB) } },
    { id: 'thermal', group: 'Device impact', label: 'Hottest', col: { width: 'w-28', cell: (r) => (r.thermalMax ? <ThermalChip state={r.thermalMax} /> : dash) } },
  ];

  const runColumns: ColumnDef<RunRow>[] = [
    { id: 'status', group: 'What happened', label: 'Status', col: { width: 'w-24', cell: (r) => <StatusChip status={r.status} /> } },
    {
      id: 'name',
      group: 'What happened',
      label: 'Name',
      col: {
        width: 'w-48',
        primary: true,
        cell: (r) => (
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: `var(--span-${r.kind})` }} />
            <span className="truncate font-mono text-xs">{r.name}</span>
          </span>
        ),
      },
    },
    { id: 'type', group: 'What happened', label: 'Type', col: { width: 'w-28', cell: (r) => <Chip>{TYPE_LABEL[r.kind]}</Chip> } },
    { id: 'trace', group: 'What happened', label: 'In', col: { width: 'w-64', cell: (r) => <span className="truncate text-muted-foreground">{r.traceName}</span> } },
    { id: 'start', group: 'What happened', label: 'Started', col: { width: 'w-28', cell: (r) => <span className="truncate text-muted-foreground">{ago(r.start, now)}</span> } },
    { id: 'model', group: 'What happened', label: 'Model', col: { width: 'w-28', cell: (r) => <span className="truncate text-muted-foreground">{r.model ?? '–'}</span> } },
    { id: 'latency', group: 'Model speed', label: 'Latency', col: { width: 'w-28', align: 'end', cell: (r) => latency(r.durationMs, r.kind === 'tool' ? null : slowRun) } },
    { id: 'ttft', group: 'Model speed', label: 'First token', col: { width: 'w-28', align: 'end', cell: (r) => dur(r.firstTokenMs) } },
    { id: 'speed', group: 'Model speed', label: 'Decode speed', col: { width: 'w-32', align: 'end', cell: (r) => (r.tokensPerSec === null ? dash : `${fmtNum(r.tokensPerSec, 1)} tok/s`) } },
    { id: 'promptTokens', group: 'Tokens', label: 'Prompt tokens', col: { width: 'w-32', align: 'end', cell: (r) => n(r.promptTokens) } },
    { id: 'tokens', group: 'Tokens', label: 'Tokens out', col: { width: 'w-28', align: 'end', cell: (r) => n(r.tokens) } },
    { id: 'file', group: 'Tool', label: 'File', col: { width: 'w-40', cell: (r) => (r.path ? <span className="truncate font-mono text-xs text-muted-foreground">{r.path}</span> : dash) } },
    { id: 'result', group: 'Tool', label: 'Result size', hint: 'Characters handed back to the model', col: { width: 'w-28', align: 'end', cell: (r) => (r.resultChars === null ? dash : `${fmtNum(r.resultChars)} chars`) } },
  ];

  const registry = { traces: traceColumns, threads: threadColumns, runs: runColumns } as const;

  const countLabel =
    view === 'threads'
      ? `${threadRows.length} ${threadRows.length === 1 ? 'thread' : 'threads'}`
      : view === 'traces'
        ? `${shownTraces.length} ${shownTraces.length === 1 ? 'trace' : 'traces'}`
        : `${shownRuns.length} ${shownRuns.length === 1 ? 'run' : 'runs'}`;

  return (
    <div className="flex items-start gap-4">
      {sidebar ? (
        <aside aria-label="Filters" className="flex w-52 shrink-0 flex-col gap-5 duration-200 animate-in fade-in slide-in-from-left-1 motion-reduce:animate-none">
          <div className="flex h-9 items-center justify-between">
            <span className="text-sm font-semibold">Filters</span>
            <span className="flex items-center gap-1">
              {activeFilters ? (
                <Button variant="ghost" size="xs" className="text-subtle-foreground hover:text-foreground" onClick={() => setFacets({})}>
                  Clear
                </Button>
              ) : null}
              <IconButton label="Hide filters" onClick={() => setSidebar(false)}>
                <ChevronDoubleLeftIcon aria-hidden="true" />
              </IconButton>
            </span>
          </div>
          {facetGroups.map((g) => {
            const values = counts(g.id);
            if (!values.length) return null;
            return (
              <fieldset key={g.id} className="flex flex-col gap-1.5">
                <legend className="mb-1.5 text-xs text-subtle-foreground">{g.title}</legend>
                {values.map(([value, n]) => {
                  const id = `facet-${g.id}-${value}`;
                  return (
                    <div key={value} className="flex items-center gap-2">
                      <Checkbox id={id} checked={facets[g.id]?.has(value) ?? false} onCheckedChange={(v) => toggleFacet(g.id, value, v === true)} />
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
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {!sidebar ? (
            <IconButton label="Show filters" onClick={() => setSidebar(true)}>
              <ChevronDoubleRightIcon aria-hidden="true" />
            </IconButton>
          ) : null}
          {/* Group first, then time, then search (which takes the rest of the row). */}
          <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={(v) => v && setView(v as View)} aria-label="Group by">
            {(['threads', 'traces', 'runs'] as View[]).map((v) => (
              <ToggleGroupItem key={v} value={v} className="text-xs capitalize data-[state=on]:bg-foreground/[0.07]">
                {v}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ToggleGroup type="single" variant="outline" size="sm" value={range} onValueChange={(v) => v && setRange(v as Range)} aria-label="Time range">
            {RANGES.map((r) => (
              <ToggleGroupItem key={r.id} value={r.id} className="text-xs data-[state=on]:bg-foreground/[0.07]">
                {r.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="relative min-w-48 flex-1">
            <MagnifyingGlassIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle-foreground" />
            <Input aria-label="Search traces" placeholder="Search messages and replies" value={query} onChange={(e) => setQuery(e.target.value)} className="h-9 pl-9" />
          </div>
          <ColumnsMenu
            defs={registry[view]}
            shown={columns[view]}
            onChange={(ids) => setViewColumns(view, ids)}
            onReset={() => setViewColumns(view, DEFAULT_COLUMNS[view])}
          />
        </div>

        <div className="flex min-h-6 flex-wrap items-center gap-2 text-xs text-subtle-foreground tabular-nums">
          <span>{countLabel}</span>
          {view !== 'runs' && p50 !== null ? (
            <span>
              · P50 {fmtDur(p50)} · P95 {fmtDur(p95)}
            </span>
          ) : null}
        </div>

        <WideTable>
          {view === 'traces' ? (
            <Table
              label="Traces"
              rows={shownTraces}
              rowId={(t) => t.traceId}
              rowLabel={(t) => t.input ?? t.name}
              onOpen={(t) => onOpenTrace(t.traceId)}
              empty="No traces match. Widen the time range or clear the filters."
              columns={pick(traceColumns, columns.traces)}
            />
          ) : view === 'threads' ? (
            <Table
              label="Threads"
              rows={threadRows}
              rowId={(r) => r.id}
              rowLabel={(r) => r.title}
              onOpen={(r) => {
                // Traces from before threads were recorded have no thread to open: open the latest one alone.
                if (r.id !== UNKNOWN_THREAD) onOpenThread(r.id);
                else {
                  const latest = shownTraces.filter((t) => !t.threadId).sort((a, b) => b.start - a.start)[0];
                  if (latest) onOpenTrace(latest.traceId);
                }
              }}
              empty="No threads match. Widen the time range or clear the filters."
              columns={pick(threadColumns, columns.threads)}
            />
          ) : (
            <Table
              label="Runs"
              rows={shownRuns}
              rowId={(r) => r.runId}
              rowLabel={(r) => `${r.name} in ${r.traceName}`}
              onOpen={(r) => onOpenTrace(r.traceId)}
              empty="No runs match. Widen the time range or clear the filters."
              columns={pick(runColumns, columns.runs)}
            />
          )}
        </WideTable>
      </div>
    </div>
  );
}

// ── Columns ────────────────────────────────────────────────────────────────

type ColumnDef<T> = {
  id: string;
  group: string;
  label: string;
  /** Shown in the Columns menu, to say what the number means. */
  hint?: string;
  col: Omit<Column<T>, 'key' | 'header'>;
};

const DEFAULT_COLUMNS: Record<View, string[]> = {
  traces: ['status', 'input', 'output', 'start', 'latency', 'ttft', 'speed', 'tokens', 'tools', 'peakMem', 'headroom', 'cpu', 'thermal'],
  threads: ['thread', 'replies', 'last', 'errors', 'p50', 'p95', 'tokens', 'peakMem', 'thermal'],
  runs: ['status', 'name', 'type', 'trace', 'start', 'latency', 'ttft', 'speed', 'tokens', 'file'],
};
const COLUMNS_KEY = 'trace-explorer-columns';

function readColumns(): Record<View, string[]> {
  try {
    const saved = typeof window === 'undefined' ? null : JSON.parse(window.localStorage.getItem(COLUMNS_KEY) ?? 'null');
    return { ...DEFAULT_COLUMNS, ...(saved ?? {}) };
  } catch {
    return DEFAULT_COLUMNS;
  }
}
function writeColumns(value: Record<View, string[]>) {
  try {
    window.localStorage.setItem(COLUMNS_KEY, JSON.stringify(value));
  } catch {
    // private mode: not remembered
  }
}

/** The shown columns, in the registry's order. */
function pick<T>(defs: ColumnDef<T>[], shown: string[]): Column<T>[] {
  return defs.filter((d) => shown.includes(d.id)).map((d) => ({ ...d.col, key: d.id, header: d.label }));
}

/** Pick columns, grouped (What happened, Model speed, Tokens, Agent, Device impact). */
function ColumnsMenu({ defs, shown, onChange, onReset }: { defs: readonly Pick<ColumnDef<unknown>, 'id' | 'group' | 'label' | 'hint'>[]; shown: string[]; onChange: (ids: string[]) => void; onReset: () => void }) {
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
function WideTable({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
      <div className="w-max min-w-full">{children}</div>
    </div>
  );
}

const THERMAL_ORDER = ['nominal', 'fair', 'light', 'moderate', 'serious', 'severe', 'critical', 'emergency', 'shutdown'];
const maxOf = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? Math.max(...v) : null;
};
const minOf = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? Math.min(...v) : null;
};

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const item of items) m.set(key(item), [...(m.get(key(item)) ?? []), item]);
  return m;
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
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
