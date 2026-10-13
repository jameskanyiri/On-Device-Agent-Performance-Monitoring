'use client';

import { ChevronDoubleLeftIcon, ChevronDoubleRightIcon, ChevronRightIcon, ClockIcon, XMarkIcon } from '@heroicons/react/20/solid';
import { ArrowsPointingInIcon, ArrowsPointingOutIcon, ChatBubbleLeftRightIcon, CpuChipIcon, UserIcon } from '@heroicons/react/24/outline';
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

import { readPref, writePref } from '@/lib/prefs';
import { cn } from '@/lib/utils';
import type { MetricSample } from '@/shared/device-metrics';
import type { Span, Trace } from '@/shared/trace';
import { Button } from '@/ui/button';
import { Frame, FrameBody, FrameHeader } from '@/ui/frame';
import { Input } from '@/ui/input';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip';
import { clipText, fmtDate, fmtDur, fmtMB, fmtNum, fmtPct, isNum } from '../format';
import { Timeline } from '../timeline';
import { Chip, KeyValues, Section, Stat, StatGrid, StatusChip, Table, ThermalChip } from '../ui';
import { usePoll } from '../use-poll';
import { hotter, percentile, THERMAL_ORDER } from './explorer-kit';

/*
 * A whole conversation, LangSmith-style: the turns on the left (each expands
 * into its model calls and tool calls), details of what's selected on the
 * right: the messages, the turn's timeline of device metrics, its attributes,
 * and for a single step, what that step did to the phone.
 */

type ThreadData = { threadId: string | null; traces: Trace[] };
type Selection = { kind: 'summary' } | { kind: 'trace'; traceId: string } | { kind: 'span'; traceId: string; spanId: string };

const TURNS_WIDTH_KEY = 'thread-turns-width';
const TURNS_HIDDEN_KEY = 'thread-turns-hidden';
const TURNS_DEFAULT = 352; // 22rem
const TURNS_MIN = 220;
const TURNS_STEP = 32;
const KIND_LABEL: Record<string, string> = { generation: 'Model call', tool: 'Tool call', load: 'Model load', turn: 'Turn' };

const num = (v: unknown) => (typeof v === 'number' ? v : null);
const str = (v: unknown) => (typeof v === 'string' ? v : null);
const isLoad = (t: Trace) => t.attrs?.kind === 'load';
const steps = (t: Trace) => t.spans.filter((s) => s.kind === 'generation' || s.kind === 'tool').sort((a, b) => a.start - b.start);
const tokensOut = (t: Trace) => steps(t).reduce((a, s) => a + (num(s.attrs?.generatedTokens) ?? 0), 0);
const duration = (t: Trace) => (t.end ?? t.start) - t.start;

/** The panel's size, remembered under `prefix`: expanded to full width, or a dragged width. */
export function usePanelSize(prefix: string) {
  const expandedKey = `${prefix}-expanded`;
  const widthKey = `${prefix}-width`;
  const [expanded, setExpanded] = useState(() => readPref(expandedKey) === '1');
  const [width, setWidth] = useState<number | null>(() => Number(readPref(widthKey)) || null);
  const toggleExpanded = () =>
    setExpanded((was) => {
      writePref(expandedKey, was ? '0' : '1');
      return !was;
    });
  const changeWidth = (w: number | null) => {
    setWidth(w);
    writePref(widthKey, w ? String(w) : '');
    if (expanded) {
      setExpanded(false);
      writePref(expandedKey, '0');
    }
  };
  return { expanded, width, toggleExpanded, changeWidth };
}

