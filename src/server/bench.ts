import 'server-only';

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Job, JobResponse, RunResult } from '@/shared/protocol';
import { scoreRun, writeReport, type Manifest } from './report';
import { SCENARIOS } from './scenarios';
import { DATA_DIR } from './store';
import { SUITES } from './suites';

/*
 * The benchmark driver: builds the job matrix (models × scenarios × tasks ×
 * reps, shuffled per rep), hands jobs to the phone through /job, and stores
 * each result from /result. One benchmark at a time; start it from the
 * dashboard's Benchmark page or `npm run bench`.
 */

export type BenchConfig = {
  suite: string;
  models: string[];
  scenarios: string[];
  tasks?: string[];
  reps: number;
  name?: string;
  sampleMs?: number;
  idleMs?: number;
  settleMs?: number;
  cooldownMaxMs?: number;
  /** After cooling, wait until thermal has been nominal this long (a steady start, like the paper's ΔT check). */
  stableMs?: number;
  /** No cool-down between runs (the paper's sustained-load protocol): only a 1 s gap. */
  backToBack?: boolean;
  turnTimeoutMs?: number;
  /** Warm the model up in a throwaway session before each run (default on). */
  warmup?: boolean;
  /** Model calls per message with tools on (default 10: room for 4–6-step tasks and a planner). */
  maxToolTurns?: number;
  temperature?: number;
  maxNewTokens?: number;
};

type InFlight = { job: Job; since: number; launch: string; client: string };

type BenchState = {
  sessionId: string;
  dir: string;
  manifest: Manifest;
  suite: string;
  total: number;
  done: number;
  pending: Job[];
  inFlight: InFlight | null;
  startedAt: number;
  finished: boolean;
  stopped: boolean;
};

const MAX_LOG_LINES = 400;

// Survives hot reloads in `next dev`.
const g = globalThis as typeof globalThis & {
  __onDeviceBench?: { state: BenchState | null; log: { t: number; line: string }[] };
};
const bench = (g.__onDeviceBench ??= { state: null, log: [] });

function log(line: string) {
  bench.log.push({ t: Date.now(), line });
  if (bench.log.length > MAX_LOG_LINES) bench.log.splice(0, bench.log.length - MAX_LOG_LINES);
  console.log(`[bench] ${line}`);
}

export function benchStatus() {
  const s = bench.state;
  return {
    active: !!s && !s.finished && !s.stopped,
    session: s && {
      sessionId: s.sessionId,
      suite: s.suite,
      total: s.total,
      done: s.done,
      pending: s.pending.length,
      inFlight: s.inFlight ? { jobId: s.inFlight.job.jobId, since: s.inFlight.since } : null,
      startedAt: s.startedAt,
      finished: s.finished,
      stopped: s.stopped,
    },
    log: bench.log.slice(-200),
  };
}

export function benchOptions() {
  return {
    suites: Object.fromEntries(Object.entries(SUITES).map(([name, tasks]) => [name, tasks.map((t) => ({ id: t.id, title: t.title }))])),
    scenarios: SCENARIOS,
  };
}

