// @vitest-environment node
import { mkdtempSync, readdirSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { MetricSample } from '@/shared/device-metrics';
import type { RunResult } from '@/shared/protocol';
import type { Span, Trace } from '@/shared/trace';

// The store keeps its data under process.cwd()/data: point it at a temp folder.
const dir = mkdtempSync(join(tmpdir(), 'dashboard-store-'));
vi.spyOn(process, 'cwd').mockReturnValue(dir);
const store = await import('./store');

const device = { id: 'phone1', name: 'iPhone 15 Pro', platform: 'ios', osVersion: '27.0' };
const sample = (t: number, mem: number, extra: Partial<MetricSample> = {}): MetricSample => ({
  t,
  uptimeS: t / 1000,
  cpuTimeS: t / 1000,
  memFootprintBytes: mem * 1e6,
  memAvailableBytes: (3500 - mem) * 1e6,
  ...extra,
});

/** A reply: one model call per entry in `gens` ([duration ms, tokens, tok/s]), plus optional tools. */
function reply(id: string, start: number, opts: { thread?: string; gens: [number, number, number][]; tools?: string[]; status?: 'ok' | 'error'; input?: string }): Trace {
  const spans: Span[] = [{ id: 'r', name: 'reply', kind: 'run', start, status: opts.status ?? 'ok' }];
  let t = start;
  opts.gens.forEach(([ms, tokens, tps], i) => {
    spans.push({ id: `g${i}`, parentId: 'r', name: `generation ${i + 1}`, kind: 'generation', start: t, end: t + ms, status: 'ok', attrs: { generatedTokens: tokens, tokensPerSec: tps, ttftMs: i === 0 ? 400 : 50, promptTokens: 100 } });
    t += ms;
    const tool = opts.tools?.[i];
    if (tool) {
      spans.push({ id: `x${i}`, parentId: 'r', name: tool, kind: 'tool', start: t, end: t + 20, status: 'ok', attrs: { path: '/todo.md', resultChars: 120 } });
      t += 20;
    }
  });
  spans[0]!.end = t;
  return {
    traceId: id,
    source: 'chat',
    name: `Gemma 4: ${opts.input ?? id}`,
    start,
    end: t,
    status: opts.status ?? 'ok',
    device,
    attrs: { kind: 'turn', modelName: 'Gemma 4', threadId: opts.thread ?? null, input: opts.input ?? null, output: 'ok', kvPos: 900 },
    spans,
    samples: [sample(start, 2800, { thermal: 'nominal', batteryLevel: 0.5 }), sample(t, 2900, { thermal: 'fair', batteryLevel: 0.49 })],
  };
}

const now = Date.now();
beforeAll(() => {
  store.recordTrace(reply('a1', now - 60_000, { thread: 'tA', input: 'first', gens: [[2000, 40, 20], [1000, 60, 30]], tools: ['read_file'] }));
  store.recordTrace(reply('a2', now - 30_000, { thread: 'tA', input: 'second', gens: [[4000, 80, 20]] }));
  store.recordTrace(reply('b1', now - 20_000, { thread: 'tB', input: 'other', gens: [[8000, 10, 10]], status: 'error' }));
  store.recordTrace(reply('old', now - 40 * 86_400_000, { input: 'ancient', gens: [[1000, 5, 5]] }));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('traceSummary', () => {
  it('reports model speed, tools and device impact for a reply', () => {
    const s = store.chatList().find((c) => c.traceId === 'a1')!;
    expect(s.input).toBe('first');
    expect(s.threadId).toBe('tA');
    expect(s.modelCalls).toBe(2);
    expect(s.generatedTokens).toBe(100);
    expect(s.tools).toEqual(['read_file']);
    expect(s.firstTokenMs).toBe(400);
    // Weighted by tokens: 100 tokens over (40/20 + 60/30) = 4 s of decoding.
    expect(s.decodeTps).toBeCloseTo(25);
    expect(s.promptTokens).toBe(200);
    expect(s.memAddedMB).toBeCloseTo(100);
    expect(s.thermalMax).toBe('fair');
    expect(s.contextUsed).toBe(900);
  });
});

describe('deviceList', () => {
  it('summarises replies of the last 7 days with nearest-rank percentiles', () => {
    const row = store.deviceList().find((d) => d.device.id === 'phone1')!;
    // 'old' (40 days) is outside the window.
    expect(row.stats.replies).toBe(3);
    expect(row.stats.errorRate).toBeCloseTo(1 / 3);
    expect(row.stats.p50Ms).toBe(4000);
    expect(row.stats.p95Ms).toBe(8000);
    expect(row.stats.tokensOut).toBe(190);
  });
});

describe('threadDetail', () => {
  it('opens a trace as its whole thread, oldest first', () => {
    const t = store.threadDetail('phone1', null, 'a2');
    expect(t.threadId).toBe('tA');
    expect(t.traces.map((x) => x.traceId)).toEqual(['a1', 'a2']);
  });

  it('returns a trace without a thread alone', () => {
    const t = store.threadDetail('phone1', null, 'old');
    expect(t.threadId).toBeNull();
    expect(t.traces.map((x) => x.traceId)).toEqual(['old']);
  });

  it('throws for an unknown trace', () => {
    expect(() => store.threadDetail('phone1', null, 'nope')).toThrow(store.NotFound);
  });
});

describe('pruneOldTraces', () => {
  it('deletes traces older than the retention window', () => {
    const chats = join(dir, 'data', '_chats');
    const old = join(chats, 'old.json');
    const when = (now - 40 * 86_400_000) / 1000;
    utimesSync(old, when, when);
    expect(store.pruneOldTraces(now, true)).toBe(1);
    expect(readdirSync(chats).sort()).toEqual(['a1.json', 'a2.json', 'b1.json']);
  });
});

describe('runToTrace', () => {
  it('rebuilds a benchmark run as nested spans', () => {
    const t0 = now;
    const run: RunResult = {
      jobId: 'gemma4-e2b__file-tools__find-fact__r1',
      sessionId: 's',
      modelId: 'gemma4-e2b',
      scenarioId: 'file-tools',
      taskId: 'find-fact',
      rep: 1,
      harness: { fileTools: true },
      device: { platform: 'ios', cpuCount: 6, physicalMemoryBytes: 8e9, modelName: 'iPhone', osName: 'iOS', osVersion: '27', appVersion: '1' },
      ok: true,
      startedAt: t0,
      endedAt: t0 + 20_000,
      cooldownMs: 5000,
      phases: { idleStart: t0 + 5000, loadStart: t0 + 8000, loadEnd: t0 + 12_000, turnsEnd: t0 + 19_000 },
      load: { sessionCreateMs: 4000, initTokens: 900, maxSeqLen: 4096 },
      turns: [{ index: 0, prompt: 'q', reply: 'a', finishReason: 'stop', startedAt: t0 + 12_000, endedAt: t0 + 19_000, generations: [{ promptTokens: 10, generatedTokens: 20, ttftMs: 300, decodeMs: 2000, inferenceStartMs: t0 + 12_000, inferenceEndMs: t0 + 14_300 }] }],
      tools: [{ turn: 0, name: 'read_file', ok: true, startedAt: t0 + 14_400, durationMs: 15 }],
      workspaceAfter: {},
      samples: [],
    };
    const trace = store.runToTrace(run);
    expect(trace.spans.map((s) => s.kind)).toEqual(['run', 'cooldown', 'idle', 'load', 'turn', 'generation', 'tool']);
    const gen = trace.spans.find((s) => s.kind === 'generation')!;
    expect(gen.attrs?.tokensPerSec).toBe(10);
    expect(trace.spans.find((s) => s.kind === 'tool')!.parentId).toBe(trace.spans.find((s) => s.kind === 'turn')!.id);
  });
});
