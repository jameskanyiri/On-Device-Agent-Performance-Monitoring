'use client';

import { CheckIcon } from '@heroicons/react/20/solid';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import type { Scenario } from '@/shared/protocol';
import { clipText, fmtClock, fmtDate, fmtDur, fmtMB, fmtNum, fmtPct, isNum } from '../format';
import { ErrorState, LoadingState, Page, PassChip, Section, StatusChip, Table } from '../ui';
import { usePoll } from '../use-poll';

type RunRow = {
  jobId: string;
  modelId: string;
  scenarioId: string;
  taskId: string;
  rep: number;
  ok: boolean;
  error: string | null;
  startedAt: number;
  pass: boolean;
  detail: string;
  metrics: Record<string, number | string | boolean | undefined>;
};
type Session = {
  manifest: { suite: string; models: string[]; scenarios: string[]; tasks: string[]; reps: number; startedAt: string };
  scenarios: Scenario[];
  tasks: { id: string; title: string; needsTools: boolean }[];
  runs: RunRow[];
};

type Metric = { key: string; label: string; fmt: (v: number) => string; lowerIsBetter?: boolean };

const METRICS: Metric[] = [
  { key: 'turnS', label: 'Task time', fmt: (v) => fmtDur(v * 1000), lowerIsBetter: true },
  { key: 'initTokens', label: 'Prompt tokens at start', fmt: (v) => fmtNum(v), lowerIsBetter: true },
  { key: 'firstTokenWallS', label: 'First token', fmt: (v) => fmtDur(v * 1000), lowerIsBetter: true },
  { key: 'decodeTps', label: 'Decode speed (tokens/s)', fmt: (v) => fmtNum(v, 1), lowerIsBetter: false },
  { key: 'modelCalls', label: 'Model calls', fmt: (v) => fmtNum(v, 1), lowerIsBetter: true },
  { key: 'generatedTokens', label: 'Tokens generated', fmt: (v) => fmtNum(v), lowerIsBetter: true },
  { key: 'toolCalls', label: 'Tool calls', fmt: (v) => fmtNum(v, 1) },
  { key: 'memPeakMB', label: 'Peak memory', fmt: fmtMB, lowerIsBetter: true },
  { key: 'memAvailMinMB', label: 'Lowest headroom', fmt: fmtMB, lowerIsBetter: false },
  { key: 'cpuPct', label: 'CPU', fmt: fmtPct, lowerIsBetter: true },
  { key: 'thermalElevatedS', label: 'Time above nominal heat', fmt: (v) => fmtDur(v * 1000), lowerIsBetter: true },
  { key: 'energyJ', label: 'Energy (J)', fmt: (v) => fmtNum(v, 1), lowerIsBetter: true },
  { key: 'joulesPerToken', label: 'Energy per token (J)', fmt: (v) => fmtNum(v, 3), lowerIsBetter: true },
];

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

/** A change against the baseline: green when it's better, red when it costs, plain when neutral. */
function Delta({ base, value, metric, points }: { base?: number; value?: number; metric: Pick<Metric, 'fmt' | 'lowerIsBetter'>; points?: boolean }) {
  if (!isNum(base) || !isNum(value)) return <span className="text-subtle-foreground">–</span>;
  const d = value - base;
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±';
  const better = metric.lowerIsBetter === undefined || d === 0 ? null : metric.lowerIsBetter ? d < 0 : d > 0;
  return (
    <span className={cn(better === null ? 'text-muted-foreground' : better ? 'text-success' : 'text-destructive')}>
      {points ? `${sign}${Math.abs(Math.round(d))} pts` : `${sign}${metric.fmt(Math.abs(d))}`}
      {!points && base !== 0 ? <span className="text-subtle-foreground"> ({`${d >= 0 ? '+' : ''}${Math.round((d / Math.abs(base)) * 100)}%`})</span> : null}
    </span>
  );
}

