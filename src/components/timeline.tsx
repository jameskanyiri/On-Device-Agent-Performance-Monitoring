'use client';

import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

import { TableCellsIcon } from '@heroicons/react/24/outline';

import { cn } from '@/lib/utils';
import type { MetricSample } from '@/shared/device-metrics';
import type { Span, SpanKind } from '@/shared/trace';
import { Button } from '@/ui/button';
import { Frame, FrameBody, FrameHeader } from '@/ui/frame';
import { fmtClock, fmtDur, fmtMB, fmtNum, fmtPct, isNum, THERMAL } from './format';
import { Chip, KeyValues, StatusChip, Table } from './ui';

/*
 * What the agent did and what it cost the phone, as a stack of separate cards
 * (Activity, App memory, Headroom, CPU, Power, Thermal) on one shared time
 * axis: every card has the same left gutter and scale, and hovering any card
 * draws the crosshair in all of them. Span kinds take Shift's category colours;
 * device lines are neutral ink; heat uses status tints with labels.
 */

const KIND_LABEL: Record<string, string> = {
  load: 'Load',
  turn: 'Turn',
  generation: 'Model call',
  tool: 'Tool call',
  run: 'Run',
  cooldown: 'Cool-down',
  idle: 'Idle baseline',
};
const kindColor = (kind: SpanKind) =>
  ['load', 'turn', 'generation', 'tool'].includes(kind) ? `var(--span-${kind})` : 'var(--hairline)';
const GROUP_LABEL: Record<string, string> = { load: 'Model loads', turn: 'Replies', generation: 'Model calls', tool: 'Tool calls' };
const TONE_FILL: Record<string, string> = { warning: 'var(--warning)', serious: 'var(--serious)', critical: 'var(--destructive)' };

type Point = { t: number; v: number };
type Lane =
  | { key: string; title: string; hint?: string; points: Point[]; fmt: (v: number) => string; minMax?: number }
  | { key: 'thermal'; title: string; hint?: string; thermal: { t: number; state: string }[] };

function lanesFrom(samples: MetricSample[], platform: string): Lane[] {
  const pts = (pick: (s: MetricSample) => number | undefined) =>
    samples.map((s) => ({ t: s.t, v: pick(s) })).filter((p): p is Point => isNum(p.v));
  const cpu: Point[] = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    const dt = b.uptimeS - a.uptimeS;
    // Skip gaps where a counter reset (app restart) or the clock jumped.
    if (dt > 0 && b.cpuTimeS >= a.cpuTimeS) cpu.push({ t: b.t, v: ((b.cpuTimeS - a.cpuTimeS) / dt) * 100 });
  }
  const memory = pts((s) => (isNum(s.memFootprintBytes) ? s.memFootprintBytes / 1e6 : undefined));
  const headroom = pts((s) => (isNum(s.memAvailableBytes) ? s.memAvailableBytes / 1e6 : undefined));
  const power = pts((s) => s.powerW);
  const thermal = samples.filter((s) => s.thermal).map((s) => ({ t: s.t, state: s.thermal! }));
  const lanes: Lane[] = [];
  if (memory.length) lanes.push({ key: 'memory', title: 'App memory', hint: 'What iOS counts against the app', points: memory, fmt: fmtMB });
  if (headroom.length) {
    lanes.push({
      key: 'headroom',
      title: platform === 'android' ? 'System memory available' : 'Headroom',
      hint: platform === 'android' ? undefined : 'Before iOS stops the app',
      points: headroom,
      fmt: fmtMB,
    });
  }
  if (cpu.length) lanes.push({ key: 'cpu', title: 'CPU', hint: '100% is one core', points: cpu, fmt: fmtPct, minMax: 100 });
  if (power.length) lanes.push({ key: 'power', title: 'Battery power', points: power, fmt: (v) => `${fmtNum(v, 2)} W` });
  if (thermal.length) lanes.push({ key: 'thermal', title: 'Thermal state', hint: 'The phone throttles as it heats', thermal });
  return lanes;
}