/** The thread panel: open with a thread id, or a trace id (its thread opens with that turn selected). */
export function ThreadSheet({ deviceId, threadId, traceId, onClose }: { deviceId: string; threadId: string | null; traceId: string | null; onClose: () => void }) {
  const open = !!(threadId || traceId);
  // Keep what was shown while the panel slides out.
  const [shown, setShown] = useState({ threadId, traceId });
  if (open && (threadId !== shown.threadId || traceId !== shown.traceId)) setShown({ threadId, traceId });
  const { expanded, width, toggleExpanded, changeWidth } = usePanelSize('thread-panel');

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      {shown.threadId || shown.traceId ? (
        <SheetContent expanded={expanded} width={width ?? 1180} onWidthChange={changeWidth}>
          <ThreadContent key={`${shown.threadId}|${shown.traceId}`} deviceId={deviceId} threadId={shown.threadId} traceId={shown.traceId} expanded={expanded} onToggleExpanded={toggleExpanded} />
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

function ThreadContent({
  deviceId,
  threadId,
  traceId,
  expanded,
  onToggleExpanded,
}: {
  deviceId: string;
  threadId: string | null;
  traceId: string | null;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const query = new URLSearchParams({ device: deviceId, ...(threadId ? { thread: threadId } : {}), ...(traceId ? { trace: traceId } : {}) });
  const { data, error } = usePoll<ThreadData>(`/api/threads?${query}`, 5000);
  const [selection, setSelection] = useState<Selection>(traceId ? { kind: 'trace', traceId } : { kind: 'summary' });
  const [open, setOpen] = useState<Set<string>>(() => new Set(traceId ? [traceId] : []));
  const [filter, setFilter] = useState('');
  const [turnsWidth, setTurnsWidth] = useState(() => Number(readPref(TURNS_WIDTH_KEY)) || TURNS_DEFAULT);
  const [turnsHidden, setTurnsHidden] = useState(() => readPref(TURNS_HIDDEN_KEY) === '1');
  const bodyRef = useRef<HTMLDivElement>(null);
  const saveTurnsWidth = (w: number | null) => {
    // Leave the details at least 320 px.
    const max = (bodyRef.current?.clientWidth ?? 1000) - 320;
    const next = w === null ? TURNS_DEFAULT : Math.round(Math.max(TURNS_MIN, Math.min(max, w)));
    setTurnsWidth(next);
    writePref(TURNS_WIDTH_KEY, w === null ? '' : String(next));
  };
  const setHidden = (hidden: boolean) => {
    setTurnsHidden(hidden);
    writePref(TURNS_HIDDEN_KEY, hidden ? '1' : '0');
  };

  const traces = data?.traces ?? [];
  const turns = traces.filter((t) => !isLoad(t));
  const first = turns[0] ?? traces[0];
  const title = first ? (str(first.attrs?.input) ?? first.name) : 'Thread';
  const p50 = percentile(turns.map(duration), 50);
  const totalTokens = turns.reduce((a, t) => a + tokensOut(t), 0);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const f = filter.trim().toLowerCase();
  const visible = traces.filter(
    (t) => !f || [t.name, str(t.attrs?.input), str(t.attrs?.output), ...t.spans.map((s) => s.name)].some((x) => x?.toLowerCase().includes(f))
  );
  const turnNumber = (t: Trace) => turns.indexOf(t) + 1;

  return (
    <>
      <SheetHeader className="items-center pb-3">
        <ChatBubbleLeftRightIcon className="size-5 shrink-0 text-subtle-foreground" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <SheetTitle className="text-lg">{data ? (data.threadId ? clipText(title, 90) : (first?.name ?? 'Trace')) : 'Thread'}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-x-2 text-xs tabular-nums">
            {data ? (
              <>
                <span>
                  {turns.length} {turns.length === 1 ? 'turn' : 'turns'}
                </span>
                {p50 !== null ? <span>· P50 {fmtDur(p50)}</span> : null}
                <span>· {fmtNum(totalTokens)} tokens out</span>
                {first ? <span>· started {fmtDate(first.start)}</span> : null}
                {!data.threadId ? <span>· traced before threads, shown alone</span> : null}
              </>
            ) : (
              <span>{error ? 'Couldn’t load this thread' : 'Loading'}</span>
            )}
          </SheetDescription>
        </div>
        <ExpandButton expanded={expanded} onToggle={onToggleExpanded} />
        <SheetClose asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Close" className="text-subtle-foreground hover:text-foreground">
            <XMarkIcon aria-hidden="true" />
          </Button>
        </SheetClose>
      </SheetHeader>

      {!data ? (
        <div className="p-6 text-sm text-muted-foreground">{error ?? 'Loading…'}</div>
      ) : (
        <div ref={bodyRef} className="flex min-h-0 flex-1">
          {/* Turns: the conversation, each turn expanding into its steps. Resizable and collapsible. */}
          {turnsHidden ? null : (
          <nav aria-label="Turns" className="flex shrink-0 flex-col" style={{ width: turnsWidth }}>
            <div className="flex flex-col gap-2 px-3 pt-3 pb-2">
              <span className="flex items-center justify-between">
                <span className="text-xs text-subtle-foreground">Turns</span>
                <HeaderButton label="Hide turns" onClick={() => setHidden(true)}>
                  <ChevronDoubleLeftIcon aria-hidden="true" />
                </HeaderButton>
              </span>
              <Input aria-label="Filter turns" placeholder="Filter turns and steps" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8" />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 [scrollbar-gutter:stable]">
              <TreeRow selected={selection.kind === 'summary'} onSelect={() => setSelection({ kind: 'summary' })} depth={0}>
                <span className="font-medium">Summary</span>
                <span className="ml-auto text-xs text-subtle-foreground tabular-nums">
                  {turns.length} · {p50 !== null ? `P50 ${fmtDur(p50)}` : '–'}
                </span>
              </TreeRow>
              {visible.map((t) => {
                const kids = steps(t);
                const isOpen = open.has(t.traceId) || !!f;
                return (
                  <div key={t.traceId}>
                    <TreeRow
                      selected={selection.kind === 'trace' && selection.traceId === t.traceId}
                      onSelect={() => setSelection({ kind: 'trace', traceId: t.traceId })}
                      depth={0}
                      expandable={kids.length > 0}
                      expanded={isOpen}
                      onToggle={() => toggle(t.traceId)}>
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="flex min-w-0 items-center gap-2">
                          {isLoad(t) ? (
                            <Chip>Load</Chip>
                          ) : (
                            <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-foreground/[0.07] text-xs font-medium tabular-nums">{turnNumber(t)}</span>
                          )}
                          <span className="truncate">{isLoad(t) ? t.name : (str(t.attrs?.input) ?? t.name)}</span>
                        </span>
                        <span className="flex items-center gap-2 pl-7 text-xs text-subtle-foreground tabular-nums">
                          <span className="flex items-center gap-1">
                            <ClockIcon className="size-3" aria-hidden="true" />
                            {fmtDur(duration(t))}
                          </span>
                          {!isLoad(t) ? <span>{fmtNum(tokensOut(t))} tokens</span> : null}
                          {t.status && t.status !== 'ok' ? <StatusChip status={t.status} /> : null}
                        </span>
                      </span>
                    </TreeRow>
                    {isOpen
                      ? kids.map((sp) => (
                          <TreeRow
                            key={sp.id}
                            depth={1}
                            selected={selection.kind === 'span' && selection.spanId === sp.id && selection.traceId === t.traceId}
                            onSelect={() => setSelection({ kind: 'span', traceId: t.traceId, spanId: sp.id })}>
                            <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: `var(--span-${sp.kind})` }} />
                            <span className="truncate font-mono text-xs">{sp.name}</span>
                            <span className="ml-auto shrink-0 text-xs text-subtle-foreground tabular-nums">
                              {fmtDur((sp.end ?? sp.start) - sp.start)}
                              {num(sp.attrs?.generatedTokens) !== null ? ` · ${num(sp.attrs?.generatedTokens)} tok` : ''}
                            </span>
                          </TreeRow>
                        ))
                      : null}
                  </div>
                );
              })}
            </div>
          </nav>
          )}
          {turnsHidden ? null : <PaneDivider width={turnsWidth} onChange={saveTurnsWidth} />}

          {/* Details of the selection. */}
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 pt-5 pb-10 [scrollbar-gutter:stable]">
            {turnsHidden ? (
              <div className="-mt-2 mb-3">
                <Button variant="ghost" size="xs" onClick={() => setHidden(false)} className="text-subtle-foreground hover:text-foreground">
                  <ChevronDoubleRightIcon aria-hidden="true" />
                  Show turns
                </Button>
              </div>
            ) : null}
            {selection.kind === 'summary' ? (
              <SummaryDetails traces={traces} onSelect={(id) => setSelection({ kind: 'trace', traceId: id })} />
            ) : selection.kind === 'trace' ? (
              (() => {
                const t = traces.find((x) => x.traceId === selection.traceId);
                return t ? <TurnDetails key={t.traceId} trace={t} number={isLoad(t) ? null : turnNumber(t)} /> : <Missing />;
              })()
            ) : (
              (() => {
                const t = traces.find((x) => x.traceId === selection.traceId);
                const sp = t?.spans.find((s) => s.id === selection.spanId);
                return t && sp ? <StepDetails key={sp.id} trace={t} span={sp} /> : <Missing />;
              })()
            )}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * The line between Turns and the details: drag it to resize, or focus it and use
 * the arrow keys; double-click resets. The 0.5 px hairline sits in a wider hit area.
 */
export function PaneDivider({ width, onChange, label = 'Resize turns' }: { width: number; onChange: (w: number | null) => void; label?: string }) {
  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const move = (ev: PointerEvent) => onChange(width + (ev.clientX - x0));
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={TURNS_MIN}
      tabIndex={0}
      onPointerDown={startDrag}
      onDoubleClick={() => onChange(null)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') onChange(width - TURNS_STEP);
        else if (e.key === 'ArrowRight') onChange(width + TURNS_STEP);
        else return;
        e.preventDefault();
      }}
      className="group/divider relative w-2 shrink-0 cursor-col-resize touch-none outline-none">
      <span aria-hidden="true" className="absolute inset-y-0 left-0 hairline-r" />
      <span
        aria-hidden="true"
        className="absolute top-1/2 -left-px h-10 w-1 -translate-y-1/2 rounded-full bg-foreground/15 opacity-0 transition-opacity duration-150 group-hover/divider:opacity-100 group-focus-visible/divider:bg-ring group-focus-visible/divider:opacity-100 motion-reduce:transition-none"
      />
    </div>
  );
}

function Missing() {
  return <p className="text-sm text-muted-foreground">This item is no longer in the thread.</p>;
}

/** A row in the turns tree: selectable, optionally expandable. */
export function TreeRow({
  children,
  selected,
  onSelect,
  depth,
  expandable = false,
  expanded = false,
  onToggle,
}: {
  children: ReactNode;
  selected: boolean;
  onSelect: () => void;
  depth: number;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div
      className={cn(
        'group/row flex items-start gap-1 rounded-lg py-1.5 pr-2 text-sm transition-colors duration-150 motion-reduce:transition-none',
        selected ? 'bg-foreground/[0.07]' : 'hover:bg-foreground/[0.04]'
      )}
      style={{ paddingLeft: 4 + depth * 22 }}>
      {expandable ? (
        <button
          type="button"
          aria-label={expanded ? 'Collapse' : 'Expand'}
          aria-expanded={expanded}
          onClick={onToggle}
          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md text-subtle-foreground outline-none hover:bg-foreground/5 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <ChevronRightIcon className={cn('size-4 transition-transform duration-150 motion-reduce:transition-none', expanded && 'rotate-90')} aria-hidden="true" />
        </button>
      ) : (
        <span className="w-5 shrink-0" />
      )}
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        {children}
      </button>
    </div>
  );
}

/** Expand to the full window, or back to the panel's width. */
export function ExpandButton({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <HeaderButton label={expanded ? 'Minimize' : 'Expand'} onClick={onToggle} pressed={expanded}>
      <span className="grid [&>*]:col-start-1 [&>*]:row-start-1">
        <ArrowsPointingOutIcon aria-hidden="true" className={cn('size-4 transition-opacity duration-150 motion-reduce:transition-none', expanded ? 'opacity-0' : 'opacity-100')} />
        <ArrowsPointingInIcon aria-hidden="true" className={cn('size-4 transition-opacity duration-150 motion-reduce:transition-none', expanded ? 'opacity-100' : 'opacity-0')} />
      </span>
    </HeaderButton>
  );
}

export function HeaderButton({ label, onClick, pressed, children }: { label: string; onClick: () => void; pressed?: boolean; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} aria-pressed={pressed} onClick={onClick} className="text-subtle-foreground hover:text-foreground">
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// ── Summary ────────────────────────────────────────────────────────────────

function SummaryDetails({ traces, onSelect }: { traces: Trace[]; onSelect: (traceId: string) => void }) {
  const turns = traces.filter((t) => !isLoad(t));
  const impacts = traces.map((t) => impact(t.samples));
  const peak = maxOf(impacts.map((i) => i.peakMB));
  const lowest = minOf(impacts.map((i) => i.minHeadroomMB));
  const hottest = impacts.map((i) => i.thermalMax).reduce<string | null>(hotter, null);
  const times = turns.map(duration);
  const platform = traces[0]?.device.platform;
  return (
    <div className="flex flex-col gap-6">
      <StatGrid>
        <Stat label="Turns" value={turns.length} />
        <Stat label="P50 reply" value={fmtDur(percentile(times, 50))} />
        <Stat label="P95 reply" value={fmtDur(percentile(times, 95))} />
        <Stat label="Tokens out" value={fmtNum(turns.reduce((a, t) => a + tokensOut(t), 0))} />
        <Stat label="Errors" value={turns.filter((t) => t.status !== 'ok').length} />
        <Stat label="Peak memory" value={fmtMB(peak)} />
        <Stat label={platform === 'android' ? 'Lowest system memory' : 'Lowest headroom'} value={fmtMB(lowest)} />
        <Stat label="Hottest" value={hottest ? <ThermalChip state={hottest} /> : '–'} />
      </StatGrid>
      <Section title="Turns">
        <Table
          label="Turns"
          rows={turns}
          rowId={(t) => t.traceId}
          rowLabel={(t) => str(t.attrs?.input) ?? t.name}
          onOpen={(t) => onSelect(t.traceId)}
          columns={[
            { key: 'n', header: '#', width: 'w-12', align: 'end', cell: (t) => turns.indexOf(t) + 1 },
            { key: 'input', header: 'You', primary: true, cell: (t) => <span className="truncate">{str(t.attrs?.input) ?? t.name}</span> },
            { key: 'status', header: 'Status', width: 'w-24', cell: (t) => <StatusChip status={t.status} /> },
            { key: 'latency', header: 'Latency', width: 'w-24', align: 'end', cell: (t) => fmtDur(duration(t)) },
            { key: 'ttft', header: 'First token', width: 'w-28', align: 'end', cell: (t) => fmtDur(num(steps(t).find((s) => s.kind === 'generation')?.attrs?.ttftMs)) },
            { key: 'tokens', header: 'Tokens', width: 'w-20', align: 'end', cell: (t) => fmtNum(tokensOut(t)) },
            { key: 'tools', header: 'Tools', width: 'w-20', align: 'end', cell: (t) => steps(t).filter((s) => s.kind === 'tool').length },
            { key: 'mem', header: 'Peak memory', width: 'w-28', align: 'end', cell: (t) => fmtMB(impact(t.samples).peakMB) },
          ]}
        />
      </Section>
    </div>
  );
}

// ── A turn ─────────────────────────────────────────────────────────────────

function TurnDetails({ trace, number }: { trace: Trace; number: number | null }) {
  const input = str(trace.attrs?.input);
  const output = str(trace.attrs?.output);
  const error = str(trace.attrs?.error);
  const gens = steps(trace).filter((s) => s.kind === 'generation');
  const tools = steps(trace).filter((s) => s.kind === 'tool');
  const tokens = tokensOut(trace);
  let decodeS = 0;
  for (const g of gens) {
    const n = num(g.attrs?.generatedTokens);
    const tps = num(g.attrs?.tokensPerSec);
    if (n && tps) decodeS += n / tps;
  }
  const dev = impact(trace.samples);
  const attrs = Object.entries(trace.attrs ?? {}).filter(([k, v]) => v !== null && v !== '' && k !== 'input' && k !== 'output');

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        {number !== null ? <Chip>Turn {number}</Chip> : <Chip>Model load</Chip>}
        <StatusChip status={trace.status} />
        <span className="text-xs text-subtle-foreground tabular-nums">
          {fmtDate(trace.start)} · {fmtDur(duration(trace))}
        </span>
      </div>

      <StatGrid>
        <Stat label="Latency" value={fmtDur(duration(trace))} />
        <Stat label="First token" value={fmtDur(num(gens[0]?.attrs?.ttftMs))} />
        <Stat label="Decode speed" value={decodeS > 0 ? `${fmtNum(tokens / decodeS, 1)} tok/s` : '–'} />
        <Stat label="Model calls" value={gens.length} />
        <Stat label="Tool calls" value={tools.length} />
        <Stat label="Tokens out" value={fmtNum(tokens)} />
        <Stat label="Peak memory" value={fmtMB(dev.peakMB)} note={dev.addedMB !== null ? `+${fmtMB(dev.addedMB)} during the turn` : undefined} />
        <Stat label="Hottest" value={dev.thermalMax ? <ThermalChip state={dev.thermalMax} /> : '–'} />
      </StatGrid>

      <Tabs defaultValue={number === null ? 'timeline' : 'messages'}>
        <TabsList variant="line">
          {number !== null ? <TabsTrigger value="messages">Messages</TabsTrigger> : null}
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="attributes">Attributes</TabsTrigger>
        </TabsList>

        {number !== null ? (
          <TabsContent value="messages" className="mt-4 flex flex-col gap-3">
            <Message role="You" text={input} />
            {tools.length ? (
              <div className="flex flex-wrap items-center gap-1.5 pl-1 text-xs text-subtle-foreground">
                <span>Used</span>
                {tools.map((t) => (
                  <Chip key={t.id} className="font-mono">
                    {t.name}
                    {str(t.attrs?.path) ? ` ${str(t.attrs?.path)}` : ''}
                  </Chip>
                ))}
              </div>
            ) : null}
            <Message role="Model" text={output} model={str(trace.attrs?.modelName)} />
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            {!input && !output ? <p className="text-xs text-subtle-foreground">This turn was traced before messages were recorded. Rebuild the app to see them.</p> : null}
          </TabsContent>
        ) : null}

        <TabsContent value="timeline" className="mt-4">
          <Timeline spans={trace.spans} samples={trace.samples} platform={trace.device.platform} />
        </TabsContent>

        <TabsContent value="attributes" className="mt-4">
          <KeyValues rows={[['Trace id', <span key="id" className="font-mono text-xs">{trace.traceId}</span>], ['Device', `${trace.device.name ?? ''} · ${trace.device.platform} ${trace.device.osVersion ?? ''}`], ...attrs.map(([k, v]): [ReactNode, ReactNode] => [k, String(v)])]} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function Message({ role, text, model }: { role: 'You' | 'Model'; text: string | null; model?: string | null }) {
  const Icon = role === 'You' ? UserIcon : CpuChipIcon;
  return (
    <Frame>
      <FrameHeader className="gap-2">
        <Icon className="size-4" aria-hidden="true" />
        <span className="text-foreground">{role}</span>
        {model ? <span className="font-normal">{model}</span> : null}
      </FrameHeader>
      <FrameBody>
        <div className="px-3 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap">{text ?? <span className="text-subtle-foreground">Not recorded</span>}</div>
      </FrameBody>
    </Frame>
  );
}

// ── A step (model call or tool call) ───────────────────────────────────────

export function StepDetails({ trace, span, within = 'turn' }: { trace: Trace; span: Span; within?: 'turn' | 'run' }) {
  const end = span.end ?? span.start;
  // The phone during this step: samples inside it, plus one either side so short steps still have readings.
  const inside = trace.samples.filter((s) => s.t >= span.start && s.t <= end);
  const before = [...trace.samples].reverse().find((s) => s.t < span.start);
  const after = trace.samples.find((s) => s.t > end);
  const window = [before, ...inside, after].filter((s): s is MetricSample => !!s);
  const dev = impact(window);
  const cpu = cpuOver(window);
  const attrs = Object.entries(span.attrs ?? {}).filter(([, v]) => v !== null && v !== '');
  const isGen = span.kind === 'generation';
  const promptTokens = num(span.attrs?.promptTokens);
  const readMs = num(span.attrs?.prefillMs) ?? num(span.attrs?.ttftMs);
  const readTps = promptTokens && readMs ? promptTokens / (readMs / 1000) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: `var(--span-${span.kind})` }} />
        <span className="font-mono text-sm">{span.name}</span>
        <Chip>{KIND_LABEL[span.kind] ?? span.kind}</Chip>
        <StatusChip status={span.status} />
        <span className="text-xs text-subtle-foreground tabular-nums">
          +{((span.start - trace.start) / 1000).toFixed(2)} s into the {within} · {fmtDur(end - span.start)}
        </span>
      </div>

      {isGen ? (
        <StatGrid>
          <Stat label="Duration" value={fmtDur(end - span.start)} />
          <Stat label="First token" value={fmtDur(num(span.attrs?.ttftMs))} note="Reading the prompt + first word" />
          <Stat label="Decode speed" value={num(span.attrs?.tokensPerSec) !== null ? `${fmtNum(num(span.attrs?.tokensPerSec), 1)} tok/s` : '–'} />
          <Stat label="Prompt tokens" value={fmtNum(num(span.attrs?.promptTokens))} note="Newly read this call" />
          <Stat label="Reading speed" value={readTps !== null ? `${fmtNum(readTps)} tok/s` : '–'} note={num(span.attrs?.prefillMs) !== null ? `${fmtDur(num(span.attrs?.prefillMs))} reading` : 'From time to first token'} />
          <Stat label="Tokens out" value={fmtNum(num(span.attrs?.generatedTokens))} />
        </StatGrid>
      ) : span.kind === 'load' ? (
        <StatGrid>
          <Stat label="Duration" value={fmtDur(end - span.start)} note="Reading the model into memory" />
          <Stat label="Prompt tokens at start" value={fmtNum(num(span.attrs?.initTokens))} note="System prompt + tool definitions" />
          <Stat label="Context window" value={fmtNum(num(span.attrs?.maxSeqLen))} note="Tokens" />
        </StatGrid>
      ) : (
        <StatGrid>
          <Stat label="Duration" value={fmtDur(end - span.start)} />
          <Stat label="File" value={<span className="font-mono text-sm">{str(span.attrs?.path) ?? '–'}</span>} />
          <Stat label="Result size" value={num(span.attrs?.resultChars) !== null ? `${fmtNum(num(span.attrs?.resultChars))} chars` : '–'} note="Handed back to the model" />
        </StatGrid>
      )}

      <Section title="On the device during this step" meta={window.length ? `${window.length} readings` : undefined}>
        {window.length ? (
          <StatGrid>
            <Stat label="Memory" value={fmtMB(dev.peakMB)} note={dev.addedMB !== null ? `${dev.addedMB >= 0 ? '+' : '−'}${fmtMB(Math.abs(dev.addedMB))} over the step` : undefined} />
            <Stat label={trace.device.platform === 'android' ? 'Lowest system memory' : 'Lowest headroom'} value={fmtMB(dev.minHeadroomMB)} />
            <Stat label="CPU" value={cpu !== null ? fmtPct(cpu) : '–'} note="100% is one core" />
            <Stat label="Heat" value={dev.thermalMax ? <ThermalChip state={dev.thermalMax} /> : '–'} />
            {dev.energyJ !== null ? <Stat label="Energy" value={`${fmtNum(dev.energyJ, 2)} J`} /> : null}
          </StatGrid>
        ) : (
          <p className="text-sm text-muted-foreground">No device readings around this step.</p>
        )}
      </Section>

      {attrs.length ? (
        <Section title="Attributes">
          <KeyValues rows={attrs.map(([k, v]): [ReactNode, ReactNode] => [k, String(v)])} />
        </Section>
      ) : null}
    </div>
  );
}

// ── Device impact from samples ─────────────────────────────────────────────

export function impact(samples: MetricSample[]) {
  const mem = samples.map((s) => s.memFootprintBytes).filter(isNum);
  const head = samples.map((s) => s.memAvailableBytes).filter(isNum);
  const thermal = samples.map((s) => s.thermal).filter((x): x is string => !!x);
  const powered = samples.filter((s) => isNum(s.powerW));
  let energyJ: number | null = null;
  if (powered.length >= 2) {
    energyJ = 0;
    for (let i = 1; i < powered.length; i++) energyJ += ((powered[i - 1]!.powerW! + powered[i]!.powerW!) / 2) * ((powered[i]!.t - powered[i - 1]!.t) / 1000);
  }
  return {
    peakMB: mem.length ? Math.max(...mem) / 1e6 : null,
    addedMB: mem.length ? (mem.at(-1)! - mem[0]!) / 1e6 : null,
    minHeadroomMB: head.length ? Math.min(...head) / 1e6 : null,
    thermalMax: thermal.length ? thermal.reduce((a, b) => (THERMAL_ORDER.indexOf(b) > THERMAL_ORDER.indexOf(a) ? b : a)) : null,
    energyJ,
  };
}

export function cpuOver(samples: MetricSample[]): number | null {
  const first = samples[0];
  const last = samples.at(-1);
  if (!first || !last || last.uptimeS <= first.uptimeS || last.cpuTimeS < first.cpuTimeS) return null;
  return ((last.cpuTimeS - first.cpuTimeS) / (last.uptimeS - first.uptimeS)) * 100;
}

const maxOf = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? Math.max(...v) : null;
};
const minOf = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? Math.min(...v) : null;
};
