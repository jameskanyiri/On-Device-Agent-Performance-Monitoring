'use client';

import { CheckIcon, ChevronDoubleRightIcon, ClockIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/20/solid';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import type { Scenario } from '@/shared/protocol';
import { Frame, FrameBody, FrameCell, FrameHeader, FrameRow } from '@/ui/frame';
import { Input } from '@/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip';
import { ago, clipText, fmtClock, fmtDate, fmtDur, fmtNum, isNum } from '../format';
import { Chip, ErrorState, KeyValues, LoadingState, Page, PassChip, Readings, Section, StatusChip, Table, ThermalChip } from '../ui';
import { usePoll } from '../use-poll';
import { EVAL_METRICS, mean, METRIC_GROUPS, spread, type EvalMetric } from './eval-metrics';
import { RunSheet } from './eval-run-panel';
import { SustainedSection } from './eval-sustained';
import { ColumnsMenu, FacetSidebar, IconButton, passesFacets, percentile, pick, useColumns, useFacets, WideTable, type ColumnDef, type FacetGroup } from './explorer-kit';

/*
 * One eval, laid out like a device's traces: pass rates beside the title,
 * each setup compared side by side, every task's repeats at a glance, then
 * all runs in an explorer. A run opens in a side panel like a thread does.
 */

type EvalRun = {
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
  prompt: string | null;
  reply: string | null;
  metrics: Record<string, number | string | boolean | undefined>;
};
type Session = {
  manifest: { suite: string; models: string[]; scenarios: string[]; tasks: string[]; reps: number; startedAt: string };
  scenarios: Scenario[];
  tasks: { id: string; title: string; needsTools: boolean }[];
  runs: EvalRun[];
  now: number;
  running: boolean;
  inFlight: string | null;
  environment: {
    devices: string[];
    os: string[];
    memoryGB: string[];
    cpuCores: string[];
    runtime: string[];
    modelFiles: string[];
    contextWindow: string[];
    app: string[];
    decoding: string[];
    protocol: { sampleMs: number; idleMs: number; settleMs: number; cooldownMaxMs: number; stableMs: number; backToBack: boolean; order: string };
  };
};

type Outcome = 'pass' | 'fail' | 'error' | 'timeout';
const outcome = (r: EvalRun): Outcome => (r.ok ? (r.pass ? 'pass' : 'fail') : /timed out/.test(r.error ?? '') ? 'timeout' : 'error');
const OUTCOME_LABEL: Record<Outcome, string> = { pass: 'Passed', fail: 'Failed', error: 'Error', timeout: 'Timed out' };

const passRate = (rs: EvalRun[]) => (rs.length ? (rs.filter((r) => r.pass).length / rs.length) * 100 : undefined);
const suiteTitle = (suite: string) => suite.charAt(0).toUpperCase() + suite.slice(1).replace(/-/g, ' ');

export function SessionView({ id }: { id: string }) {
  const { data, error } = usePoll<Session>(`/api/sessions/${encodeURIComponent(id)}`, 5000);
  // The open run lives in the URL (?run=…): links work, and Back closes the panel.
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openRun = params.get('run');
  const show = (jobId: string) => router.push(`${pathname}?run=${encodeURIComponent(jobId)}`, { scroll: false });
  if (error && !data) return <ErrorState error={error} />;
  if (!data) return <LoadingState />;

  const { manifest, scenarios, tasks, runs, now } = data;
  const label = (sid: string) => scenarios.find((s) => s.id === sid)?.label ?? sid;
  const ids = manifest.scenarios;
  const baseline = ids.includes('baseline') ? 'baseline' : ids[0]!;
  const others = ids.filter((s) => s !== baseline);
  const total = manifest.models.length * ids.length * manifest.tasks.length * manifest.reps;
  const taskTitle = (tid: string) => tasks.find((t) => t.id === tid)?.title ?? tid;
  const state = data.running ? 'running' : runs.length >= total ? 'complete' : 'incomplete';

  // Beside the title: pass rate per setup, and the change against the baseline.
  const rate = (sid: string) => passRate(runs.filter((r) => r.scenarioId === sid));
  const readings: [string, ReactNode][] = ids.map((sid) => {
    const rs = runs.filter((r) => r.scenarioId === sid);
    return [
      label(sid),
      <span key={sid}>
        {isNum(rate(sid)) ? `${Math.round(rate(sid)!)}%` : '–'}
        <span className="font-normal text-subtle-foreground">
          {' '}
          · {rs.filter((r) => r.pass).length}/{rs.length}
        </span>
      </span>,
    ];
  });
  for (const sid of others) readings.push([others.length > 1 ? `${label(sid)} change` : 'Change', <PointsDelta key={sid} base={rate(baseline)} value={rate(sid)} />]);

  return (
    <Page
      back={{ href: '/evals', label: 'Evals' }}
      title={
        <span className="flex items-center gap-2">
          <span className="truncate">{suiteTitle(manifest.suite)}</span>
          <Chip tone={state === 'running' ? 'success' : state === 'incomplete' ? 'warning' : 'neutral'}>{state === 'running' ? 'Running' : state === 'complete' ? 'Complete' : 'Stopped early'}</Chip>
        </span>
      }
      aside={runs.length ? <Readings items={readings} label="Pass rate by setup" /> : null}
      description={`${fmtDate(manifest.startedAt)} · ${manifest.models.join(', ')} · ${runs.length} of ${total} runs · ${manifest.reps} ${manifest.reps === 1 ? 'repeat' : 'repeats'} per task`}>
      {manifest.models.map((model) => {
        const forModel = runs.filter((r) => r.modelId === model);
        const title = (s: string) => (manifest.models.length > 1 ? `${s} · ${model}` : s);
        return (
          <div key={model} className="flex flex-col gap-6">
            <Section title={title('Compared')} meta={`Mean of completed runs, ± standard deviation · coefficient of variation · against ${label(baseline)}`}>
              <Comparison runs={forModel} ids={ids} baseline={baseline} label={label} />
            </Section>
            <Section title={title('By task')} meta="One mark per repeat · click one to open it">
              <TaskGrid
                runs={forModel}
                tasks={tasks.filter((t) => manifest.tasks.includes(t.id))}
                ids={ids}
                reps={manifest.reps}
                inFlight={data.inFlight}
                model={model}
                label={label}
                onOpen={show}
              />
            </Section>
          </div>
        );
      })}

      {runs.length ? (
        <Section title="Over the session" meta="Each run in the order it ran · tinted by the hottest state it reached">
          <SustainedSection runs={runs} ids={ids} label={label} />
        </Section>
      ) : null}

      <Section title="Runs">
        <RunExplorer runs={runs} models={manifest.models} label={label} taskTitle={taskTitle} now={now} onOpen={show} />
      </Section>

      <Section title="Environment" meta="What every run ran on, and how">
        <Environment env={data.environment} />
      </Section>

      <RunSheet
        sessionId={id}
        jobId={openRun}
        meta={(jobId) => {
          const r = runs.find((x) => x.jobId === jobId);
          return r ? { taskTitle: taskTitle(r.taskId), scenarioLabel: label(r.scenarioId), rep: r.rep } : null;
        }}
        onClose={() => router.push(pathname, { scroll: false })}
      />
    </Page>
  );
}

// ── Environment (the paper's hardware and software tables) ─────────────────

function Environment({ env }: { env: Session['environment'] }) {
  const list = (xs: string[], unit = '') => (xs.length ? xs.map((x) => `${x}${unit}`).join(' · ') : <span className="text-subtle-foreground">Not recorded (rebuild the app)</span>);
  const p = env.protocol;
  const between = p.backToBack
    ? 'Back to back: 1 s idle, no cool-down'
    : `Cool down ${fmtDur(p.settleMs)}, then until nominal${p.stableMs ? ` for ${fmtDur(p.stableMs)}` : ''} (at most ${fmtDur(p.cooldownMaxMs)}); ${fmtDur(p.idleMs)} idle baseline`;
  return (
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <KeyValues
        title="Hardware"
        rows={[
          ['Device', list(env.devices)],
          ['OS', list(env.os)],
          ['Memory', list(env.memoryGB, ' GB')],
          ['CPU cores', list(env.cpuCores)],
        ]}
      />
      <KeyValues
        title="Software"
        rows={[
          ['Runtime', list(env.runtime)],
          ['Model files', list(env.modelFiles)],
          ['Context window', list(env.contextWindow, ' tokens')],
          ['App', list(env.app)],
        ]}
      />
      <KeyValues
        title="Protocol"
        rows={[
          ['Decoding', list(env.decoding)],
          ['Between runs', between],
          ['Sampling', `Every ${fmtDur(p.sampleMs)}`],
          ['Order', p.order],
          ['Model', 'Loaded fresh for every run (cold); warm runs are not supported yet'],
        ]}
      />
    </div>
  );
}

// ── Changes against the baseline ───────────────────────────────────────────

/** Green when it's better, red when it costs, plain when neither. */
function Delta({ base, value, metric }: { base?: number; value?: number; metric: Pick<EvalMetric, 'fmt' | 'lowerIsBetter'> }) {
  if (!isNum(base) || !isNum(value)) return <span className="text-subtle-foreground">–</span>;
  const d = value - base;
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±';
  const better = metric.lowerIsBetter === undefined || d === 0 ? null : metric.lowerIsBetter ? d < 0 : d > 0;
  return (
    <span className={cn('truncate', better === null ? 'text-muted-foreground' : better ? 'text-success' : 'text-destructive')}>
      {sign}
      {metric.fmt(Math.abs(d))}
      {base !== 0 ? <span className="text-subtle-foreground"> {`${d >= 0 ? '+' : '−'}${Math.abs(Math.round((d / Math.abs(base)) * 100))}%`}</span> : null}
    </span>
  );
}

/** A mean with its spread under it (± sd · CV), and the range and count on hover, as the paper reports runs. */
function Spread({ xs, fmt }: { xs: number[]; fmt: (v: number) => string }) {
  const s = spread(xs);
  if (s.mean === undefined) return <span className="text-subtle-foreground">–</span>;
  const body = (
    <span className="flex flex-col items-end gap-0 leading-tight">
      <span>{fmt(s.mean)}</span>
      {s.sd !== undefined ? (
        <span className="text-xs text-subtle-foreground">
          ± {fmt(s.sd)}
          {s.cv !== undefined ? ` · ${Math.round(s.cv)}%` : ''}
        </span>
      ) : null}
    </span>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          {body}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {s.n} {s.n === 1 ? 'run' : 'runs'} · min {fmt(s.min!)} · max {fmt(s.max!)}
        {s.cv !== undefined ? ` · CV ${fmtNum(s.cv, 1)}%` : ''}
      </TooltipContent>
    </Tooltip>
  );
}

function PointsDelta({ base, value }: { base?: number; value?: number }) {
  if (!isNum(base) || !isNum(value)) return <span className="text-subtle-foreground">–</span>;
  const d = Math.round(value - base);
  return <span className={cn(d > 0 ? 'text-success' : d < 0 ? 'text-destructive' : 'text-muted-foreground')}>{`${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)} pts`}</span>;
}

/** Each group of numbers in its own card: the setups side by side, then the change. */
function Comparison({ runs, ids, baseline, label }: { runs: EvalRun[]; ids: string[]; baseline: string; label: (sid: string) => string }) {
  const others = ids.filter((s) => s !== baseline);
  const by = (sid: string) => runs.filter((r) => r.scenarioId === sid);
  const values = (sid: string, key: string) => by(sid).filter((r) => r.ok).map((r) => r.metrics[key]).filter(isNum);
  const avg = (sid: string, key: string) => mean(values(sid, key));
  const changeHeader = (sid: string) => (others.length > 1 ? `${label(sid)} change` : 'Change');

  type Row = { label: string; hint?: string; values: ReactNode[]; deltas: ReactNode[] };
  const quality: Row[] = [
    {
      label: 'Pass rate',
      values: ids.map((s) => (isNum(passRate(by(s))) ? `${Math.round(passRate(by(s))!)}%` : '–')),
      deltas: others.map((s) => <PointsDelta key={s} base={passRate(by(baseline))} value={passRate(by(s))} />),
    },
    {
      label: 'Runs',
      hint: 'Errors and time-outs in brackets',
      values: ids.map((s) => {
        const failed = by(s).filter((r) => !r.ok).length;
        return `${by(s).length}${failed ? ` (${failed})` : ''}`;
      }),
      deltas: others.map(() => null),
    },
  ];
  const groups: { title: string; rows: Row[] }[] = [
    { title: 'Quality', rows: quality },
    ...METRIC_GROUPS.map((g) => ({
      title: g,
      // Rows that are zero everywhere (e.g. time in a heat level never reached) say nothing.
      rows: EVAL_METRICS.filter((m) => m.group === g && ids.some((s) => isNum(avg(s, m.key))) && !(m.group === 'Heat' && ids.every((s) => !avg(s, m.key)))).map((m) => ({
        label: m.label,
        hint: m.hint,
        values: ids.map((s) => <Spread key={s} xs={values(s, m.key)} fmt={m.fmt} />),
        deltas: others.map((s) => <Delta key={s} base={avg(baseline, m.key)} value={avg(s, m.key)} metric={m} />),
      })),
    })),
  ].filter((g) => g.rows.length);

  return (
    <div className="grid items-start gap-4 xl:grid-cols-2">
      {groups.map((g) => (
        <Frame key={g.title} role="table" aria-label={g.title}>
          <FrameHeader className="px-0">
            <FrameRow>
              <FrameCell header className="text-foreground">
                {g.title}
              </FrameCell>
              {ids.map((s) => (
                <FrameCell key={s} header className="w-28 flex-none justify-end">
                  {label(s)}
                </FrameCell>
              ))}
              {others.map((s) => (
                <FrameCell key={s} header className="w-36 flex-none justify-end">
                  {changeHeader(s)}
                </FrameCell>
              ))}
            </FrameRow>
          </FrameHeader>
          <FrameBody>
            {g.rows.map((r) => (
              <FrameRow key={r.label}>
                <FrameCell className="flex-col items-start justify-center gap-0 py-1.5">
                  <span className="max-w-full truncate">{r.label}</span>
                  {r.hint ? <span className="max-w-full truncate text-xs text-subtle-foreground">{r.hint}</span> : null}
                </FrameCell>
                {r.values.map((v, i) => (
                  <FrameCell key={ids[i]} className="w-28 flex-none justify-end tabular-nums">
                    {v}
                  </FrameCell>
                ))}
                {r.deltas.map((d, i) => (
                  <FrameCell key={others[i]} className="w-36 flex-none justify-end tabular-nums">
                    {d}
                  </FrameCell>
                ))}
              </FrameRow>
            ))}
          </FrameBody>
        </Frame>
      ))}
    </div>
  );
}

// ── Tasks × setups ─────────────────────────────────────────────────────────

function TaskGrid({
  runs,
  tasks,
  ids,
  reps,
  inFlight,
  model,
  label,
  onOpen,
}: {
  runs: EvalRun[];
  tasks: Session['tasks'];
  ids: string[];
  reps: number;
  inFlight: string | null;
  model: string;
  label: (sid: string) => string;
  onOpen: (jobId: string) => void;
}) {
  return (
    <Frame role="table" aria-label="Results by task">
      <FrameHeader className="px-0">
        <FrameRow>
          <FrameCell header>Task</FrameCell>
          {ids.map((s) => (
            <FrameCell key={s} header className="w-56 flex-none">
              {label(s)}
            </FrameCell>
          ))}
        </FrameRow>
      </FrameHeader>
      <FrameBody>
        {tasks.map((t) => (
          <FrameRow key={t.id}>
            <FrameCell className="gap-2">
              <span className="truncate">{t.title}</span>
              {!t.needsTools ? <Chip>No tools needed</Chip> : null}
            </FrameCell>
            {ids.map((s) => {
              const rs = runs.filter((r) => r.scenarioId === s && r.taskId === t.id);
              const passed = rs.filter((r) => r.pass).length;
              return (
                <FrameCell key={s} className="w-56 flex-none gap-3">
                  <span className="flex items-center gap-1">
                    {Array.from({ length: reps }, (_, i) => {
                      const rep = i + 1;
                      const run = rs.find((r) => r.rep === rep);
                      const running = inFlight === `${model}__${s}__${t.id}__r${rep}`;
                      return <RepeatMark key={rep} run={run} rep={rep} running={running} onOpen={onOpen} />;
                    })}
                  </span>
                  {rs.length ? (
                    <span className={cn('text-xs tabular-nums', passed === rs.length ? 'text-success' : passed === 0 ? 'text-destructive' : 'text-muted-foreground')}>
                      {passed}/{rs.length}
                    </span>
                  ) : null}
                </FrameCell>
              );
            })}
          </FrameRow>
        ))}
      </FrameBody>
    </Frame>
  );
}

/** One repeat: ✓ passed, ✗ failed, ! error; hollow while it hasn't run, pulsing while it runs. */
function RepeatMark({ run, rep, running, onOpen }: { run?: EvalRun; rep: number; running: boolean; onOpen: (jobId: string) => void }) {
  if (!run) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            aria-label={`Repeat ${rep}: ${running ? 'running now' : 'not run yet'}`}
            className={cn('size-5 rounded-full outline-none hairline focus-visible:ring-[3px] focus-visible:ring-ring/50', running && 'animate-pulse bg-foreground/10 motion-reduce:animate-none')}
          />
        </TooltipTrigger>
        <TooltipContent>
          Repeat {rep} · {running ? 'running now' : 'not run yet'}
        </TooltipContent>
      </Tooltip>
    );
  }
  const o = outcome(run);
  const time = isNum(run.metrics.turnS) ? fmtDur(run.metrics.turnS * 1000) : null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onOpen(run.jobId)}
          aria-label={`Repeat ${rep}: ${OUTCOME_LABEL[o]}. Open the run`}
          className={cn(
            'flex size-5 items-center justify-center rounded-full outline-none transition-transform duration-150 hover:scale-110 focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none motion-reduce:hover:scale-100',
            o === 'pass' ? 'bg-success/15 text-success' : o === 'fail' ? 'bg-destructive/10 text-destructive' : 'bg-serious/10 text-serious'
          )}>
          {o === 'pass' ? <CheckIcon className="size-3.5" aria-hidden="true" /> : o === 'fail' ? <XMarkIcon className="size-3.5" aria-hidden="true" /> : <span aria-hidden="true" className="text-xs font-semibold">!</span>}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-80">
        Repeat {rep} · {OUTCOME_LABEL[o]}
        {time ? ` · ${time}` : ''}
        {o !== 'pass' ? <span className="mt-0.5 block opacity-80">{clipText(run.error ?? run.detail, 140)}</span> : null}
      </TooltipContent>
    </Tooltip>
  );
}