function orderSpans(spans: Span[]) {
  const children = new Map<string, Span[]>();
  for (const sp of spans) {
    const key = sp.parentId ?? '';
    children.set(key, [...(children.get(key) ?? []), sp]);
  }
  const ids = new Set(spans.map((sp) => sp.id));
  const out: { span: Span; depth: number }[] = [];
  const walk = (parent: string, depth: number) => {
    for (const sp of [...(children.get(parent) ?? [])].sort((a, b) => a.start - b.start)) {
      out.push({ span: sp, depth });
      walk(sp.id, depth + 1);
    }
  };
  walk('', 0);
  for (const sp of spans) if (sp.parentId && !ids.has(sp.parentId)) out.push({ span: sp, depth: 0 });
  return out;
}

function nearest(points: Point[], t: number) {
  if (!points.length) return undefined;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t < t) lo = mid + 1;
    else hi = mid;
  }
  const b = points[lo]!;
  const a = points[lo - 1];
  return a && Math.abs(a.t - t) < Math.abs(b.t - t) ? a : b;
}

function niceStep(range: number, target: number) {
  const raw = range / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
}

type Props = {
  spans?: Span[];
  samples: MetricSample[];
  platform: string;
  /** Fixed window (live view); otherwise fits the data. */
  domain?: [number, number];
  now?: number;
  /** One row per span kind instead of one per span (for a busy live window). */
  groupByKind?: boolean;
};

const GROUP_ORDER: SpanKind[] = ['load', 'turn', 'generation', 'tool'];

/** Left column for row labels and y-axis values: the same in every card, so time lines up. */
const GUTTER = 132;
const RIGHT = 12;
const ROW_H = 22;
const LANE_H = 84;

type Scale = { t0: number; t1: number; live: boolean; now?: number };
type Hover = { t: number | null; set: (t: number | null) => void };

export function Timeline({ spans: allSpans = [], samples, platform, domain, now, groupByKind = false }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const [selected, setSelected] = useState<Span | null>(null);
  const [showTable, setShowTable] = useState(false);

  // In a fixed window, only spans that overlap it.
  const spans = domain ? allSpans.filter((sp) => (sp.end ?? now ?? sp.start) >= domain[0] && sp.start <= domain[1]) : allSpans;
  const lanes = lanesFrom(samples, platform);
  const starts = [...spans.map((sp) => sp.start), ...samples.map((s) => s.t)];
  const ends = [...spans.map((sp) => sp.end ?? now ?? sp.start), ...samples.map((s) => s.t)];
  const t0 = domain?.[0] ?? (starts.length ? Math.min(...starts) : 0);
  const t1 = domain?.[1] ?? Math.max(...ends, t0 + 1000);
  const scale: Scale = { t0, t1, live: !!domain, now };
  const hoverState: Hover = { t: hover, set: setHover };

  const rows = groupByKind ? [] : orderSpans(spans);

  return (
    <div className="flex flex-col gap-3">
      {spans.length ? (
        <ActivityCard
          spans={spans}
          rows={rows}
          groupByKind={groupByKind}
          scale={scale}
          hover={hoverState}
          selected={selected}
          onSelect={setSelected}
          showTable={showTable}
          onToggleTable={rows.length ? () => setShowTable((v) => !v) : undefined}
        />
      ) : null}

      {selected ? (
        <div key={selected.id} className="duration-200 animate-in fade-in slide-in-from-bottom-1 motion-reduce:animate-none">
          <KeyValues
            title={
              <span className="flex items-center gap-2">
                {KIND_LABEL[selected.kind] ?? selected.kind}: <span className="text-foreground">{selected.name}</span>
                <StatusChip status={selected.status} />
              </span>
            }
            rows={[
              ['Duration', fmtDur((selected.end ?? selected.start) - selected.start)],
              ...Object.entries(selected.attrs ?? {}).map(([k, v]): [string, string] => [k, v === null || v === undefined ? '–' : String(v)]),
            ]}
          />
        </div>
      ) : null}

      {showTable && rows.length ? (
        <div className="duration-200 animate-in fade-in slide-in-from-top-1 motion-reduce:animate-none">
          <Table
            label="Spans"
            rows={rows}
            rowId={({ span }) => span.id}
            rowLabel={({ span }) => span.name}
            columns={[
              { key: 'name', header: 'Span', cell: ({ span, depth }) => <span className="truncate" style={{ paddingLeft: depth * 12 }}>{span.name}</span> },
              { key: 'kind', header: 'Kind', width: 'w-28', cell: ({ span }) => <Chip>{KIND_LABEL[span.kind] ?? span.kind}</Chip> },
              { key: 'start', header: 'Starts at', width: 'w-28', align: 'end', cell: ({ span }) => `+${((span.start - rows[0]!.span.start) / 1000).toFixed(2)} s` },
              { key: 'dur', header: 'Duration', width: 'w-28', align: 'end', cell: ({ span }) => fmtDur((span.end ?? span.start) - span.start) },
              { key: 'status', header: 'Status', width: 'w-28', cell: ({ span }) => <StatusChip status={span.status} /> },
            ]}
          />
        </div>
      ) : null}

      {lanes.map((lane) =>
        'thermal' in lane ? (
          <ThermalCard key={lane.key} lane={lane} scale={scale} hover={hoverState} />
        ) : (
          <LaneCard key={lane.key} lane={lane} scale={scale} hover={hoverState} />
        )
      )}
    </div>
  );
}