export function SessionView({ id }: { id: string }) {
  const { data, error } = usePoll<Session>(`/api/sessions/${encodeURIComponent(id)}`, 5000);
  if (error && !data) return <ErrorState error={error} />;
  if (!data) return <LoadingState />;
  const { manifest, scenarios, tasks, runs } = data;
  const label = (sid: string) => scenarios.find((s) => s.id === sid)?.label ?? sid;
  const ids = manifest.scenarios;
  const baseline = ids.includes('baseline') ? 'baseline' : ids[0]!;
  const others = ids.filter((s) => s !== baseline);
  const total = manifest.models.length * ids.length * manifest.tasks.length * manifest.reps;

  return (
    <Page
      back={{ href: '/traces', label: 'Traces' }}
      title={`Benchmark: ${manifest.suite}`}
      description={`${fmtDate(manifest.startedAt)} · ${manifest.models.join(', ')} · ${runs.length} of ${total} runs · ${manifest.reps} ${manifest.reps === 1 ? 'repeat' : 'repeats'}`}>
      {manifest.models.map((model) => {
        const forModel = runs.filter((r) => r.modelId === model);
        const by = (sid: string) => forModel.filter((r) => r.scenarioId === sid);
        const avg = (sid: string, key: string) => mean(by(sid).filter((r) => r.ok).map((r) => r.metrics[key]).filter(isNum));
        const passRate = (sid: string) => {
          const rs = by(sid);
          return rs.length ? (rs.filter((r) => r.pass).length / rs.length) * 100 : undefined;
        };
        type Row = { label: string; values: Record<string, ReactNode>; deltas: Record<string, ReactNode> };
        const rows: Row[] = [
          {
            label: 'Pass rate',
            values: Object.fromEntries(ids.map((s) => [s, fmtPct(passRate(s))])),
            deltas: Object.fromEntries(others.map((s) => [s, <Delta key={s} base={passRate(baseline)} value={passRate(s)} metric={{ fmt: String, lowerIsBetter: false }} points />])),
          },
          {
            label: 'Runs (failed)',
            values: Object.fromEntries(ids.map((s) => [s, `${by(s).length} (${by(s).filter((r) => !r.ok).length})`])),
            deltas: {},
          },
          ...METRICS.filter((m) => ids.some((s) => isNum(avg(s, m.key)))).map((m) => ({
            label: m.label,
            values: Object.fromEntries(
              ids.map((s) => {
                const v = avg(s, m.key);
                return [s, isNum(v) ? m.fmt(v) : '–'];
              })
            ),
            deltas: Object.fromEntries(others.map((s) => [s, <Delta key={s} base={avg(baseline, m.key)} value={avg(s, m.key)} metric={m} />])),
          })),
        ];
        return (
          <div key={model} className="flex flex-col gap-6">
            <Section title={`${model}: scenarios`} meta="Averages of completed runs">
              <Table
                label={`${model} scenarios`}
                rows={rows}
                rowId={(r) => r.label}
                rowLabel={(r) => r.label}
                columns={[
                  { key: 'metric', header: 'Metric', cell: (r) => <span className="truncate text-muted-foreground">{r.label}</span> },
                  ...ids.map((s) => ({ key: s, header: label(s), width: 'w-36', align: 'end' as const, cell: (r: Row) => r.values[s] })),
                  ...others.map((s) => ({ key: `d-${s}`, header: `${label(s)} vs ${label(baseline)}`, width: 'w-56', align: 'end' as const, cell: (r: Row) => r.deltas[s] ?? '' })),
                ]}
              />
            </Section>
            <Section title={`${model}: pass rate by task`}>
              <Table
                label={`${model} pass rate by task`}
                rows={tasks.filter((t) => manifest.tasks.includes(t.id))}
                rowId={(t) => t.id}
                rowLabel={(t) => t.title}
                columns={[
                  {
                    key: 'task',
                    header: 'Task',
                    cell: (t) => (
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{t.title}</span>
                        <span className="truncate font-mono text-xs text-subtle-foreground">{t.id}</span>
                      </span>
                    ),
                  },
                  ...ids.map((s) => ({
                    key: s,
                    header: label(s),
                    width: 'w-36',
                    align: 'end' as const,
                    cell: (t: Session['tasks'][number]) => {
                      const rs = by(s).filter((r) => r.taskId === t.id);
                      if (!rs.length) return <span className="text-subtle-foreground">–</span>;
                      const passed = rs.filter((r) => r.pass).length;
                      return (
                        <span className={cn('flex items-center gap-1', passed === rs.length ? 'text-success' : passed === 0 ? 'text-muted-foreground' : '')}>
                          {passed === rs.length ? <CheckIcon className="size-4" aria-hidden="true" /> : null}
                          {passed}/{rs.length}
                        </span>
                      );
                    },
                  })),
                ]}
              />
            </Section>
          </div>
        );
      })}

      <Section title="Runs" meta={`${runs.length}`}>
        <Table
          label="Runs"
          rows={[...runs].sort((a, b) => b.startedAt - a.startedAt)}
          rowId={(r) => r.jobId}
          rowLabel={(r) => `${label(r.scenarioId)} ${r.taskId} repeat ${r.rep}`}
          href={(r) => `/sessions/${encodeURIComponent(id)}/runs/${encodeURIComponent(r.jobId)}`}
          empty="No runs yet. Keep the phone on its Benchmark screen."
          columns={[
            {
              key: 'task',
              header: 'Task',
              primary: true,
              cell: (r) => (
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{r.taskId}</span>
                  <span className="truncate text-subtle-foreground">{label(r.scenarioId)}</span>
                </span>
              ),
            },
            { key: 'rep', header: 'Repeat', width: 'w-20', align: 'end', cell: (r) => r.rep },
            { key: 'result', header: 'Result', width: 'w-28', cell: (r) => (r.ok ? <PassChip pass={r.pass} /> : <StatusChip status={/timed out/.test(r.error ?? '') ? 'timeout' : 'error'} />) },
            { key: 'time', header: 'Task time', width: 'w-24', align: 'end', cell: (r) => (isNum(r.metrics.turnS) ? fmtDur(r.metrics.turnS * 1000) : '–') },
            { key: 'tools', header: 'Tool calls', width: 'w-24', align: 'end', cell: (r) => fmtNum(r.metrics.toolCalls as number) },
            { key: 'memory', header: 'Peak memory', width: 'w-28', align: 'end', cell: (r) => fmtMB(r.metrics.memPeakMB as number) },
            { key: 'note', header: 'Note', cell: (r) => <span className="truncate text-muted-foreground">{r.pass ? fmtClock(r.startedAt) : clipText(r.detail, 80)}</span> },
          ]}
        />
      </Section>
    </Page>
  );
}
