'use client';

import { useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { Frame, FrameBody, FrameHeader } from '@/ui/frame';
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group';
import { fmtNum, fmtPct, isNum } from '../format';
import { Readings, ThermalChip } from '../ui';
import { EVAL_METRICS } from './eval-metrics';
import { THERMAL_ORDER } from './explorer-kit';

/*
 * An eval over time, as the paper (arXiv 2603.23640, Fig. 4) shows sustained
 * load: one point per run in the order they ran, the background tinted by how
 * hot the phone got, with peak against plateau, when it first warmed up, and
 * what the session took from the battery.
 */

export type SustainedRun = {
  jobId: string;
  scenarioId: string;
  taskId: string;
  startedAt: number;
  ok: boolean;
  metrics: Record<string, number | string | boolean | undefined>;
};

const SERIES = ['decodeTps', 'prefillTps', 'turnS', 'memPeakMB', 'cpuPct'] as const;
const SERIES_LABEL: Record<(typeof SERIES)[number], string> = {
  decodeTps: 'Decode speed',
  prefillTps: 'Reading speed',
  turnS: 'Task time',
  memPeakMB: 'Peak memory',
  cpuPct: 'CPU',
};
const SETUP_COLORS = ['var(--span-generation)', 'var(--span-tool)', 'var(--span-load)', 'var(--span-turn)'];

/** Thermal level 0–4 shared by both platforms (Android's light counts as fair, severe as serious). */
const level = (state: unknown) => {
  if (typeof state !== 'string') return 0;
  const map: Record<string, number> = { nominal: 0, fair: 1, light: 1, moderate: 2, serious: 3, severe: 3, critical: 4, emergency: 4, shutdown: 4 };
  return map[state] ?? 0;
};
const LEVEL_TINT = ['transparent', 'color-mix(in oklab, var(--warning) 12%, transparent)', 'color-mix(in oklab, var(--serious) 12%, transparent)', 'color-mix(in oklab, var(--serious) 20%, transparent)', 'color-mix(in oklab, var(--destructive) 20%, transparent)'];
const LEVEL_LABEL = ['Nominal', 'Fair', 'Moderate', 'Serious', 'Critical'];

/** Peak, plateau (median of the last third, at least 3 runs) and the drop between them. */
export function peakPlateau(values: number[], higherIsBetter: boolean) {
  if (values.length < 3) return null;
  const peak = higherIsBetter ? Math.max(...values) : Math.min(...values);
  const tail = values.slice(-Math.max(3, Math.ceil(values.length / 3))).sort((a, b) => a - b);
  const mid = Math.floor(tail.length / 2);
  const plateau = tail.length % 2 ? tail[mid]! : (tail[mid - 1]! + tail[mid]!) / 2;
  return { peak, plateau, dropPct: peak ? ((higherIsBetter ? peak - plateau : plateau - peak) / Math.abs(peak)) * 100 : 0 };
}

/** Battery used over the session, and how many runs a full charge would last at that rate. Null if it charged. */
export function batteryProjection(runs: SustainedRun[]) {
  const ordered = [...runs].sort((a, b) => a.startedAt - b.startedAt);
  if (!ordered.length || ordered.some((r) => r.metrics.charging === true)) return null;
  const start = ordered.map((r) => r.metrics.batteryStart).find(isNum);
  const end = [...ordered].reverse().map((r) => r.metrics.batteryEnd).find(isNum);
  if (!isNum(start) || !isNum(end)) return null;
  const used = start - end;
  return { usedPct: used * 100, runs: ordered.length, perCharge: used > 0 ? ordered.length / used : null };
}

export function SustainedSection({ runs, ids, label }: { runs: SustainedRun[]; ids: string[]; label: (sid: string) => string }) {
  const [series, setSeries] = useState<(typeof SERIES)[number]>('decodeTps');
  const ordered = [...runs].sort((a, b) => a.startedAt - b.startedAt);
  const metric = EVAL_METRICS.find((m) => m.key === series)!;
  const higherIsBetter = metric.lowerIsBetter === false;
  const points = ordered.map((r, i) => ({ i: i + 1, run: r, v: r.metrics[series], heat: level(r.metrics.thermalMax) })).filter((p): p is typeof p & { v: number } => isNum(p.v));
  const pp = peakPlateau(points.map((p) => p.v), higherIsBetter);
  const firstWarm = ordered.findIndex((r) => level(r.metrics.thermalMax) > 0);
  const hottest = ordered.map((r) => r.metrics.thermalMax).reduce<string | null>((a, b) => (typeof b === 'string' && (!a || THERMAL_ORDER.indexOf(b) > THERMAL_ORDER.indexOf(a)) ? b : a), null);
  const battery = batteryProjection(ordered);

  // Output length should be identical across repeats when decoding is greedy: flag where it isn't.
  const greedy = ordered.length > 0 && ordered.every((r) => r.metrics.temperature === 0);
  const varying = greedy
    ? [...new Set(ordered.map((r) => `${r.scenarioId}|${r.taskId}`))].filter((k) => {
        const lens = new Set(ordered.filter((r) => `${r.scenarioId}|${r.taskId}` === k && r.ok).map((r) => r.metrics.generatedTokens));
        return lens.size > 1;
      }).length
    : null;

  const readings: [string, ReactNode][] = [
    ['Peak', pp ? metric.fmt(pp.peak) : '–'],
    ['Plateau', pp ? metric.fmt(pp.plateau) : '–'],
    ['Change at plateau', pp ? <span className={cn(pp.dropPct > 5 && 'text-serious')}>{pp.dropPct > 0 ? `−${fmtNum(pp.dropPct, 1)}%` : `${fmtNum(-pp.dropPct, 1)}%`}</span> : '–'],
    ['First warmer', firstWarm >= 0 ? `Run ${firstWarm + 1}` : ordered.length ? 'Stayed nominal' : '–'],
    ['Hottest', hottest ? <ThermalChip key="h" state={hottest} /> : '–'],
    ['Battery used', battery ? `${fmtPct(battery.usedPct)} · ${battery.runs} runs` : ordered.some((r) => r.metrics.charging === true) ? 'Charging' : '–'],
    ['Runs per charge', battery?.perCharge ? `≈ ${fmtNum(battery.perCharge)}` : '–'],
  ];
  if (varying !== null) readings.push(['Output length', varying ? <span className="text-serious">{varying} tasks vary</span> : 'Identical (greedy)']);

  return (
    <div className="flex flex-col gap-3">
      <Readings items={readings} label="Sustained use" />
      <Frame>
        <FrameHeader className="flex-wrap justify-between gap-2">
          <span className="flex flex-wrap items-center gap-3 text-xs font-normal">
            {ids.map((sid, i) => (
              <span key={sid} className="flex items-center gap-1.5">
                <span aria-hidden="true" className="size-2 rounded-full" style={{ background: SETUP_COLORS[i % SETUP_COLORS.length] }} />
                {label(sid)}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-0 w-4 border-t border-dashed border-foreground/50" />
              Plateau
            </span>
            {LEVEL_LABEL.slice(1).map((name, i) =>
              ordered.some((r) => level(r.metrics.thermalMax) === i + 1) ? (
                <span key={name} className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="size-3 rounded-sm" style={{ background: LEVEL_TINT[i + 1] }} />
                  {name}
                </span>
              ) : null
            )}
          </span>
          <ToggleGroup type="single" variant="outline" size="sm" value={series} onValueChange={(v) => v && setSeries(v as typeof series)} aria-label="Metric over the session">
            {SERIES.map((k) => (
              <ToggleGroupItem key={k} value={k} className="text-xs data-[state=on]:bg-foreground/[0.07]">
                {SERIES_LABEL[k]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </FrameHeader>
        <FrameBody>
          {points.length ? (
            <TrendChart points={points} ids={ids} total={ordered.length} plateau={pp?.plateau ?? null} fmt={metric.fmt} label={label} title={SERIES_LABEL[series]} />
          ) : (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">No runs with this measurement yet.</p>
          )}
        </FrameBody>
      </Frame>
    </div>
  );
}

const W = 1000;
const H = 240;
const PAD = { l: 64, r: 16, t: 14, b: 30 };

function TrendChart({
  points,
  ids,
  total,
  plateau,
  fmt,
  label,
  title,
}: {
  points: { i: number; run: SustainedRun; v: number; heat: number }[];
  ids: string[];
  total: number;
  plateau: number | null;
  fmt: (v: number) => string;
  label: (sid: string) => string;
  title: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const values = points.map((p) => p.v);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const span = hi - lo || Math.abs(hi) || 1;
  lo -= span * 0.12;
  hi += span * 0.12;
  if (lo < 0 && Math.min(...values) >= 0) lo = 0;
  const x = (i: number) => PAD.l + ((i - 0.5) / total) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const band = (W - PAD.l - PAD.r) / total;
  const ticks = [lo, (lo + hi) / 2, hi];
  const xTicks = total <= 12 ? Array.from({ length: total }, (_, k) => k + 1) : Array.from({ length: 6 }, (_, k) => Math.max(1, Math.round(1 + (k * (total - 1)) / 5)));
  const hovered = points.find((p) => p.i === hover);

  return (
    <div className="relative px-1 py-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-60 w-full" role="img" aria-label={`${title} for each run, in the order they ran`} onMouseLeave={() => setHover(null)}>
        {/* Heat: each run's slot tinted by the hottest state it reached. */}
        {points.map((p) => (p.heat ? <rect key={`h${p.i}`} x={x(p.i) - band / 2} y={PAD.t} width={band} height={H - PAD.t - PAD.b} fill={LEVEL_TINT[p.heat]} /> : null))}
        {ticks.map((t, k) => (
          <g key={k}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={0.08} />
            <text x={PAD.l - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-subtle-foreground text-[11px] tabular-nums">
              {fmt(t)}
            </text>
          </g>
        ))}
        {xTicks.map((i) => (
          <text key={i} x={x(i)} y={H - 10} textAnchor="middle" className="fill-subtle-foreground text-[11px] tabular-nums">
            {i}
          </text>
        ))}
        {plateau !== null ? <line x1={PAD.l} x2={W - PAD.r} y1={y(plateau)} y2={y(plateau)} stroke="currentColor" strokeOpacity={0.5} strokeDasharray="5 4" /> : null}
        <polyline points={points.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth={1.5} />
        {points.map((p) => (
          <circle
            key={p.i}
            cx={x(p.i)}
            cy={y(p.v)}
            r={hover === p.i ? 6 : 4.5}
            fill={p.run.ok ? SETUP_COLORS[Math.max(0, ids.indexOf(p.run.scenarioId)) % SETUP_COLORS.length] : 'transparent'}
            stroke={SETUP_COLORS[Math.max(0, ids.indexOf(p.run.scenarioId)) % SETUP_COLORS.length]}
            strokeWidth={1.5}
          />
        ))}
        {/* Hit areas: a whole slot per run. */}
        {points.map((p) => (
          <rect key={`hit${p.i}`} x={x(p.i) - band / 2} y={0} width={band} height={H} fill="transparent" onMouseEnter={() => setHover(p.i)} />
        ))}
      </svg>
      <p className="px-2 text-center text-xs text-subtle-foreground">Run, in the order it ran</p>
      {hovered ? (
        <div
          className="pointer-events-none absolute top-2 rounded-lg bg-popover px-2.5 py-1.5 text-xs shadow-float"
          style={{ left: `clamp(8px, calc(${(x(hovered.i) / W) * 100}% - 90px), calc(100% - 188px))` }}>
          <div className="font-medium">
            Run {hovered.i} · {fmt(hovered.v)}
          </div>
          <div className="text-subtle-foreground">
            {label(hovered.run.scenarioId)} · {hovered.run.taskId}
          </div>
          <div className="text-subtle-foreground">Hottest: {LEVEL_LABEL[hovered.heat]}</div>
        </div>
      ) : null}
    </div>
  );
}
