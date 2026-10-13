import type { RunResult } from '@/shared/protocol';
import type { MetricSample } from '@/shared/device-metrics';
import { runReading } from './reading';

/** Thermal states from coolest to hottest, per platform. */
const THERMAL_RANK: Record<string, number> = {
  nominal: 0,
  fair: 1, // iOS
  light: 1, // Android
  moderate: 2,
  serious: 3, // iOS
  severe: 3,
  critical: 4,
  emergency: 5,
  shutdown: 6,
};

/** Everything the report needs from one run. Undefined = not measured on this run/platform. */
export type RunMetrics = {
  ok: boolean;
  // Model / harness
  loadS?: number;
  initTokens?: number;
  maxSeqLen?: number;
  turnS?: number;
  ttftS?: number;
  firstTokenWallS?: number;
  modelCalls: number;
  promptTokens: number;
  generatedTokens: number;
  decodeTps?: number;
  /** Reading the prompt (prefill), all model calls. */
  prefillS?: number;
  /** Prompt tokens read per second of prefill. */
  prefillTps?: number;
  /** Writing (first token → last), all model calls. */
  decodeS?: number;
  /** Turn time not spent reading, writing or in tools (harness, parsing, scheduling). */
  otherS?: number;
  kvPeak?: number;
  toolCalls: number;
  toolErrors: number;
  toolS: number;
  // Device
  memIdleMB?: number;
  memPeakMB?: number;
  memDeltaMB?: number;
  memAvailMinMB?: number;
  cpuPct?: number;
  cpuPeakPct?: number;
  thermalStart?: string;
  thermalMax?: string;
  thermalElevatedS?: number;
  /** Seconds in each thermal level (Android's light counts as fair, severe as serious). */
  thermalNominalS?: number;
  thermalFairS?: number;
  thermalModerateS?: number;
  thermalSeriousS?: number;
  thermalCriticalS?: number;
  /** Seconds from the model starting to load until the phone first left nominal (unset if it never did). */
  firstEscalationS?: number;
  powerIdleW?: number;
  powerActiveW?: number;
  powerPeakW?: number;
  /** Average power per token/s of decode speed: lower means more efficient (Android). */
  wattsPerTps?: number;
  batteryTempMaxC?: number;
  /** Android's thermal forecast at its highest (1 = severe throttling). */
  thermalHeadroomMax?: number;
  cpuFreqAvgMHz?: number;
  gpuFreqAvgMHz?: number;
  // Where the phone started (just before the model loaded)
  startThermal?: string;
  startBattery?: number;
  startCharging?: boolean;
  startLowPower?: boolean;
  startBrightness?: number;
  // Generation settings
  temperature?: number;
  maxNewTokens?: number;
  energyJ?: number;
  energyAboveIdleJ?: number;
  joulesPerToken?: number;
  batteryStart?: number;
  batteryEnd?: number;
  /** Battery used during the run, in % (unset while charging; iOS reports in 1% steps). */
  batteryUsedPct?: number;
  /** Any sample while charging: power numbers are meaningless then. */
  charging: boolean;
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const median = (xs: number[]) => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1]! + s[mid]!) / 2;
};
const mb = (bytes?: number) => (bytes === undefined ? undefined : bytes / 1e6);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : undefined);
const nums = (xs: (number | null | undefined)[]) => xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));

/** Thermal levels shared by both platforms, for time-in-state. */
const LEVEL_KEYS = ['thermalNominalS', 'thermalFairS', 'thermalModerateS', 'thermalSeriousS', 'thermalCriticalS'] as const;

