import 'server-only';

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';

import type { MetricSample } from '@/shared/device-metrics';
import type { RunResult } from '@/shared/protocol';
import type { LiveBeat, Span, Trace, TraceDevice } from '@/shared/trace';
import { loadRuns, scoreRun, type Manifest } from './report';
import { SCENARIOS } from './scenarios';
import { SUITES } from './suites';

/*
 * Everything the dashboard stores, on disk under ./data:
 *   data/<session>/          benchmark sessions (manifest.json, runs/*.json, report.md)
 *   data/_chats/<id>.json    traced chat replies and model loads (kept RETENTION_DAYS)
 * plus live heartbeats, kept in memory for the last 10 minutes.
 */

export const DATA_DIR = join(process.cwd(), 'data');
const CHATS_DIR = join(DATA_DIR, '_chats');
const LIVE_HISTORY_MS = 10 * 60_000;

export class NotFound extends Error {}

type LiveDevice = { beat: LiveBeat; history: { t: number; sample: MetricSample }[] };

// Module state survives hot reloads in `next dev` by living on globalThis.
const g = globalThis as typeof globalThis & { __onDeviceLive?: Map<string, LiveDevice> };
const live = (g.__onDeviceLive ??= new Map());

// ── Writes from the phone ──────────────────────────────────────────────────

export function recordBeat(beat: LiveBeat) {
  const entry = live.get(beat.device.id) ?? { beat, history: [] };
  entry.beat = beat;
  if (beat.sample) entry.history.push({ t: beat.t, sample: beat.sample });
  const cutoff = Date.now() - LIVE_HISTORY_MS;
  while (entry.history.length && entry.history[0]!.t < cutoff) entry.history.shift();
  live.set(beat.device.id, entry);
}

export function recordTrace(trace: Trace) {
  mkdirSync(CHATS_DIR, { recursive: true });
  writeFileSync(join(CHATS_DIR, `${safe(trace.traceId)}.json`), JSON.stringify(trace));
}

// ── Reads for the dashboard ────────────────────────────────────────────────

export function liveDevices() {
  return [...live.values()].map((d) => ({ ...d.beat, lastSeen: d.beat.t }));
}

export function liveDevice(id: string) {
  const entry = live.get(id);
  if (!entry) throw new NotFound('No such device');
  return { ...entry, spans: recentSpans(id, Date.now() - LIVE_HISTORY_MS) };
}

/** Spans of this device's chat traces that overlap the window (for the live timeline). */
function recentSpans(deviceId: string, since: number): Span[] {
  if (!existsSync(CHATS_DIR)) return [];
  const spans: Span[] = [];
  for (const f of readdirSync(CHATS_DIR)) {
    if (!f.endsWith('.json')) continue;
    const path = join(CHATS_DIR, f);
    if (statSync(path).mtimeMs < since) continue; // written before the window: can't overlap it
    const trace = JSON.parse(readFileSync(path, 'utf8')) as Trace;
    if (trace.device.id !== deviceId || (trace.end ?? trace.start) < since) continue;
    // Ids are only unique within a trace; prefix them so spans from different replies don't collide.
    for (const sp of trace.spans) spans.push({ ...sp, id: `${trace.traceId}:${sp.id}`, parentId: sp.parentId && `${trace.traceId}:${sp.parentId}` });
  }
  return spans;
}

