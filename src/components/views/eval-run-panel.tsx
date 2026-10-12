'use client';

import { CheckCircleIcon, ChevronDoubleLeftIcon, ChevronDoubleRightIcon, ClockIcon, XCircleIcon, XMarkIcon } from '@heroicons/react/20/solid';
import { BeakerIcon } from '@heroicons/react/24/outline';
import { useRef, useState, type ReactNode } from 'react';

import { readPref, writePref } from '@/lib/prefs';
import { cn } from '@/lib/utils';
import type { Span, Trace } from '@/shared/trace';
import { Button } from '@/ui/button';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/tabs';
import { fmtDate, fmtDur, fmtMB, fmtNum, isNum } from '../format';
import { Timeline } from '../timeline';
import { Chip, KeyValues, PassChip, Stat, StatGrid, StatusChip, TextFrame, ThermalChip } from '../ui';
import { usePoll } from '../use-poll';
import { EVAL_METRICS, METRIC_GROUPS } from './eval-metrics';
import { ExpandButton, HeaderButton, impact, Message, PaneDivider, StepDetails, TreeRow, usePanelSize } from './thread-panel';

/*
 * One eval run, laid out like a thread: its steps on the left (the model load,
 * then each turn expanding into its model calls and tool calls), and on the
 * right the result, the conversation, the device timeline and the files the
 * model left behind.
 */

type RunDetail = {
  trace: Trace;
  metrics: Record<string, number | string | boolean | undefined>;
  check: { pass: boolean; detail: string };
  turns: { prompt: string; reply: string; finishReason: string }[];
  workspaceAfter: Record<string, string>;
};

/** What the session page already knows about the run, for the header while it loads. */
export type RunMeta = { taskTitle: string; scenarioLabel: string; rep: number };

const STEPS_WIDTH_KEY = 'run-steps-width';
const STEPS_HIDDEN_KEY = 'run-steps-hidden';
const STEPS_DEFAULT = 320;
const STEPS_MIN = 220;

const num = (v: unknown) => (typeof v === 'number' ? v : null);
const dur = (s: Span) => (s.end ?? s.start) - s.start;
const childrenOf = (trace: Trace, id: string) => trace.spans.filter((s) => s.parentId === id).sort((a, b) => a.start - b.start);

type Selection = { kind: 'summary' } | { kind: 'span'; spanId: string };