// ── Runs ───────────────────────────────────────────────────────────────────

type View = 'runs';
const DEFAULT_COLUMNS: Record<View, string[]> = {
  runs: ['result', 'task', 'setup', 'rep', 'turnS', 'firstTokenWallS', 'decodeTps', 'generatedTokens', 'toolCalls', 'memPeakMB', 'cpuPct', 'thermalMax', 'check'],
};

function RunExplorer({
  runs,
  models,
  label,
  taskTitle,
  now,
  onOpen,
}: {
  runs: EvalRun[];
  models: string[];
  label: (sid: string) => string;
  taskTitle: (tid: string) => string;
  now: number;
  onOpen: (jobId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [sidebar, setSidebar] = useState(true);
  const { facets, toggle, clear } = useFacets();
  const { columns, set, reset } = useColumns<View>('eval-run-columns', DEFAULT_COLUMNS);

  const q = query.trim().toLowerCase();
  const keys = (r: EvalRun): Record<string, string[]> => ({
    result: [outcome(r)],
    setup: [r.scenarioId],
    task: [r.taskId],
    model: models.length > 1 ? [r.modelId] : [],
    rep: [String(r.rep)],
  });
  const inScope = runs.filter((r) => !q || [taskTitle(r.taskId), r.taskId, r.detail, r.prompt, r.reply, r.error].some((s) => s?.toLowerCase().includes(q)));
  const shown = inScope.filter((r) => passesFacets(facets, keys(r))).sort((a, b) => b.startedAt - a.startedAt);
  const groups: FacetGroup[] = [
    { id: 'result', title: 'Result', label: (v) => OUTCOME_LABEL[v as Outcome] ?? v },
    { id: 'setup', title: 'Setup', label },
    { id: 'task', title: 'Task', label: taskTitle },
    { id: 'model', title: 'Model', label: (v) => v },
    { id: 'rep', title: 'Repeat', label: (v) => `Repeat ${v}` },
  ];

  // Slow marks, as on traces: over twice the typical (P50) task time, once there are enough to tell.
  const times = shown.map((r) => r.metrics.turnS).filter(isNum);
  const p50 = percentile(times, 50);
  const slow = p50 !== null && times.length >= 5 ? 2 * p50 : null;

  const dash = <span className="text-subtle-foreground">–</span>;
  const metricColumn = (m: EvalMetric): ColumnDef<EvalRun> => ({
    id: m.key,
    group: m.group,
    label: m.label,
    hint: m.hint,
    col: {
      width: m.label.length > 12 ? 'w-36' : 'w-28',
      align: 'end',
      cell: (r) => {
        const v = r.metrics[m.key];
        if (!isNum(v)) return dash;
        if (m.key === 'turnS')
          return (
            <Chip tone={slow !== null && v > slow ? 'serious' : 'neutral'} className="gap-1">
              <ClockIcon className="size-3" aria-hidden="true" />
              {m.fmt(v)}
            </Chip>
          );
        return m.fmt(v);
      },
    },
  });
  const defs: ColumnDef<EvalRun>[] = [
    {
      id: 'result',
      group: 'What happened',
      label: 'Result',
      col: { width: 'w-28', cell: (r) => (r.ok ? <PassChip pass={r.pass} /> : <StatusChip status={outcome(r)} />) },
    },
    { id: 'task', group: 'What happened', label: 'Task', col: { width: 'w-64', primary: true, cell: (r) => <span className="truncate">{taskTitle(r.taskId)}</span> } },
    { id: 'setup', group: 'What happened', label: 'Setup', col: { width: 'w-28', cell: (r) => <Chip>{label(r.scenarioId)}</Chip> } },
    { id: 'rep', group: 'What happened', label: 'Repeat', col: { width: 'w-20', align: 'end', cell: (r) => r.rep } },
    { id: 'model', group: 'What happened', label: 'Model', col: { width: 'w-28', cell: (r) => <span className="truncate text-muted-foreground">{r.modelId}</span> } },
    { id: 'start', group: 'What happened', label: 'Started', col: { width: 'w-24', cell: (r) => <span className="truncate text-muted-foreground" title={fmtDate(r.startedAt)}>{fmtClock(r.startedAt)}</span> } },
    { id: 'check', group: 'What happened', label: 'Check', hint: 'What the grader found', col: { width: 'w-72', cell: (r) => <span className={cn('truncate', r.pass ? 'text-muted-foreground' : 'text-destructive')}>{r.error ?? r.detail}</span> } },
    { id: 'prompt', group: 'What happened', label: 'Prompt', col: { width: 'w-64', cell: (r) => <span className="truncate text-muted-foreground">{r.prompt ?? '–'}</span> } },
    { id: 'reply', group: 'What happened', label: 'Reply', hint: 'The last turn’s', col: { width: 'w-64', cell: (r) => <span className="truncate text-muted-foreground">{r.reply || '–'}</span> } },
    ...EVAL_METRICS.map(metricColumn),
    // Where the phone started, to spot runs that began warm, low or charging.
    { id: 'startThermal', group: 'Where the phone started', label: 'Started at', hint: 'Thermal state before the model loaded', col: { width: 'w-28', cell: (r) => (typeof r.metrics.startThermal === 'string' ? <ThermalChip state={r.metrics.startThermal} /> : dash) } },
    { id: 'startBattery', group: 'Where the phone started', label: 'Battery at start', col: { width: 'w-32', align: 'end', cell: (r) => (isNum(r.metrics.startBattery) ? `${Math.round(r.metrics.startBattery * 100)}%${r.metrics.startCharging ? ' · charging' : ''}` : dash) } },
    { id: 'startLowPower', group: 'Where the phone started', label: 'Low Power Mode', col: { width: 'w-32', cell: (r) => (r.metrics.startLowPower === undefined ? dash : r.metrics.startLowPower ? 'On' : 'Off') } },
    { id: 'startBrightness', group: 'Where the phone started', label: 'Brightness', col: { width: 'w-28', align: 'end', cell: (r) => (isNum(r.metrics.startBrightness) ? `${Math.round(r.metrics.startBrightness * 100)}%` : dash) } },
    { id: 'temperature', group: 'Where the phone started', label: 'Temperature', hint: 'Decoding (0 = greedy)', col: { width: 'w-28', align: 'end', cell: (r) => (isNum(r.metrics.temperature) ? String(r.metrics.temperature) : dash) } },
    {
      id: 'thermalMax',
      group: 'Device impact',
      label: 'Hottest',
      col: { width: 'w-28', cell: (r) => (typeof r.metrics.thermalMax === 'string' ? <ThermalChip state={r.metrics.thermalMax} /> : dash) },
    },
  ];
  // Model speed etc. columns, ordered by group as the menu shows them.
  const order = ['What happened', ...METRIC_GROUPS, 'Where the phone started'];
  const sorted = [...defs].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));

  return (
    <div className="flex items-start gap-4">
      {sidebar ? <FacetSidebar groups={groups} source={inScope.map(keys)} facets={facets} onToggle={toggle} onClear={clear} onHide={() => setSidebar(false)} idPrefix="run-facet" /> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {!sidebar ? (
            <IconButton label="Show filters" onClick={() => setSidebar(true)}>
              <ChevronDoubleRightIcon aria-hidden="true" />
            </IconButton>
          ) : null}
          <div className="relative min-w-48 flex-1">
            <MagnifyingGlassIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle-foreground" />
            <Input aria-label="Search runs" placeholder="Search tasks, prompts, replies and checks" value={query} onChange={(e) => setQuery(e.target.value)} className="h-9 pl-9" />
          </div>
          <ColumnsMenu defs={sorted} shown={columns.runs} onChange={(ids) => set('runs', ids)} onReset={() => reset('runs')} />
        </div>
        <div className="flex min-h-6 flex-wrap items-center gap-2 text-xs text-subtle-foreground tabular-nums">
          <span>
            {shown.length} {shown.length === 1 ? 'run' : 'runs'}
          </span>
          {p50 !== null ? (
            <span>
              · P50 {fmtDur(p50 * 1000)} · P95 {fmtDur(percentile(times, 95)! * 1000)}
            </span>
          ) : null}
          {runs.length ? <span>· latest run {ago(Math.max(...runs.map((r) => r.startedAt)), now)}</span> : null}
        </div>
        <WideTable>
          <Table
            label="Runs"
            rows={shown}
            rowId={(r) => r.jobId}
            rowLabel={(r) => `${taskTitle(r.taskId)}, ${label(r.scenarioId)}, repeat ${r.rep}`}
            onOpen={(r) => onOpen(r.jobId)}
            empty={runs.length ? 'No runs match. Clear the filters or the search.' : 'No runs yet. Keep the phone on its Dashboard screen with evals connected.'}
            columns={pick(sorted, columns.runs)}
          />
        </WideTable>
      </div>
    </div>
  );
}