export function sessionList() {
  if (!existsSync(DATA_DIR)) return [];
  return readdirSync(DATA_DIR)
    .filter((d) => existsSync(join(DATA_DIR, d, 'manifest.json')))
    .map((id) => {
      const manifest = readManifest(id);
      const runsDir = join(DATA_DIR, id, 'runs');
      const done = existsSync(runsDir) ? readdirSync(runsDir).filter((f) => f.endsWith('.json')).length : 0;
      const total = manifest.models.length * manifest.scenarios.length * manifest.tasks.length * manifest.reps;
      return { id, suite: manifest.suite, startedAt: manifest.startedAt, models: manifest.models, scenarios: manifest.scenarios, reps: manifest.reps, done, total };
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** How long chat traces are kept (TRACE_RETENTION_DAYS, default 30). Benchmark sessions are kept. */
export const RETENTION_DAYS = Number(process.env.TRACE_RETENTION_DAYS) > 0 ? Number(process.env.TRACE_RETENTION_DAYS) : 30;
const PRUNE_EVERY_MS = 60 * 60_000;
const gPrune = globalThis as typeof globalThis & { __onDeviceLastPrune?: number };

/** Deletes chat traces older than the retention window; runs at most once an hour. */
export function pruneOldTraces(now = Date.now(), force = false): number {
  if (!force && now - (gPrune.__onDeviceLastPrune ?? 0) < PRUNE_EVERY_MS) return 0;
  gPrune.__onDeviceLastPrune = now;
  if (!existsSync(CHATS_DIR)) return 0;
  const cutoff = now - RETENTION_DAYS * 24 * 60 * 60_000;
  let removed = 0;
  for (const f of readdirSync(CHATS_DIR)) {
    if (!f.endsWith('.json')) continue;
    const path = join(CHATS_DIR, f);
    // File time is when the trace arrived, which is at or after when it happened.
    if (statSync(path).mtimeMs < cutoff) {
      rmSync(path);
      removed++;
    }
  }
  if (removed) console.log(`[store] removed ${removed} traces older than ${RETENTION_DAYS} days`);
  return removed;
}

export function chatList(limit = 300) {
  pruneOldTraces();
  if (!existsSync(CHATS_DIR)) return [];
  return readdirSync(CHATS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ f, mtime: statSync(join(CHATS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .map(({ f }) => {
      const trace = JSON.parse(readFileSync(join(CHATS_DIR, f), 'utf8')) as Trace;
      return { ...traceSummary(trace), traceId: trace.traceId };
    })
    .sort((a, b) => b.start - a.start);
}

export function sessionDetail(id: string) {
  const dir = sessionDir(id);
  const manifest = readManifest(id);
  const suite = SUITES[manifest.suite] ?? [];
  const runs = existsSync(join(dir, 'runs')) ? loadRuns(dir) : [];
  return {
    manifest,
    scenarios: SCENARIOS.filter((s) => manifest.scenarios.includes(s.id)),
    tasks: suite.map((t) => ({ id: t.id, title: t.title, needsTools: t.needsTools })),
    runs: runs.map((run) => {
      const { metrics, check } = scoreRun(run, suite);
      return {
        jobId: run.jobId,
        modelId: run.modelId,
        scenarioId: run.scenarioId,
        taskId: run.taskId,
        rep: run.rep,
        ok: run.ok,
        error: run.error ?? null,
        startedAt: run.startedAt,
        pass: check.pass,
        detail: check.detail,
        metrics,
      };
    }),
  };
}

export function runDetail(sessionId: string, jobId: string) {
  const dir = sessionDir(sessionId);
  const manifest = readManifest(sessionId);
  const path = join(dir, 'runs', `${jobId.replace(/[^\w.-]/g, '')}.json`);
  if (!existsSync(path)) throw new NotFound(`No run ${jobId}`);
  const run = JSON.parse(readFileSync(path, 'utf8')) as RunResult;
  const { metrics, check } = scoreRun(run, SUITES[manifest.suite] ?? []);
  return {
    trace: runToTrace(run),
    metrics,
    check,
    turns: run.turns.map((t) => ({ prompt: t.prompt, reply: t.reply, finishReason: t.finishReason })),
    workspaceAfter: run.workspaceAfter,
  };
}

export function chatDetail(traceId: string) {
  const path = join(CHATS_DIR, `${safe(traceId)}.json`);
  if (!existsSync(path)) throw new NotFound(`No trace ${traceId}`);
  const trace = JSON.parse(readFileSync(path, 'utf8')) as Trace;
  return { trace, summary: traceSummary(trace) };
}

/** Seconds without a heartbeat before a device counts as disconnected. */
const LIVE_WINDOW_MS = 12_000;

/** A device's replies over the last STATS_WINDOW_MS (model loads aren't replies). */
type ReplyStats = {
  replies: number;
  errorRate: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  tokensOut: number;
  peakMemMB: number | null;
};

type DeviceRow = {
  device: TraceDevice;
  lastSeen: number;
  live: boolean;
  traces: number;
  lastTraceAt: number | null;
  sample: MetricSample | null;
  active: LiveBeat['active'] | null;
  stats: ReplyStats;
};

const STATS_WINDOW_MS = 7 * 24 * 60 * 60_000;

/** Nearest-rank percentile of an ascending list. */
function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}

function replyStats(traces: ReturnType<typeof chatList>, since: number): ReplyStats {
  const replies = traces.filter((c) => c.kind !== 'load' && c.start >= since);
  const times = replies.map((c) => c.durationMs).sort((a, b) => a - b);
  const mem = replies.map((c) => c.peakMemMB).filter((x): x is number => x !== null);
  return {
    replies: replies.length,
    errorRate: replies.length ? replies.filter((c) => c.status !== 'ok').length / replies.length : null,
    p50Ms: percentile(times, 50),
    p95Ms: percentile(times, 95),
    tokensOut: replies.reduce((a, c) => a + c.generatedTokens, 0),
    peakMemMB: mem.length ? Math.max(...mem) : null,
  };
}

/** Every device seen: connected now (heartbeats) or known from its traces. */
export function deviceList(): DeviceRow[] {
  const now = Date.now();
  const rows = new Map<string, DeviceRow>();
  const all = chatList(100_000);
  const empty = (device: TraceDevice): DeviceRow => ({
    device,
    lastSeen: 0,
    live: false,
    traces: 0,
    lastTraceAt: null,
    sample: null,
    active: null,
    stats: replyStats([], 0),
  });
  for (const c of all) {
    const row = rows.get(c.device.id) ?? empty(c.device);
    row.traces++;
    const end = c.start + c.durationMs;
    row.lastSeen = Math.max(row.lastSeen, end);
    row.lastTraceAt = Math.max(row.lastTraceAt ?? 0, c.start);
    rows.set(c.device.id, row);
  }
  for (const { beat } of live.values()) {
    const row = rows.get(beat.device.id) ?? empty(beat.device);
    row.device = beat.device;
    row.lastSeen = Math.max(row.lastSeen, beat.t);
    row.live = now - beat.t < LIVE_WINDOW_MS;
    row.sample = beat.sample;
    row.active = row.live ? (beat.active ?? null) : null;
    rows.set(beat.device.id, row);
  }
  const since = now - STATS_WINDOW_MS;
  for (const row of rows.values()) row.stats = replyStats(all.filter((c) => c.device.id === row.device.id), since);
  return [...rows.values()].sort((a, b) => Number(b.live) - Number(a.live) || b.lastSeen - a.lastSeen);
}

/** One device: whether it's connected, and its traces, newest first. */
export function deviceDetail(id: string) {
  const row = deviceList().find((d) => d.device.id === id);
  if (!row) throw new NotFound('No such device');
  return { ...row, hasLive: live.has(id), traces: chatList(100_000).filter((c) => c.device.id === id), runs: deviceRuns(id) };
}

/**
 * This Mac's Bonjour name (e.g. "Jamess-MacBook.local"): unlike the Wi-Fi IP it
 * doesn't change, so it's the address to give the phone. Null off macOS.
 */
export function localHostName(): string | null {
  if (cachedHostName !== undefined) return cachedHostName;
  try {
    cachedHostName = process.platform === 'darwin' ? `${execFileSync('scutil', ['--get', 'LocalHostName'], { encoding: 'utf8' }).trim()}.local` : null;
  } catch {
    cachedHostName = null;
  }
  return cachedHostName;
}
let cachedHostName: string | null | undefined;

/** Addresses the phone can use to reach this Mac. */
export function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i!.address);
}

function readManifest(id: string): Manifest {
  return JSON.parse(readFileSync(join(sessionDir(id), 'manifest.json'), 'utf8')) as Manifest;
}

function sessionDir(id: string) {
  const dir = resolve(DATA_DIR, id);
  if (!dir.startsWith(DATA_DIR) || !existsSync(join(dir, 'manifest.json'))) throw new NotFound(`No session ${id}`);
  return dir;
}

const safe = (id: string) => id.replace(/[^a-z0-9]/gi, '');

// ── Traces ─────────────────────────────────────────────────────────────────

const clip = (s: string, n = 400) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** A benchmark run as a trace: the same spans a chat trace has, rebuilt from the run record. */
export function runToTrace(run: RunResult): Trace {
  const spans: Span[] = [];
  let n = 0;
  const add = (span: Omit<Span, 'id'>) => {
    const id = `s${n++}`;
    spans.push({ ...span, id });
    return id;
  };
  const timedOut = run.turns.some((t) => t.finishReason === 'timeout');
  const root = add({
    name: `${run.scenarioId} · ${run.taskId} · rep ${run.rep}`,
    kind: 'run',
    start: run.startedAt,
    end: run.endedAt,
    status: run.ok ? 'ok' : timedOut ? 'timeout' : 'error',
    attrs: { model: run.modelId, scenario: run.scenarioId, task: run.taskId, error: run.error ?? null },
  });
  const { idleStart, loadStart, loadEnd } = run.phases;
  if (run.cooldownMs && idleStart) {
    add({ parentId: root, name: 'cooldown', kind: 'cooldown', start: idleStart - run.cooldownMs, end: idleStart, status: 'ok' });
  }
  if (idleStart && loadStart) add({ parentId: root, name: 'idle baseline', kind: 'idle', start: idleStart, end: loadStart, status: 'ok' });
  if (loadStart) {
    add({
      parentId: root,
      name: 'load',
      kind: 'load',
      start: loadStart,
      end: loadEnd ?? run.endedAt,
      status: loadEnd ? 'ok' : 'error',
      attrs: { initTokens: run.load?.initTokens ?? null, maxSeqLen: run.load?.maxSeqLen ?? null },
    });
  }
  for (const turn of run.turns) {
    const turnId = add({
      parentId: root,
      name: `turn ${turn.index + 1}`,
      kind: 'turn',
      start: turn.startedAt,
      end: turn.endedAt,
      status: turn.finishReason === 'timeout' ? 'timeout' : turn.finishReason === 'error' ? 'error' : 'ok',
      attrs: { prompt: clip(turn.prompt), reply: clip(turn.reply), finishReason: turn.finishReason, kvPosAfter: turn.kvPosAfter ?? null },
    });
    turn.generations.forEach((gen, i) =>
      add({
        parentId: turnId,
        name: `generation ${i + 1}`,
        kind: 'generation',
        start: gen.inferenceStartMs,
        end: gen.inferenceEndMs,
        status: 'ok',
        attrs: {
          promptTokens: gen.promptTokens,
          generatedTokens: gen.generatedTokens,
          ttftMs: gen.ttftMs,
          tokensPerSec: gen.decodeMs > 0 ? Math.round((gen.generatedTokens / (gen.decodeMs / 1000)) * 10) / 10 : null,
        },
      })
    );
    for (const tool of run.tools.filter((t) => t.turn === turn.index)) {
      const start = tool.startedAt ?? turn.startedAt;
      add({
        parentId: turnId,
        name: tool.name,
        kind: 'tool',
        start,
        end: start + (tool.durationMs ?? 0),
        status: tool.ok ? 'ok' : 'error',
        attrs: { path: tool.path ?? null, resultChars: tool.resultChars ?? null, args: tool.args ? clip(JSON.stringify(tool.args), 300) : null },
      });
    }
  }
  return {
    traceId: run.jobId,
    source: 'bench',
    name: `${run.modelId} · ${run.scenarioId} · ${run.taskId} · rep ${run.rep}`,
    start: run.startedAt,
    end: run.endedAt,
    status: run.ok ? 'ok' : timedOut ? 'timeout' : 'error',
    device: { id: 'bench', name: run.device.modelName, platform: run.device.platform, osVersion: run.device.osVersion },
    attrs: { model: run.modelId, scenario: run.scenarioId, task: run.taskId, rep: run.rep },
    spans,
    samples: run.samples,
  };
}

/** Headline numbers for a trace list row. */
export function traceSummary(trace: Trace) {
  const mem = trace.samples.map((s) => s.memFootprintBytes).filter((x): x is number => x !== undefined);
  const gens = trace.spans.filter((s) => s.kind === 'generation');
  const num = (v: unknown) => (typeof v === 'number' ? v : 0);
  let cpuPct: number | null = null;
  const first = trace.samples[0];
  const last = trace.samples.at(-1);
  if (first && last && last.uptimeS > first.uptimeS) {
    cpuPct = ((last.cpuTimeS - first.cpuTimeS) / (last.uptimeS - first.uptimeS)) * 100;
  }
  return {
    name: trace.name,
    source: trace.source,
    start: trace.start,
    durationMs: (trace.end ?? trace.start) - trace.start,
    status: trace.status ?? 'ok',
    device: trace.device,
    kind: (trace.attrs?.kind as string | undefined) ?? 'turn',
    model: (trace.attrs?.modelName as string | undefined) ?? (trace.attrs?.model as string | undefined) ?? null,
    modelCalls: gens.length,
    generatedTokens: gens.reduce((a, s) => a + num(s.attrs?.generatedTokens), 0),
    toolCalls: trace.spans.filter((s) => s.kind === 'tool').length,
    tools: [...new Set(trace.spans.filter((s) => s.kind === 'tool').map((s) => s.name))],
    peakMemMB: mem.length ? Math.max(...mem) / 1e6 : null,
    cpuPct,
    // Older traces (before threads and text were traced) have none of these.
    threadId: (trace.attrs?.threadId as string | undefined) ?? null,
    input: (trace.attrs?.input as string | undefined) ?? null,
    output: (trace.attrs?.output as string | undefined) ?? null,
    error: (trace.attrs?.error as string | undefined) ?? null,
    ...modelSpeed(trace),
    ...deviceImpact(trace),
  };
}

/** How fast the model was in a trace: first token, decode speed, prompt size, context. */
function modelSpeed(trace: Trace) {
  const gens = trace.spans.filter((s) => s.kind === 'generation').sort((a, b) => a.start - b.start);
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  const first = gens[0];
  // Decode speed across calls, weighted by tokens: total tokens / total decode time.
  let tokens = 0;
  let decodeS = 0;
  for (const g of gens) {
    const n = num(g.attrs?.generatedTokens);
    const tps = num(g.attrs?.tokensPerSec);
    if (n && tps) {
      tokens += n;
      decodeS += n / tps;
    }
  }
  return {
    firstTokenMs: first ? num(first.attrs?.ttftMs) : null,
    decodeTps: decodeS > 0 ? tokens / decodeS : null,
    promptTokens: gens.reduce((a, g) => a + (num(g.attrs?.promptTokens) ?? 0), 0) || null,
    contextUsed: num(trace.attrs?.kvPos),
  };
}

const THERMAL_RANK = ['nominal', 'fair', 'light', 'moderate', 'serious', 'severe', 'critical', 'emergency', 'shutdown'];

/** What a trace cost the phone, from its native samples. */
function deviceImpact(trace: Trace) {
  const s = trace.samples;
  const mem = s.map((x) => x.memFootprintBytes).filter((x): x is number => x !== undefined);
  const head = s.map((x) => x.memAvailableBytes).filter((x): x is number => x !== undefined);
  const thermal = s.map((x) => x.thermal).filter((x): x is string => !!x);
  const battery = s.map((x) => x.batteryLevel).filter((x): x is number => x !== undefined);
  // Energy (Android): integrate battery power over the trace.
  const powered = s.filter((x) => x.powerW !== undefined);
  let energyJ: number | null = null;
  if (powered.length >= 2) {
    energyJ = 0;
    for (let i = 1; i < powered.length; i++) energyJ += ((powered[i - 1]!.powerW! + powered[i]!.powerW!) / 2) * ((powered[i]!.t - powered[i - 1]!.t) / 1000);
  }
  return {
    memAddedMB: mem.length ? (Math.max(...mem) - mem[0]!) / 1e6 : null,
    minHeadroomMB: head.length ? Math.min(...head) / 1e6 : null,
    thermalMax: thermal.length ? thermal.reduce((a, b) => (THERMAL_RANK.indexOf(b) > THERMAL_RANK.indexOf(a) ? b : a)) : null,
    batteryStart: battery[0] ?? null,
    batteryEnd: battery.at(-1) ?? null,
    charging: s.some((x) => x.batteryState === 'charging' || x.batteryState === 'full'),
    energyJ,
  };
}

/**
 * A whole thread (conversation) for the thread panel: every trace of `threadId`
 * on the device, oldest first. Given only a trace, its own thread; a trace from
 * before threads were traced comes back alone.
 */
export function threadDetail(deviceId: string, threadId: string | null, traceId: string | null) {
  if (!existsSync(CHATS_DIR)) throw new NotFound('No traces yet');
  const all = readdirSync(CHATS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(CHATS_DIR, f), 'utf8')) as Trace)
    .filter((t) => t.device.id === deviceId);
  const focus = traceId ? all.find((t) => t.traceId === traceId) : undefined;
  if (traceId && !focus) throw new NotFound(`No trace ${traceId}`);
  const thread = threadId ?? ((focus?.attrs?.threadId as string | undefined) ?? null);
  const traces = (thread ? all.filter((t) => t.attrs?.threadId === thread) : focus ? [focus] : []).sort((a, b) => a.start - b.start);
  if (!traces.length) throw new NotFound('No such thread');
  return { threadId: thread, traces };
}

/** The model calls and tool calls inside a device's traces, newest first (the Runs view). */
function deviceRuns(deviceId: string, limit = 3000) {
  if (!existsSync(CHATS_DIR)) return [];
  const runs = [];
  for (const f of readdirSync(CHATS_DIR)) {
    if (!f.endsWith('.json')) continue;
    const trace = JSON.parse(readFileSync(join(CHATS_DIR, f), 'utf8')) as Trace;
    if (trace.device.id !== deviceId) continue;
    for (const sp of trace.spans) {
      if (sp.kind !== 'generation' && sp.kind !== 'tool') continue;
      runs.push({
        runId: `${trace.traceId}:${sp.id}`,
        traceId: trace.traceId,
        traceName: trace.name,
        threadId: (trace.attrs?.threadId as string | undefined) ?? null,
        model: (trace.attrs?.modelName as string | undefined) ?? null,
        kind: sp.kind,
        name: sp.name,
        start: sp.start,
        durationMs: (sp.end ?? sp.start) - sp.start,
        status: sp.status ?? 'ok',
        tokens: typeof sp.attrs?.generatedTokens === 'number' ? sp.attrs.generatedTokens : null,
        promptTokens: typeof sp.attrs?.promptTokens === 'number' ? sp.attrs.promptTokens : null,
        firstTokenMs: typeof sp.attrs?.ttftMs === 'number' ? sp.attrs.ttftMs : null,
        resultChars: typeof sp.attrs?.resultChars === 'number' ? sp.attrs.resultChars : null,
        tokensPerSec: typeof sp.attrs?.tokensPerSec === 'number' ? sp.attrs.tokensPerSec : null,
        path: typeof sp.attrs?.path === 'string' ? sp.attrs.path : null,
      });
    }
  }
  return runs.sort((a, b) => b.start - a.start).slice(0, limit);
}