export function RunSheet({ sessionId, jobId, meta, onClose }: { sessionId: string; jobId: string | null; meta: (jobId: string) => RunMeta | null; onClose: () => void }) {
  // Keep what was shown while the panel slides out.
  const [shown, setShown] = useState(jobId);
  if (jobId && jobId !== shown) setShown(jobId);
  const { expanded, width, toggleExpanded, changeWidth } = usePanelSize('run-panel');
  return (
    <Sheet open={!!jobId} onOpenChange={(o) => !o && onClose()}>
      {shown ? (
        <SheetContent expanded={expanded} width={width ?? 1180} onWidthChange={changeWidth}>
          <RunContent key={shown} sessionId={sessionId} jobId={shown} meta={meta(shown)} expanded={expanded} onToggleExpanded={toggleExpanded} />
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

function RunContent({ sessionId, jobId, meta, expanded, onToggleExpanded }: { sessionId: string; jobId: string; meta: RunMeta | null; expanded: boolean; onToggleExpanded: () => void }) {
  const { data, error } = usePoll<RunDetail>(`/api/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(jobId)}`, 0);
  const [selection, setSelection] = useState<Selection>({ kind: 'summary' });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [stepsWidth, setStepsWidth] = useState(() => Number(readPref(STEPS_WIDTH_KEY)) || STEPS_DEFAULT);
  const [stepsHidden, setStepsHidden] = useState(() => readPref(STEPS_HIDDEN_KEY) === '1');
  const bodyRef = useRef<HTMLDivElement>(null);
  const saveStepsWidth = (w: number | null) => {
    const max = (bodyRef.current?.clientWidth ?? 1000) - 320;
    const next = w === null ? STEPS_DEFAULT : Math.round(Math.max(STEPS_MIN, Math.min(max, w)));
    setStepsWidth(next);
    writePref(STEPS_WIDTH_KEY, w === null ? '' : String(next));
  };
  const setHidden = (hidden: boolean) => {
    setStepsHidden(hidden);
    writePref(STEPS_HIDDEN_KEY, hidden ? '1' : '0');
  };
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const trace = data?.trace;
  const load = trace?.spans.find((s) => s.kind === 'load');
  const turnSpans = trace ? trace.spans.filter((s) => s.kind === 'turn').sort((a, b) => a.start - b.start) : [];
  const title = meta?.taskTitle ?? (trace ? String(trace.attrs?.task ?? trace.name) : 'Run');

  return (
    <>
      <SheetHeader className="items-center pb-3">
        <BeakerIcon className="size-5 shrink-0 text-subtle-foreground" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <SheetTitle className="flex items-center gap-2 text-lg">
            <span className="truncate">{title}</span>
            {data ? <PassChip pass={data.check.pass} /> : null}
            {trace && trace.status !== 'ok' ? <StatusChip status={trace.status} /> : null}
          </SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-x-2 text-xs tabular-nums">
            {meta ? (
              <span>
                {meta.scenarioLabel} · repeat {meta.rep}
              </span>
            ) : null}
            {trace ? (
              <>
                <span>· {fmtDate(trace.start)}</span>
                <span>· {fmtDur((trace.end ?? trace.start) - trace.start)}</span>
                <span>· {String(trace.attrs?.model ?? '')}</span>
              </>
            ) : (
              <span>{error ? '· Couldn’t load this run' : '· Loading'}</span>
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

      {!data || !trace ? (
        <div className="p-6 text-sm text-muted-foreground">{error ?? 'Loading…'}</div>
      ) : (
        <div ref={bodyRef} className="flex min-h-0 flex-1">
          {stepsHidden ? null : (
            <nav aria-label="Steps" className="flex shrink-0 flex-col" style={{ width: stepsWidth }}>
              <div className="flex items-center justify-between px-3 pt-3 pb-2">
                <span className="text-xs text-subtle-foreground">Steps</span>
                <HeaderButton label="Hide steps" onClick={() => setHidden(true)}>
                  <ChevronDoubleLeftIcon aria-hidden="true" />
                </HeaderButton>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 [scrollbar-gutter:stable]">
                <TreeRow selected={selection.kind === 'summary'} onSelect={() => setSelection({ kind: 'summary' })} depth={0}>
                  {data.check.pass ? <CheckCircleIcon className="size-4 shrink-0 text-success" aria-hidden="true" /> : <XCircleIcon className="size-4 shrink-0 text-destructive" aria-hidden="true" />}
                  <span className="font-medium">Result</span>
                  <span className="ml-auto text-xs text-subtle-foreground tabular-nums">{fmtDur((trace.end ?? trace.start) - trace.start)}</span>
                </TreeRow>
                {load ? (
                  <TreeRow selected={selection.kind === 'span' && selection.spanId === load.id} onSelect={() => setSelection({ kind: 'span', spanId: load.id })} depth={0}>
                    <Chip>Load</Chip>
                    <span className="truncate">Model load</span>
                    <span className="ml-auto shrink-0 text-xs text-subtle-foreground tabular-nums">{fmtDur(dur(load))}</span>
                  </TreeRow>
                ) : null}
                {turnSpans.map((t, i) => {
                  const kids = childrenOf(trace, t.id);
                  const isOpen = open.has(t.id);
                  const tokens = kids.reduce((a, s) => a + (num(s.attrs?.generatedTokens) ?? 0), 0);
                  return (
                    <div key={t.id}>
                      <TreeRow
                        selected={selection.kind === 'span' && selection.spanId === t.id}
                        onSelect={() => setSelection({ kind: 'span', spanId: t.id })}
                        depth={0}
                        expandable={kids.length > 0}
                        expanded={isOpen}
                        onToggle={() => toggle(t.id)}>
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-foreground/[0.07] text-xs font-medium tabular-nums">{i + 1}</span>
                            <span className="truncate">{data.turns[i]?.prompt ?? t.name}</span>
                          </span>
                          <span className="flex items-center gap-2 pl-7 text-xs text-subtle-foreground tabular-nums">
                            <span className="flex items-center gap-1">
                              <ClockIcon className="size-3" aria-hidden="true" />
                              {fmtDur(dur(t))}
                            </span>
                            <span>{fmtNum(tokens)} tokens</span>
                            {t.status !== 'ok' ? <StatusChip status={t.status} /> : null}
                          </span>
                        </span>
                      </TreeRow>
                      {isOpen
                        ? kids.map((sp) => (
                            <TreeRow key={sp.id} depth={1} selected={selection.kind === 'span' && selection.spanId === sp.id} onSelect={() => setSelection({ kind: 'span', spanId: sp.id })}>
                              <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: `var(--span-${sp.kind})` }} />
                              <span className={cn('truncate font-mono text-xs', sp.status !== 'ok' && 'text-destructive')}>{sp.name}</span>
                              <span className="ml-auto shrink-0 text-xs text-subtle-foreground tabular-nums">
                                {fmtDur(dur(sp))}
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
          {stepsHidden ? null : <PaneDivider width={stepsWidth} onChange={saveStepsWidth} label="Resize steps" />}

          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 pt-5 pb-10 [scrollbar-gutter:stable]">
            {stepsHidden ? (
              <div className="-mt-2 mb-3">
                <Button variant="ghost" size="xs" onClick={() => setHidden(false)} className="text-subtle-foreground hover:text-foreground">
                  <ChevronDoubleRightIcon aria-hidden="true" />
                  Show steps
                </Button>
              </div>
            ) : null}
            {(() => {
              if (selection.kind === 'summary') return <RunSummary data={data} />;
              const sp = trace.spans.find((s) => s.id === selection.spanId);
              if (!sp) return <p className="text-sm text-muted-foreground">This step is no longer in the run.</p>;
              if (sp.kind === 'turn') {
                const i = turnSpans.indexOf(sp);
                return <TurnPanel key={sp.id} trace={trace} span={sp} number={i + 1} turn={data.turns[i]} />;
              }
              return <StepDetails key={sp.id} trace={trace} span={sp} within="run" />;
            })()}
          </div>
        </div>
      )}
    </>
  );
}

// ── The whole run ──────────────────────────────────────────────────────────

function RunSummary({ data }: { data: RunDetail }) {
  const { trace, metrics: m, check, turns, workspaceAfter } = data;
  const files = Object.entries(workspaceAfter ?? {});
  const turnSpans = trace.spans.filter((s) => s.kind === 'turn').sort((a, b) => a.start - b.start);
  const v = (key: string) => (isNum(m[key]) ? (m[key] as number) : null);
  const metric = (key: string) => {
    const def = EVAL_METRICS.find((d) => d.key === key)!;
    const x = v(key);
    return x === null ? '–' : def.fmt(x);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* The verdict first: what the check looked for and what it found. */}
      <div
        role={check.pass ? undefined : 'alert'}
        className={cn('flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm', check.pass ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive')}>
        {check.pass ? <CheckCircleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <XCircleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
        <span className="min-w-0 break-words">
          <span className="font-medium">{check.pass ? 'Passed' : 'Failed'}</span>
          <span className="text-foreground/80"> · {check.detail}</span>
        </span>
      </div>

      <StatGrid>
        <Stat label="Task time" value={metric('turnS')} />
        <Stat label="First token" value={metric('firstTokenWallS')} />
        <Stat label="Decode speed" value={metric('decodeTps')} />
        <Stat label="Model calls" value={fmtNum(v('modelCalls'))} />
        <Stat label="Tool calls" value={fmtNum(v('toolCalls'))} note={v('toolErrors') ? `${v('toolErrors')} failed` : undefined} />
        <Stat label="Tokens out" value={metric('generatedTokens')} />
        <Stat label="Peak memory" value={metric('memPeakMB')} note={v('memDeltaMB') !== null ? `+${fmtMB(v('memDeltaMB'))} over idle` : undefined} />
        <Stat label="Hottest" value={typeof m.thermalMax === 'string' ? <ThermalChip state={m.thermalMax} /> : '–'} />
      </StatGrid>

      <Tabs defaultValue="messages">
        <TabsList variant="line">
          <TabsTrigger value="messages">Messages</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="files">Files{files.length ? ` (${files.length})` : ''}</TabsTrigger>
          <TabsTrigger value="metrics">All metrics</TabsTrigger>
        </TabsList>

        <TabsContent value="messages" className="mt-4 flex flex-col gap-3">
          {turns.length ? (
            turns.map((t, i) => (
              <Conversation key={i} prompt={t.prompt} reply={t.reply} finishReason={t.finishReason} tools={turnSpans[i] ? childrenOf(trace, turnSpans[i].id).filter((s) => s.kind === 'tool') : []} model={String(trace.attrs?.model ?? '')} />
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No turns finished.</p>
          )}
        </TabsContent>

        <TabsContent value="timeline" className="mt-4">
          <Timeline spans={trace.spans} samples={trace.samples} platform={trace.device.platform} />
        </TabsContent>

        <TabsContent value="files" className="mt-4 flex flex-col gap-3">
          {files.length ? (
            files.map(([path, content]) => (
              <TextFrame key={path} label={<span className="font-mono text-xs">{path}</span>} meta={`${fmtNum(content.length)} chars`} mono>
                {content}
              </TextFrame>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">The workspace was empty after the run.</p>
          )}
        </TabsContent>

        <TabsContent value="metrics" className="mt-4 flex flex-col gap-5">
          {METRIC_GROUPS.map((g) => {
            // Counts are whole numbers for one run (the formats allow a decimal for averages).
            const rows = EVAL_METRICS.filter((d) => d.group === g && v(d.key) !== null).map((d): [ReactNode, ReactNode] => [d.label, Number.isInteger(v(d.key)) && !/S$|MB$|Pct$|Tps$|J$|Token$/.test(d.key) ? fmtNum(v(d.key)) : d.fmt(v(d.key)!)]);
            return rows.length ? <KeyValues key={g} title={g} rows={rows} /> : null;
          })}
          <KeyValues
            title="Run"
            rows={[
              ['Job', <span key="j" className="font-mono text-xs">{trace.traceId}</span>],
              ['Device', `${trace.device.name ?? ''} · ${trace.device.platform} ${trace.device.osVersion ?? ''}`],
              ['Charging', m.charging ? 'Yes (power numbers aren’t meaningful)' : 'No'],
            ]}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Conversation({ prompt, reply, finishReason, tools, model }: { prompt: string; reply: string; finishReason: string; tools: Span[]; model: string }) {
  return (
    <div className="flex flex-col gap-3">
      <Message role="You" text={prompt} />
      {tools.length ? (
        <div className="flex flex-wrap items-center gap-1.5 pl-1 text-xs text-subtle-foreground">
          <span>Used</span>
          {tools.map((t) => (
            <Chip key={t.id} tone={t.status === 'ok' ? 'neutral' : 'critical'} className="font-mono">
              {t.name}
              {typeof t.attrs?.path === 'string' ? ` ${t.attrs.path}` : ''}
            </Chip>
          ))}
        </div>
      ) : null}
      <Message role="Model" text={reply || null} model={finishReason && finishReason !== 'stop' ? `${model} · ${finishReason}` : model} />
    </div>
  );
}

// ── A turn ─────────────────────────────────────────────────────────────────

function TurnPanel({ trace, span, number, turn }: { trace: Trace; span: Span; number: number; turn?: RunDetail['turns'][number] }) {
  const kids = childrenOf(trace, span.id);
  const gens = kids.filter((s) => s.kind === 'generation');
  const tools = kids.filter((s) => s.kind === 'tool');
  const tokens = gens.reduce((a, s) => a + (num(s.attrs?.generatedTokens) ?? 0), 0);
  let decodeS = 0;
  for (const g of gens) {
    const n = num(g.attrs?.generatedTokens);
    const tps = num(g.attrs?.tokensPerSec);
    if (n && tps) decodeS += n / tps;
  }
  const end = span.end ?? span.start;
  // Readings during the turn, plus one either side.
  const inside = trace.samples.filter((s) => s.t >= span.start && s.t <= end);
  const before = [...trace.samples].reverse().find((s) => s.t < span.start);
  const after = trace.samples.find((s) => s.t > end);
  const samples = [before, ...inside, after].filter((s) => !!s);
  const dev = impact(samples);
  const attrs = Object.entries(span.attrs ?? {}).filter(([k, val]) => val !== null && val !== '' && k !== 'prompt' && k !== 'reply');

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Chip>Turn {number}</Chip>
        <StatusChip status={span.status} />
        <span className="text-xs text-subtle-foreground tabular-nums">
          +{((span.start - trace.start) / 1000).toFixed(2)} s into the run · {fmtDur(end - span.start)}
        </span>
      </div>

      <StatGrid>
        <Stat label="Latency" value={fmtDur(end - span.start)} />
        <Stat label="First token" value={fmtDur(num(gens[0]?.attrs?.ttftMs))} />
        <Stat label="Decode speed" value={decodeS > 0 ? `${fmtNum(tokens / decodeS, 1)} tok/s` : '–'} />
        <Stat label="Model calls" value={gens.length} />
        <Stat label="Tool calls" value={tools.length} note={tools.some((t) => t.status !== 'ok') ? `${tools.filter((t) => t.status !== 'ok').length} failed` : undefined} />
        <Stat label="Tokens out" value={fmtNum(tokens)} />
        <Stat label="Peak memory" value={fmtMB(dev.peakMB)} note={dev.addedMB !== null ? `${dev.addedMB >= 0 ? '+' : '−'}${fmtMB(Math.abs(dev.addedMB))} during the turn` : undefined} />
        <Stat label="Hottest" value={dev.thermalMax ? <ThermalChip state={dev.thermalMax} /> : '–'} />
      </StatGrid>

      <Tabs defaultValue="messages">
        <TabsList variant="line">
          <TabsTrigger value="messages">Messages</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="attributes">Attributes</TabsTrigger>
        </TabsList>
        <TabsContent value="messages" className="mt-4">
          <Conversation prompt={turn?.prompt ?? ''} reply={turn?.reply ?? ''} finishReason={turn?.finishReason ?? ''} tools={tools} model={String(trace.attrs?.model ?? '')} />
        </TabsContent>
        <TabsContent value="timeline" className="mt-4">
          <Timeline spans={[span, ...kids]} samples={samples} platform={trace.device.platform} />
        </TabsContent>
        <TabsContent value="attributes" className="mt-4">
          {attrs.length ? <KeyValues rows={attrs.map(([k, val]): [ReactNode, ReactNode] => [k, String(val)])} /> : <p className="text-sm text-muted-foreground">No attributes.</p>}
        </TabsContent>
      </Tabs>
    </div>
  );
}
