import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { RunResult } from '@/shared/protocol';
import type { CheckOutcome, Task } from './checks';
import { summarizeRun, type RunMetrics } from './metrics';
import { OUTCOMES, runOutcome, toolRepeats, type RunOutcome } from './outcome';
import { BASELINE_ID, SCENARIOS } from './scenarios';
import { SUITES } from './suites';

/*
 * Builds report.md and runs.csv for a benchmark session folder. Metrics and
 * checks are recomputed from the raw runs every time, so editing a check or a
 * metric updates old sessions too (the dashboard always recomputes).
 */

export type Manifest = {
  sessionId: string;
  suite: string;
  models: string[];
  scenarios: string[];
  tasks: string[];
  reps: number;
  startedAt: string;
  options: Record<string, unknown>;
};

export type ScoredRun = {
  run: RunResult;
  task?: Task;
  metrics: RunMetrics;
  check: CheckOutcome;
  outcome: RunOutcome;
  /** Tool calls repeated with the same arguments, and whether that became a doom loop. */
  repeats: number;
  looped: boolean;
};

export function scoreRun(run: RunResult, suite: Task[]): ScoredRun {
  const task = suite.find((t) => t.id === run.taskId);
  const metrics = summarizeRun(run);
  let check: CheckOutcome;
  if (!run.ok) check = { pass: false, detail: `run failed: ${run.error}` };
  else if (!task) check = { pass: false, detail: `unknown task ${run.taskId}` };
  else {
    try {
      check = task.check(run);
    } catch (e) {
      check = { pass: false, detail: `check threw: ${String(e)}` };
    }
  }
  return { run, task, metrics, check, outcome: runOutcome(run, check), ...toolRepeats(run.tools) };
}

export function loadRuns(dir: string): RunResult[] {
  const runsDir = join(dir, 'runs');
  return readdirSync(runsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(runsDir, f), 'utf8')) as RunResult);
}