export function summarizeRun(run: RunResult): RunMetrics {
  const gens = run.turns.flatMap((t) => t.generations);
  const decodeS = sum(gens.map((g) => g.decodeMs)) / 1000;
  // Reading (prefill): tokens from context growth, time from the separate prefill + time to first token.
  const reading = runReading(run);
  const prefillS = gens.length ? sum(reading.map((r) => r.ms)) / 1000 : undefined;
  const readTokens = reading.every((r) => r.tokens !== null) ? sum(reading.map((r) => r.tokens!)) : undefined;
  const generatedTokens = sum(gens.map((g) => g.generatedTokens));
  const { idleStart, loadStart, turnsEnd } = run.phases;
  const activeEnd = turnsEnd ?? run.endedAt;

  const samples = run.samples;
  const idle = samples.filter((s) => s.t >= idleStart && (loadStart === undefined || s.t < loadStart));
  const active = loadStart === undefined ? [] : samples.filter((s) => s.t >= loadStart && s.t <= activeEnd);

  const footprints = (xs: MetricSample[]) =>
    xs.map((s) => s.memFootprintBytes).filter((x): x is number => x !== undefined);
  const memIdle = median(footprints(idle));
  const memPeak = footprints(active).length ? Math.max(...footprints(active)) : undefined;
  const avail = active.map((s) => s.memAvailableBytes).filter((x): x is number => x !== undefined);

  // CPU: total CPU time over wall time across the active window, and the busiest interval.
  let cpuPct: number | undefined;
  let cpuPeakPct: number | undefined;
  if (active.length >= 2) {
    const first = active[0]!;
    const last = active.at(-1)!;
    if (last.uptimeS > first.uptimeS) {
      cpuPct = ((last.cpuTimeS - first.cpuTimeS) / (last.uptimeS - first.uptimeS)) * 100;
    }
    for (let i = 1; i < active.length; i++) {
      const dt = active[i]!.uptimeS - active[i - 1]!.uptimeS;
      if (dt <= 0) continue;
      const pct = ((active[i]!.cpuTimeS - active[i - 1]!.cpuTimeS) / dt) * 100;
      cpuPeakPct = Math.max(cpuPeakPct ?? 0, pct);
    }
  }

  // Thermal: hottest state reached, time in each level, and when it first left nominal.
  let thermalMax: string | undefined;
  let thermalElevatedS = 0;
  let firstEscalationS: number | undefined;
  const levelS = [0, 0, 0, 0, 0];
  const all = samples.filter((s) => s.t >= idleStart);
  for (let i = 0; i < all.length; i++) {
    const s = all[i]!;
    if (!s.thermal) continue;
    const rank = THERMAL_RANK[s.thermal] ?? 0;
    if (thermalMax === undefined || rank > (THERMAL_RANK[thermalMax] ?? 0)) thermalMax = s.thermal;
    if (rank > 0 && firstEscalationS === undefined && loadStart !== undefined && s.t >= loadStart) firstEscalationS = (s.t - loadStart) / 1000;
    const next = all[i + 1];
    if (!next) continue;
    const dt = (next.t - s.t) / 1000;
    if (rank > 0) thermalElevatedS += dt;
    levelS[Math.min(4, rank)]! += dt;
  }
  const hasThermal = all.some((s) => s.thermal);

  // Energy (Android): integrate power over the active window, and compare with idle.
  const powerIdleW = median(idle.map((s) => s.powerW).filter((x): x is number => x !== undefined));
  let energyJ: number | undefined;
  const powered = active.filter((s) => s.powerW !== undefined);
  if (powered.length >= 2) {
    energyJ = 0;
    for (let i = 1; i < powered.length; i++) {
      const a = powered[i - 1]!;
      const b = powered[i]!;
      energyJ += ((a.powerW! + b.powerW!) / 2) * ((b.t - a.t) / 1000);
    }
  }
  const activeS = loadStart === undefined ? undefined : (activeEnd - loadStart) / 1000;
  const energyAboveIdleJ =
    energyJ !== undefined && powerIdleW !== undefined && activeS !== undefined
      ? energyJ - powerIdleW * activeS
      : undefined;

  const powerPeak = nums(active.map((s) => s.powerW));
  const powerActiveW = energyJ !== undefined && activeS ? energyJ / activeS : undefined;
  const decodeTps = decodeS > 0 ? generatedTokens / decodeS : undefined;
  // Tokens the model read: from context growth when known (the runtime's own count misses the user's message).
  const promptTokens = readTokens ?? sum(gens.map((g) => g.promptTokens));
  const turnS = run.turns.length ? sum(run.turns.map((t) => t.endedAt - t.startedAt)) / 1000 : undefined;
  const toolS = sum(run.tools.map((t) => t.durationMs ?? 0)) / 1000;
  const start = run.start;

  const firstTurn = run.turns[0];
  const firstGen = firstTurn?.generations[0];
  const batteries = samples.map((s) => s.batteryLevel).filter((x): x is number => x !== undefined);

  return {
    ok: run.ok,
    loadS: run.load && run.load.sessionCreateMs / 1000,
    initTokens: run.load?.initTokens,
    maxSeqLen: run.load?.maxSeqLen,
    turnS,
    ttftS: firstGen && firstGen.ttftMs / 1000,
    firstTokenWallS: firstTurn?.firstTokenWallMs !== undefined ? firstTurn.firstTokenWallMs / 1000 : undefined,
    modelCalls: gens.length,
    promptTokens,
    generatedTokens,
    decodeTps,
    prefillS,
    prefillTps: prefillS && readTokens !== undefined ? readTokens / prefillS : undefined,
    decodeS: gens.length ? decodeS : undefined,
    otherS: turnS !== undefined && prefillS !== undefined ? Math.max(0, turnS - prefillS - decodeS - toolS) : undefined,
    kvPeak: Math.max(0, ...run.turns.map((t) => t.kvPosAfter ?? 0)) || undefined,
    toolCalls: run.tools.length,
    toolErrors: run.tools.filter((t) => !t.ok).length,
    toolS,
    memIdleMB: mb(memIdle),
    memPeakMB: mb(memPeak),
    memDeltaMB: memIdle !== undefined && memPeak !== undefined ? mb(memPeak - memIdle) : undefined,
    memAvailMinMB: avail.length ? mb(Math.min(...avail)) : undefined,
    cpuPct,
    cpuPeakPct,
    thermalStart: all.find((s) => s.thermal)?.thermal,
    thermalMax,
    thermalElevatedS,
    ...(hasThermal ? Object.fromEntries(LEVEL_KEYS.map((k, i) => [k, levelS[i]])) : {}),
    firstEscalationS,
    powerIdleW,
    powerActiveW,
    powerPeakW: powerPeak.length ? Math.max(...powerPeak) : undefined,
    wattsPerTps: powerActiveW !== undefined && decodeTps ? powerActiveW / decodeTps : undefined,
    batteryTempMaxC: nums(active.map((s) => s.batteryTempC)).reduce<number | undefined>((a, b) => (a === undefined || b > a ? b : a), undefined),
    thermalHeadroomMax: nums(active.map((s) => s.thermalHeadroom)).reduce<number | undefined>((a, b) => (a === undefined || b > a ? b : a), undefined),
    cpuFreqAvgMHz: mean(nums(active.map((s) => s.cpuFreqAvgMHz))),
    gpuFreqAvgMHz: mean(nums(active.map((s) => s.gpuFreqMHz))),
    startThermal: start?.thermal,
    startBattery: start?.batteryLevel,
    startCharging: start ? start.batteryState === 'charging' || start.batteryState === 'full' : undefined,
    startLowPower: start?.lowPowerMode,
    startBrightness: start?.screenBrightness,
    temperature: run.generation?.temperature,
    maxNewTokens: run.generation?.maxNewTokens,
    energyJ,
    energyAboveIdleJ,
    joulesPerToken: energyJ !== undefined && generatedTokens > 0 ? energyJ / generatedTokens : undefined,
    batteryStart: batteries[0],
    batteryEnd: batteries.at(-1),
    batteryUsedPct:
      batteries.length >= 2 && !samples.some((s) => s.batteryState === 'charging' || s.batteryState === 'full') ? (batteries[0]! - batteries.at(-1)!) * 100 : undefined,
    charging: samples.some((s) => s.batteryState === 'charging' || s.batteryState === 'full'),
  };
}