export function startBench(config: BenchConfig) {
  if (bench.state && !bench.state.finished && !bench.state.stopped) {
    throw new Error(`A benchmark is already running (${bench.state.sessionId}). Stop it first.`);
  }
  const suite = SUITES[config.suite];
  if (!suite) throw new Error(`Unknown suite '${config.suite}'`);
  const scenarios = config.scenarios.map((id) => {
    const scenario = SCENARIOS.find((s) => s.id === id);
    if (!scenario) throw new Error(`Unknown scenario '${id}'`);
    return scenario;
  });
  const tasks = config.tasks?.length
    ? config.tasks.map((id) => {
        const task = suite.find((t) => t.id === id);
        if (!task) throw new Error(`Unknown task '${id}' in ${config.suite}`);
        return task;
      })
    : suite;
  if (!config.models.length) throw new Error('Pick at least one model');
  if (!scenarios.length) throw new Error('Pick at least one scenario');
  const reps = Math.max(1, Math.floor(config.reps));

  const startedAt = new Date();
  const sessionId = `${startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19)}${config.name ? `-${config.name.replace(/[^\w-]/g, '')}` : ''}`;
  const dir = join(DATA_DIR, sessionId);
  mkdirSync(join(dir, 'runs'), { recursive: true });
  const manifest: Manifest = {
    sessionId,
    suite: config.suite,
    models: config.models,
    scenarios: scenarios.map((s) => s.id),
    tasks: tasks.map((t) => t.id),
    reps,
    startedAt: startedAt.toISOString(),
    options: config as unknown as Record<string, unknown>,
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const pending: Job[] = [];

  for (let rep = 1; rep <= reps; rep++) {
    const cells = config.models.flatMap((modelId) => scenarios.flatMap((scenario) => tasks.map((task) => ({ modelId, scenario, task }))));
    // A fresh random order each rep, so heat and battery drift don't favour one scenario.
    for (const { modelId, scenario, task } of shuffle(cells)) {
      pending.push({
        type: 'job',
        jobId: `${modelId}__${scenario.id}__${task.id}__r${rep}`,
        sessionId,
        modelId,
        scenario,
        task: { id: task.id, files: task.files, turns: task.turns, systemPrompt: [scenario.systemPrompt, task.systemPrompt].filter(Boolean).join('\n\n') || undefined },
        rep,
        generation: { temperature: config.temperature ?? 0.2, maxNewTokens: config.maxNewTokens ?? 1024 },
        sampleIntervalMs: config.sampleMs ?? 500,
        idleMs: config.backToBack ? 1000 : (config.idleMs ?? 3000),
        cooldown: config.backToBack
          ? { settleMs: 0, maxWaitMs: 0, stableMs: 0 }
          : { settleMs: config.settleMs ?? 10_000, maxWaitMs: config.cooldownMaxMs ?? 180_000, stableMs: config.stableMs ?? 0 },
        turnTimeoutMs: config.turnTimeoutMs ?? 240_000,
        warmup: config.warmup ?? true,
        maxToolTurns: config.maxToolTurns ?? 10,
      });
    }
  }

  bench.state = {
    sessionId,
    dir,
    manifest,
    suite: config.suite,
    total: pending.length,
    done: 0,
    pending,
    inFlight: null,
    startedAt: Date.now(),
    finished: false,
    stopped: false,
  };
  bench.log = [];
  log(`Started ${sessionId}: ${pending.length} runs (${config.models.join(', ')} × ${manifest.scenarios.join(', ')} × ${tasks.length} tasks × ${reps} reps)`);
  return benchStatus();
}

export function stopBench() {
  const s = bench.state;
  if (!s || s.finished || s.stopped) return benchStatus();
  s.stopped = true;
  s.pending = [];
  log(`Stopped ${s.sessionId} after ${s.done}/${s.total} runs${s.inFlight ? ' (the run on the phone will be ignored)' : ''}`);
  return benchStatus();
}

// ── Phone protocol ─────────────────────────────────────────────────────────

/** GET /job: the next job, 'done', or null (nothing to do; the phone keeps waiting). */
export function nextJob(launch: string, client: string): { status: 200 | 204 | 409; body?: JobResponse | { error: string } } {
  const s = bench.state;
  if (!s || s.stopped) return { status: 204 };
  if (s.finished) return { status: 200, body: { type: 'done' } };
  if (s.inFlight) {
    if (s.inFlight.launch === launch && s.inFlight.client !== client) {
      // A second connection in the same app: one model at a time, so refuse it.
      return { status: 409, body: { error: `busy with ${s.inFlight.job.jobId}` } };
    }
    if (s.inFlight.launch === launch && s.inFlight.client === client) {
      // Same connection asking again: it gave up on the result upload. Re-queue the job.
      log(`↺ ${s.inFlight.job.jobId} wasn't reported; queued again`);
      s.pending.unshift(s.inFlight.job);
    } else {
      // A new app launch while a job was out: the app was restarted mid-run.
      recordLostJob(s, s.inFlight);
    }
    s.inFlight = null;
  }
  const job = s.pending.shift();
  if (!job) return { status: 200, body: { type: 'done' } };
  s.inFlight = { job, since: Date.now(), launch, client };
  log(`→ ${job.jobId}`);
  return { status: 200, body: job };
}

export function phoneLog(message: string) {
  log(`  ${message}`);
}

/** POST /result. Only the job in flight in this session counts. */
export function submitResult(result: RunResult): { ignored: boolean } {
  const s = bench.state;
  if (!s || result.sessionId !== s.sessionId || s.inFlight?.job.jobId !== result.jobId) {
    log(`⤫ ignored a result for ${result.jobId} (not the job in flight)`);
    return { ignored: true };
  }
  s.inFlight = null;
  saveResult(s, result);
  return { ignored: false };
}

/** The session's folder, recreated (with its manifest) if it was deleted while running. */
function ensureSessionDir(s: BenchState) {
  if (existsSync(join(s.dir, 'manifest.json'))) return;
  mkdirSync(join(s.dir, 'runs'), { recursive: true });
  // A benchmark started before this code reloaded has no manifest in memory.
  if (s.manifest) writeFileSync(join(s.dir, 'manifest.json'), JSON.stringify(s.manifest, null, 2));
  log(`Recreated the missing session folder ${s.sessionId}`);
}

function saveResult(s: BenchState, result: RunResult) {
  ensureSessionDir(s);
  writeFileSync(join(s.dir, 'runs', `${result.jobId}.json`), JSON.stringify(result));
  s.done++;
  const { metrics, check } = scoreRun(result, SUITES[s.suite] ?? []);
  const parts = [
    check.pass ? 'PASS' : 'FAIL',
    metrics.turnS !== undefined && `${metrics.turnS.toFixed(1)}s`,
    metrics.toolCalls && `${metrics.toolCalls} tools`,
    metrics.memPeakMB !== undefined && `peak ${Math.round(metrics.memPeakMB)} MB`,
    metrics.energyJ !== undefined && `${metrics.energyJ.toFixed(1)} J`,
  ].filter(Boolean);
  log(`[${s.done}/${s.total}] ${result.jobId}: ${parts.join(' · ')}${check.pass ? '' : ` — ${check.detail}`}`);
  try {
    writeReport(s.dir);
  } catch (e) {
    log(`Couldn't write report.md: ${String(e)}`);
  }
  if (s.done >= s.total) {
    s.finished = true;
    log(`All ${s.total} runs done.`);
  }
}

/** The app restarted mid-run, almost always because the OS killed it for memory. That's a result. */
function recordLostJob(s: BenchState, { job, since }: InFlight) {
  log(`✗ ${job.jobId} never reported back: the app restarted mid-run (likely killed for memory)`);
  saveResult(s, {
    jobId: job.jobId,
    sessionId: s.sessionId,
    modelId: job.modelId,
    scenarioId: job.scenario.id,
    taskId: job.task.id,
    rep: job.rep,
    harness: job.scenario.harness,
    device: { platform: 'ios', cpuCount: 0, physicalMemoryBytes: 0, modelName: null, osName: null, osVersion: null, appVersion: null },
    ok: false,
    error: 'App restarted during the run (likely killed by the OS for memory)',
    startedAt: since,
    endedAt: Date.now(),
    cooldownMs: 0,
    phases: { idleStart: since },
    turns: [],
    tools: [],
    workspaceAfter: {},
    samples: [],
  });
}

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