// ── Formatting ─────────────────────────────────────────────────────────────

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
const sd = (xs: number[]) => {
  const m = mean(xs);
  if (m === undefined || xs.length < 2) return undefined;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
/** A metric across the runs that completed (failed runs count only in pass rate and failures). */
const values = (runs: ScoredRun[], pick: (m: RunMetrics) => number | undefined) =>
  runs.filter((r) => r.run.ok).map((r) => pick(r.metrics)).filter((x): x is number => x !== undefined && Number.isFinite(x));

function fmt(x: number | undefined, digits = 1): string {
  if (x === undefined) return '–';
  return x.toFixed(digits);
}
function fmtMeanSd(xs: number[], digits = 1): string {
  const m = mean(xs);
  if (m === undefined) return '–';
  const s = sd(xs);
  return s === undefined ? fmt(m, digits) : `${fmt(m, digits)} ± ${fmt(s, digits)}`;
}
function fmtDelta(base: number | undefined, x: number | undefined, digits = 1, unit = ''): string {
  if (base === undefined || x === undefined) return '–';
  const d = x - base;
  const pct = base !== 0 ? ` (${d >= 0 ? '+' : ''}${Math.round((d / Math.abs(base)) * 100)}%)` : '';
  return `${d >= 0 ? '+' : ''}${d.toFixed(digits)}${unit}${pct}`;
}
const pct = (x: number | undefined) => (x === undefined ? '–' : `${Math.round(x * 100)}%`);
const table = (header: string[], rows: string[][]) =>
  [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');

/** The metrics shown per scenario, and how they compare. */
const COLUMNS: { label: string; pick: (m: RunMetrics) => number | undefined; digits: number; unit?: string }[] = [
  { label: 'Load (s)', pick: (m) => m.loadS, digits: 1, unit: ' s' },
  { label: 'Prompt tokens at start', pick: (m) => m.initTokens, digits: 0 },
  { label: 'Task time (s)', pick: (m) => m.turnS, digits: 1, unit: ' s' },
  { label: 'First token (s)', pick: (m) => m.firstTokenWallS, digits: 2, unit: ' s' },
  { label: 'Decode (tok/s)', pick: (m) => m.decodeTps, digits: 1 },
  { label: 'Model calls', pick: (m) => m.modelCalls, digits: 1 },
  { label: 'Prompt tokens', pick: (m) => m.promptTokens, digits: 0 },
  { label: 'Generated tokens', pick: (m) => m.generatedTokens, digits: 0 },
  { label: 'Context used', pick: (m) => m.kvPeak, digits: 0 },
  { label: 'Tool calls', pick: (m) => m.toolCalls, digits: 1 },
  { label: 'Peak memory (MB)', pick: (m) => m.memPeakMB, digits: 0, unit: ' MB' },
  { label: 'Memory added (MB)', pick: (m) => m.memDeltaMB, digits: 0, unit: ' MB' },
  { label: 'Min headroom (MB)', pick: (m) => m.memAvailMinMB, digits: 0, unit: ' MB' },
  { label: 'CPU (%)', pick: (m) => m.cpuPct, digits: 0, unit: '%' },
  { label: 'Hot time (s)', pick: (m) => m.thermalElevatedS, digits: 0, unit: ' s' },
  { label: 'Power (W)', pick: (m) => m.powerActiveW, digits: 2, unit: ' W' },
  { label: 'Energy (J)', pick: (m) => m.energyJ, digits: 1, unit: ' J' },
  { label: 'Energy above idle (J)', pick: (m) => m.energyAboveIdleJ, digits: 1, unit: ' J' },
  { label: 'J / token', pick: (m) => m.joulesPerToken, digits: 3 },
];

export function buildReport(dir: string): string {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest;
  const suite = SUITES[manifest.suite] ?? [];
  const scored = loadRuns(dir).map((run) => scoreRun(run, suite));
  if (!scored.length) return '# Benchmark report\n\nNo runs yet.\n';

  const scenarioLabel = (id: string) => SCENARIOS.find((s) => s.id === id)?.label ?? id;
  const scenarioIds = [...new Set(scored.map((r) => r.run.scenarioId))].sort(
    (a, b) => (a === BASELINE_ID ? -1 : b === BASELINE_ID ? 1 : a.localeCompare(b))
  );
  const models = [...new Set(scored.map((r) => r.run.modelId))];
  const tasks = suite.filter((t) => scored.some((r) => r.run.taskId === t.id));
  const device = scored[0]!.run.device;
  const passRate = (rs: ScoredRun[]) => (rs.length ? rs.filter((r) => r.check.pass).length / rs.length : undefined);

  const out: string[] = [];
  out.push(`# Benchmark report: ${manifest.suite}`);
  out.push('');
  out.push(
    `${device.modelName ?? 'Unknown device'} · ${device.osName ?? device.platform} ${device.osVersion ?? ''} · ` +
      `${scored.length} runs · ${manifest.reps} reps · started ${manifest.startedAt}`
  );
  out.push('');

  // Warnings that change how to read the numbers.
  const warnings: string[] = [];
  const charging = scored.filter((r) => r.metrics.charging).length;
  if (charging) warnings.push(`${charging} runs had the phone charging: power and energy numbers are not valid for those.`);
  const hot = scored.filter((r) => r.metrics.thermalStart && r.metrics.thermalStart !== 'nominal').length;
  if (hot) warnings.push(`${hot} runs started above nominal thermal state.`);
  const failed = scored.filter((r) => !r.run.ok).length;
  if (failed) warnings.push(`${failed} runs failed (see Failed checks); their metrics are left out of the averages.`);
  if (device.platform === 'ios') warnings.push('iOS has no live power reading: energy columns are empty. Use Instruments for energy.');
  if (warnings.length) out.push(...warnings.map((w) => `> ⚠️ ${w}`), '');

  for (const model of models) {
    const forModel = scored.filter((r) => r.run.modelId === model);
    const byScenario = (id: string) => forModel.filter((r) => r.run.scenarioId === id);
    out.push(`## ${model}`, '');

    // Summary per scenario.
    out.push('### Scenarios', '');
    out.push(
      table(
        ['Metric', ...scenarioIds.map(scenarioLabel)],
        [
          ['Pass rate', ...scenarioIds.map((id) => pct(passRate(byScenario(id))))],
          // Why the rest didn't finish.
          ...OUTCOMES.filter((o) => o.id !== 'finished' && forModel.some((r) => r.outcome === o.id)).map((o) => [
            `${o.label}`,
            ...scenarioIds.map((id) => String(byScenario(id).filter((r) => r.outcome === o.id).length)),
          ]),
          ...(forModel.some((r) => r.repeats)
            ? [
                ['Runs with a doom loop', ...scenarioIds.map((id) => String(byScenario(id).filter((r) => r.looped).length))],
                ['Repeated tool calls', ...scenarioIds.map((id) => String(byScenario(id).reduce((a, r) => a + r.repeats, 0)))],
              ]
            : []),
          ['Runs', ...scenarioIds.map((id) => String(byScenario(id).length))],
          ['Failed runs (crash, OOM)', ...scenarioIds.map((id) => String(byScenario(id).filter((r) => !r.run.ok).length))],
          ...COLUMNS.map((c) => [c.label, ...scenarioIds.map((id) => fmtMeanSd(values(byScenario(id), c.pick), c.digits))]),
        ]
      ),
      ''
    );

    // Impact of each scenario against the bare model.
    const base = byScenario(BASELINE_ID);
    const others = scenarioIds.filter((id) => id !== BASELINE_ID);
    if (base.length && others.length) {
      out.push(`### Impact vs ${scenarioLabel(BASELINE_ID)}`, '');
      out.push(
        table(
          ['Metric', ...others.map(scenarioLabel)],
          [
            [
              'Pass rate',
              ...others.map((id) => {
                const b = passRate(base);
                const x = passRate(byScenario(id));
                return b === undefined || x === undefined ? '–' : `${x - b >= 0 ? '+' : ''}${Math.round((x - b) * 100)} pts`;
              }),
            ],
            ...COLUMNS.map((c) => [
              c.label,
              ...others.map((id) => fmtDelta(mean(values(base, c.pick)), mean(values(byScenario(id), c.pick)), c.digits, c.unit)),
            ]),
          ]
        ),
        ''
      );
    }

    // Quality per task.
    out.push('### Pass rate by task', '');
    out.push(
      table(
        ['Task', ...scenarioIds.map(scenarioLabel)],
        tasks.map((t) => [
          `${t.title} (\`${t.id}\`)`,
          ...scenarioIds.map((id) => {
            const rs = byScenario(id).filter((r) => r.run.taskId === t.id);
            const rate = passRate(rs);
            return rs.length ? `${pct(rate)} (${rs.filter((r) => r.check.pass).length}/${rs.length})` : '–';
          }),
        ])
      ),
      ''
    );

    // Tool use per task, including calls on tasks that need none.
    const toolScenarios = scenarioIds.filter((id) => byScenario(id).some((r) => r.run.harness.fileTools));
    if (toolScenarios.length) {
      out.push('### Tool use by task', '');
      out.push(
        table(
          ['Task', 'Scenario', 'Calls / run', 'Failed calls', 'Tool time (s)', 'Tools used'],
          tasks.flatMap((t) =>
            toolScenarios.map((id) => {
              const rs = byScenario(id).filter((r) => r.run.taskId === t.id);
              const names = [...new Set(rs.flatMap((r) => r.run.tools.map((x) => x.name)))];
              const completed = rs.filter((r) => r.run.ok);
              const calls = mean(completed.map((r) => r.metrics.toolCalls));
              const flag = !t.needsTools && (calls ?? 0) > 0 ? ' ⚠️ unnecessary' : '';
              return [
                t.id,
                scenarioLabel(id),
                `${fmt(calls)}${flag}`,
                fmt(mean(completed.map((r) => r.metrics.toolErrors))),
                fmt(mean(completed.map((r) => r.metrics.toolS)), 2),
                names.join(', ') || '–',
              ];
            })
          )
        ),
        ''
      );
    }
  }

  // Failures and failed checks, for reading what went wrong.
  const failures = scored.filter((r) => !r.check.pass);
  if (failures.length) {
    out.push('## Failed checks', '');
    for (const r of failures) {
      out.push(`- **${r.run.modelId} · ${scenarioLabel(r.run.scenarioId)} · ${r.run.taskId} · rep ${r.run.rep}**: ${r.check.detail}`);
    }
    out.push('');
  }

  out.push('## How to read this', '');
  out.push(
    [
      '- Each run is a fresh model session and a fresh workspace; values are mean ± standard deviation across runs.',
      '- *Prompt tokens at start* is the system prompt plus tool declarations prefilled before the first message: the fixed cost of the harness.',
      '- *Memory* is the app\'s footprint (iOS: phys_footprint; Android: resident set). *Memory added* is peak during the run minus the idle baseline before the model loaded. *Min headroom* (iOS) is how close the app came to being killed.',
      '- *CPU* is process CPU time over wall time while the model was loaded (100% = one core).',
      '- *Hot time* is time spent above nominal thermal state.',
      '- *Energy* (Android only) integrates battery power over the active window; *above idle* subtracts the idle draw measured before the model loaded.',
    ].join('\n'),
    ''
  );
  return out.join('\n');
}

export function buildCsv(dir: string): string {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest;
  const suite = SUITES[manifest.suite] ?? [];
  const scored = loadRuns(dir).map((run) => scoreRun(run, suite));
  const metricKeys = scored.length ? (Object.keys(scored[0]!.metrics) as (keyof RunMetrics)[]) : [];
  const header = ['jobId', 'model', 'scenario', 'task', 'rep', 'pass', 'outcome', 'looped', 'repeatedToolCalls', ...metricKeys];
  const escape = (v: unknown) => {
    const s = v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = scored.map((r) =>
    [r.run.jobId, r.run.modelId, r.run.scenarioId, r.run.taskId, r.run.rep, r.check.pass, r.outcome, r.looped, r.repeats, ...metricKeys.map((k) => r.metrics[k])]
      .map(escape)
      .join(',')
  );
  return [header.join(','), ...rows].join('\n') + '\n';
}

export function writeReport(dir: string): string {
  const path = join(dir, 'report.md');
  writeFileSync(path, buildReport(dir));
  writeFileSync(join(dir, 'runs.csv'), buildCsv(dir));
  return path;
}
