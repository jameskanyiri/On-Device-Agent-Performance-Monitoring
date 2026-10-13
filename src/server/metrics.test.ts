import { describe, expect, it } from 'vitest';

import type { RunResult } from '@/shared/protocol';
import { summarizeRun } from './metrics';

const sample = (t: number, thermal: string, extra: Record<string, unknown> = {}) => ({ t, uptimeS: t / 1000, cpuTimeS: t / 2000, thermal, memFootprintBytes: 1e9, ...extra });

function run(over: Partial<RunResult> = {}): RunResult {
  return {
    jobId: 'j',
    sessionId: 's',
    modelId: 'm',
    scenarioId: 'baseline',
    taskId: 't',
    rep: 1,
    harness: { fileTools: false },
    device: { platform: 'android', cpuCount: 8, physicalMemoryBytes: 8e9, modelName: 'Phone', osName: 'Android', osVersion: '16', appVersion: '1.0' },
    ok: true,
    startedAt: 0,
    endedAt: 10_000,
    cooldownMs: 0,
    phases: { idleStart: 0, loadStart: 1000, loadEnd: 2000, turnsEnd: 10_000 },
    load: { sessionCreateMs: 1000, initTokens: 0, maxSeqLen: 2048 },
    turns: [
      {
        index: 0,
        prompt: 'hi',
        reply: 'hello',
        finishReason: 'stop',
        startedAt: 2000,
        endedAt: 10_000,
        generations: [{ promptTokens: 200, generatedTokens: 100, ttftMs: 600, prefillMs: 500, decodeMs: 5000, inferenceStartMs: 2000, inferenceEndMs: 7600 }],
      },
    ],
    tools: [],
    workspaceAfter: {},
    generation: { temperature: 0, maxNewTokens: 512 },
    start: sample(0, 'nominal', { batteryLevel: 0.9, batteryState: 'unplugged', lowPowerMode: false, screenBrightness: 0.5 }),
    samples: [
      sample(0, 'nominal', { powerW: 1 }),
      sample(2000, 'nominal', { powerW: 3, cpuFreqAvgMHz: 2000, batteryTempC: 30 }),
      sample(5000, 'light', { powerW: 5, cpuFreqAvgMHz: 1800, batteryTempC: 33 }),
      sample(8000, 'moderate', { powerW: 4, cpuFreqAvgMHz: 1600, batteryTempC: 35 }),
      sample(10_000, 'moderate', { powerW: 4 }),
    ],
    ...over,
  };
}

describe('summarizeRun', () => {
  it('splits time into reading, writing and the rest, and gives reading speed', () => {
    const m = summarizeRun(run());
    expect(m.prefillS).toBe(0.5);
    expect(m.prefillTps).toBe(400);
    expect(m.decodeS).toBe(5);
    expect(m.turnS).toBe(8);
    expect(m.otherS).toBeCloseTo(2.5);
  });

  it('counts time in each thermal level and when the phone first warmed up', () => {
    const m = summarizeRun(run());
    expect(m.thermalNominalS).toBe(5);
    expect(m.thermalFairS).toBe(3);
    expect(m.thermalModerateS).toBe(2);
    // Loading started at 1 s; the first non-nominal sample is at 5 s.
    expect(m.firstEscalationS).toBe(4);
  });

  it('reports peak power, watts per tok/s, Android extras and the starting conditions', () => {
    const m = summarizeRun(run());
    expect(m.powerPeakW).toBe(5);
    expect(m.wattsPerTps).toBeCloseTo(m.powerActiveW! / 20);
    expect(m.cpuFreqAvgMHz).toBe(1800);
    expect(m.batteryTempMaxC).toBe(35);
    expect(m.startBattery).toBe(0.9);
    expect(m.startCharging).toBe(false);
    expect(m.startBrightness).toBe(0.5);
    expect(m.temperature).toBe(0);
  });

  it('falls back to time to first token where the runtime gives no prefill time', () => {
    const r = run();
    delete r.turns[0]!.generations[0]!.prefillMs;
    expect(summarizeRun(r).prefillS).toBe(0.6);
  });
});