// ── One card on the shared time axis ──────────────────────────────────────

const timeLabel = (scale: Scale, t: number) => (scale.live ? fmtClock(t) : `+${((t - scale.t0) / 1000).toFixed(1)} s · ${fmtClock(t)}`);

/**
 * A Shift frame holding one SVG plot on the shared time axis: the header strip
 * names the metric (and its current or peak value), the body draws `plot` with
 * time ticks underneath and the shared crosshair.
 */
function TimeCard({
  title,
  hint,
  meta,
  headerExtra,
  height,
  scale,
  hover,
  plot,
  tipAt,
}: {
  title: ReactNode;
  hint?: string;
  meta?: ReactNode;
  headerExtra?: ReactNode;
  height: number;
  scale: Scale;
  hover: Hover;
  plot: (ctx: { xs: (t: number) => number; W: number; top: number; bottom: number }) => ReactNode;
  tipAt: (t: number) => ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [tip, setTip] = useState<{ x: number; y: number; t: number } | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // Width only: drawing changes the height, which must not trigger a redraw.
    const ro = new ResizeObserver(() => setWidth((w) => (w === el.clientWidth ? w : el.clientWidth)));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const W = Math.max(320, width);
  const plotR = W - RIGHT;
  const { t0, t1 } = scale;
  const xs = (t: number) => GUTTER + ((t - t0) / (t1 - t0)) * (plotR - GUTTER);
  const tx = (x: number) => t0 + ((x - GUTTER) / (plotR - GUTTER)) * (t1 - t0);
  const top = 10;
  const bottom = top + height;
  const svgH = bottom + 22;
  const step = niceStep((t1 - t0) / 1000, Math.max(2, Math.floor((plotR - GUTTER) / 100)));
  const ticks: number[] = [];
  for (let sec = 0; t0 + sec * 1000 <= t1 && ticks.length < 60; sec += step) ticks.push(sec);
  const crossX = hover.t !== null && hover.t >= t0 && hover.t <= t1 ? xs(hover.t) : null;

  const onMove = (e: ReactPointerEvent<SVGRectElement>) => {
    const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const t = tx(((e.clientX - rect.left) / rect.width) * W);
    hover.set(t);
    setTip({ x: e.clientX, y: e.clientY, t });
  };
  const onLeave = () => {
    hover.set(null);
    setTip(null);
  };

  return (
    <Frame>
      <FrameHeader className="min-h-9 gap-3">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-foreground">{title}</span>
          {hint ? <span className="truncate text-xs font-normal">{hint}</span> : null}
        </span>
        {headerExtra}
        {meta ? <span className="ml-auto shrink-0 text-xs font-normal tabular-nums">{meta}</span> : null}
      </FrameHeader>
      <FrameBody>
        <div ref={wrapRef} className="px-3 pt-1">
          {width > 0 && (
            <svg className="timeline-svg block w-full touch-none" viewBox={`0 0 ${W} ${svgH}`} height={svgH} role="img" aria-label={typeof title === 'string' ? `${title} over time` : 'Chart over time'}>
              {ticks.map((sec) => {
                const x = xs(t0 + sec * 1000);
                return (
                  <g key={sec}>
                    <line stroke="var(--hairline)" x1={x} x2={x} y1={top} y2={bottom} />
                    <text x={x} y={bottom + 15} textAnchor="middle">
                      {scale.live ? `−${Math.round((t1 - (t0 + sec * 1000)) / 1000)}s` : `+${fmtNum(sec, step < 1 ? 1 : 0)}s`}
                    </text>
                  </g>
                );
              })}
              {/* Hover target under the marks, so bars keep their own tooltips. */}
              <rect x={GUTTER} y={top} width={Math.max(0, plotR - GUTTER)} height={height} fill="transparent" onPointerMove={onMove} onPointerLeave={onLeave} />
              {plot({ xs, W, top, bottom })}
              {crossX !== null ? <line stroke="var(--muted-foreground)" strokeWidth={1} pointerEvents="none" x1={crossX} x2={crossX} y1={top} y2={bottom} /> : null}
            </svg>
          )}
        </div>
      </FrameBody>
      {tip ? (
        <Tooltip x={tip.x} y={tip.y}>
          <div className="mb-1 text-subtle-foreground tabular-nums">{timeLabel(scale, tip.t)}</div>
          {tipAt(tip.t)}
        </Tooltip>
      ) : null}
    </Frame>
  );
}

// ── Activity: what the agent did ───────────────────────────────────────────

function ActivityCard({
  spans,
  rows,
  groupByKind,
  scale,
  hover,
  selected,
  onSelect,
  showTable,
  onToggleTable,
}: {
  spans: Span[];
  rows: { span: Span; depth: number }[];
  groupByKind: boolean;
  scale: Scale;
  hover: Hover;
  selected: Span | null;
  onSelect: (span: Span) => void;
  showTable: boolean;
  onToggleTable?: () => void;
}) {
  const [barTip, setBarTip] = useState<{ x: number; y: number; span: Span } | null>(null);
  const groups = groupByKind
    ? GROUP_ORDER.map((kind) => ({ kind, spans: spans.filter((sp) => sp.kind === kind) })).filter((g) => g.spans.length)
    : [];
  const lines: { key: string; label: string; depth: number; spans: Span[] }[] = groupByKind
    ? groups.map((g) => ({ key: g.kind, label: GROUP_LABEL[g.kind] ?? g.kind, depth: 0, spans: g.spans }))
    : rows.map(({ span, depth }) => ({ key: span.id, label: span.name, depth, spans: [span] }));
  const kinds = [...new Set(spans.map((sp) => sp.kind))].filter((k) => !groupByKind || GROUP_ORDER.includes(k));
  const replies = spans.filter((sp) => sp.kind === 'turn').length;

  const bar = (sp: Span, y: number, xs: (t: number) => number) => {
    const end = sp.end ?? scale.now ?? sp.start;
    const x = Math.max(GUTTER, xs(sp.start));
    const w = Math.max(3, Math.min(xs(scale.t1), xs(end)) - x);
    const bad = !!sp.status && sp.status !== 'ok';
    const isSelected = selected?.id === sp.id;
    return (
      <rect
        key={sp.id}
        className="cursor-pointer outline-none transition-opacity duration-150 hover:opacity-80 focus-visible:opacity-80 motion-reduce:transition-none"
        x={x}
        y={y + 5}
        width={w}
        height={12}
        rx={3}
        fill={kindColor(sp.kind)}
        stroke={bad ? 'var(--destructive)' : isSelected ? 'var(--foreground)' : undefined}
        strokeWidth={bad ? 2 : isSelected ? 1 : undefined}
        tabIndex={0}
        aria-label={`${KIND_LABEL[sp.kind] ?? sp.kind}: ${sp.name}, ${fmtDur(end - sp.start)}`}
        onPointerMove={(e) => setBarTip({ x: e.clientX, y: e.clientY, span: sp })}
        onPointerLeave={() => setBarTip(null)}
        onClick={() => onSelect(sp)}
        onKeyDown={(e) => e.key === 'Enter' && onSelect(sp)}
      />
    );
  };

  return (
    <>
      <TimeCard
        title="Activity"
        meta={replies ? `${replies} ${replies === 1 ? 'reply' : 'replies'}` : undefined}
        headerExtra={
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs font-normal">
            {kinds.map((k) => (
              <span key={k} className="flex items-center gap-1.5">
                <span aria-hidden="true" className="size-2 rounded-full" style={{ background: GROUP_ORDER.includes(k) ? kindColor(k) : 'var(--subtle-foreground)' }} />
                {KIND_LABEL[k] ?? k}
              </span>
            ))}
            {onToggleTable ? (
              <Button
                variant="ghost"
                size="xs"
                className={cn('text-subtle-foreground hover:text-foreground', showTable && 'bg-foreground/5 text-foreground')}
                aria-pressed={showTable}
                onClick={onToggleTable}>
                <TableCellsIcon aria-hidden="true" />
                Table
              </Button>
            ) : null}
          </span>
        }
        height={Math.max(1, lines.length) * ROW_H}
        scale={scale}
        hover={hover}
        tipAt={(t) => {
          const active = spans.filter((sp) => sp.kind !== 'run' && sp.start <= t && (sp.end ?? scale.now ?? sp.start) >= t);
          return active.length ? active.map((sp) => <div key={sp.id}>{sp.name}</div>) : <span className="text-subtle-foreground">Nothing running</span>;
        }}
        plot={({ xs, top }) =>
          lines.map((line, i) => {
            const y = top + i * ROW_H;
            const maxChars = Math.floor((GUTTER - 12 - line.depth * 10) / 6.5);
            const label = line.label.length > maxChars ? `${line.label.slice(0, maxChars - 1)}…` : line.label;
            return (
              <g key={line.key}>
                <text className="label-strong" x={line.depth * 10} y={y + 15}>
                  {label}
                </text>
                {line.spans.map((sp) => bar(sp, y, xs))}
              </g>
            );
          })
        }
      />
      {barTip ? (
        <Tooltip x={barTip.x} y={barTip.y}>
          <SpanTip span={barTip.span} />
        </Tooltip>
      ) : null}
    </>
  );
}

// ── Device metrics: one card each ──────────────────────────────────────────

function LaneCard({ lane, scale, hover }: { lane: Extract<Lane, { points: Point[] }>; scale: Scale; hover: Hover }) {
  const inView = lane.points.filter((p) => p.t >= scale.t0 && p.t <= scale.t1);
  const pts = inView.length ? inView : lane.points;
  const peak = pts.reduce((a, b) => (b.v > a.v ? b : a), pts[0]!);
  const last = pts.at(-1)!;
  const max = Math.max(lane.minMax ?? 0, ...pts.map((p) => p.v)) * 1.1 || 1;
  const ystep = niceStep(max, 3);
  const yTicks: number[] = [];
  for (let v = 0; v <= max && yTicks.length < 10; v += ystep) yTicks.push(v);

  return (
    <TimeCard
      title={lane.title}
      hint={lane.hint}
      meta={
        scale.live ? (
          <>
            Now <span className="text-foreground">{lane.fmt(last.v)}</span> · peak {lane.fmt(peak.v)}
          </>
        ) : (
          <>
            Peak <span className="text-foreground">{lane.fmt(peak.v)}</span>
          </>
        )
      }
      height={LANE_H}
      scale={scale}
      hover={hover}
      tipAt={(t) => {
        const p = nearest(lane.points, t);
        return p ? (
          <div className="flex items-center gap-2">
            <span className="font-medium tabular-nums">{lane.fmt(p.v)}</span>
            <span className="text-subtle-foreground">{lane.title}</span>
          </div>
        ) : null;
      }}
      plot={({ xs, top, bottom }) => {
        const ys = (v: number) => Math.max(top, Math.min(bottom, bottom - (v / max) * (bottom - top)));
        const d = inView.map((p, i) => `${i ? 'L' : 'M'}${xs(p.t).toFixed(1)},${ys(p.v).toFixed(1)}`).join('');
        return (
          <>
            {yTicks.map((v) => (
              <g key={v}>
                <line stroke="var(--hairline)" x1={GUTTER} x2={xs(scale.t1)} y1={ys(v)} y2={ys(v)} />
                <text x={GUTTER - 8} y={ys(v) + 4} textAnchor="end">
                  {lane.fmt(v)}
                </text>
              </g>
            ))}
            {d ? <path d={d} fill="none" stroke="var(--muted-foreground)" strokeWidth={1.5} strokeLinejoin="round" pointerEvents="none" /> : null}
            {peak.t >= scale.t0 && peak.t <= scale.t1 ? (
              <circle cx={xs(peak.t)} cy={ys(peak.v)} r={3.5} fill="var(--foreground)" stroke="var(--card)" strokeWidth={2} pointerEvents="none" />
            ) : null}
          </>
        );
      }}
    />
  );
}

function ThermalCard({ lane, scale, hover }: { lane: Extract<Lane, { thermal: unknown }>; scale: Scale; hover: Hover }) {
  // Consecutive samples in the same state become one labelled band.
  const runs: { state: string; t: number }[] = [];
  for (const p of lane.thermal) if (runs.at(-1)?.state !== p.state) runs.push({ state: p.state, t: p.t });
  const lastT = lane.thermal.at(-1)!.t;
  const current = lane.thermal.at(-1)!.state;
  const rank = (s: string) => ['nominal', 'fair', 'light', 'moderate', 'serious', 'severe', 'critical', 'emergency', 'shutdown'].indexOf(s);
  const hottest = runs.reduce((a, b) => (rank(b.state) > rank(a.state) ? b : a), runs[0]!).state;
  const stateAt = (t: number) => ([...lane.thermal].reverse().find((q) => q.t <= t) ?? lane.thermal[0])?.state;

  return (
    <TimeCard
      title={lane.title}
      hint={lane.hint}
      meta={
        scale.live ? (
          <>
            Now <span className="text-foreground">{THERMAL[current]?.[1] ?? current}</span>
          </>
        ) : (
          <>
            Hottest <span className="text-foreground">{THERMAL[hottest]?.[1] ?? hottest}</span>
          </>
        )
      }
      height={28}
      scale={scale}
      hover={hover}
      tipAt={(t) => {
        const s = stateAt(t);
        return s ? <span className="font-medium">{THERMAL[s]?.[1] ?? s}</span> : null;
      }}
      plot={({ xs, top }) =>
        runs.map((r, i) => {
          const x = xs(Math.max(r.t, scale.t0));
          const xEnd = xs(Math.min(runs[i + 1]?.t ?? lastT, scale.t1));
          if (xEnd <= x) return null;
          const [tone, label] = THERMAL[r.state] ?? ['', r.state];
          return (
            <g key={i} pointerEvents="none">
              <rect x={x} y={top + 2} width={xEnd - x} height={24} rx={6} fill={TONE_FILL[tone] ?? 'var(--muted)'} fillOpacity={TONE_FILL[tone] ? 0.18 : 1} />
              {xEnd - x > 56 ? (
                <text x={x + 8} y={top + 18} style={{ fill: TONE_FILL[tone] ?? 'var(--muted-foreground)', fontWeight: 500 }}>
                  {label}
                </text>
              ) : null}
            </g>
          );
        })
      }
    />
  );
}

function SpanTip({ span }: { span: Span }) {
  return (
    <div>
      <div className="text-subtle-foreground tabular-nums">
        {KIND_LABEL[span.kind] ?? span.kind} · {fmtDur((span.end ?? span.start) - span.start)}
      </div>
      <div className="mb-1 font-medium">{span.name}</div>
      {Object.entries(span.attrs ?? {})
        .filter(([, v]) => v !== null && v !== '')
        .slice(0, 8)
        .map(([k, v]) => {
          const text = String(v);
          return (
            <div className="flex gap-2" key={k}>
              <span className="shrink-0 text-subtle-foreground">{k}</span>
              <span className="min-w-0 break-words">{text.length > 90 ? `${text.slice(0, 90)}…` : text}</span>
            </div>
          );
        })}
      {span.status && span.status !== 'ok' ? <StatusChip status={span.status} /> : null}
    </div>
  );
}

/** Follows the pointer and stays inside the window. */
function Tooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x + 14, top: y + 14 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({ left: Math.min(x + 14, window.innerWidth - width - 8), top: Math.min(y + 14, window.innerHeight - height - 8) });
  }, [x, y, children]);
  return (
    <div ref={ref} role="tooltip" style={pos} className="pointer-events-none fixed z-50 max-w-sm rounded-lg bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-float">
      {children}
    </div>
  );
}
