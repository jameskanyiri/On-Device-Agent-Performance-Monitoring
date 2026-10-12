import type { RunResult } from '@/shared/protocol';
import type { MetricSample } from '@/shared/device-metrics';

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
  powerIdleW?: number;
  powerActiveW?: number;
  energyJ?: number;
  energyAboveIdleJ?: number;
  joulesPerToken?: number;
  batteryStart?: number;
  batteryEnd?: number;
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

export function summarizeRun(run: RunResult): RunMetrics {
  const gens = run.turns.flatMap((t) => t.generations);
  const decodeS = sum(gens.map((g) => g.decodeMs)) / 1000;
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

  // Thermal: hottest state reached and time spent above nominal.
  let thermalMax: string | undefined;
  let thermalElevatedS = 0;
  const all = samples.filter((s) => s.t >= idleStart);
  for (let i = 0; i < all.length; i++) {
    const s = all[i]!;
    if (!s.thermal) continue;
    if (thermalMax === undefined || (THERMAL_RANK[s.thermal] ?? 0) > (THERMAL_RANK[thermalMax] ?? 0)) {
      thermalMax = s.thermal;
    }
    const next = all[i + 1];
    if (next && (THERMAL_RANK[s.thermal] ?? 0) > 0) thermalElevatedS += (next.t - s.t) / 1000;
  }

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

  const firstTurn = run.turns[0];
  const firstGen = firstTurn?.generations[0];
  const batteries = samples.map((s) => s.batteryLevel).filter((x): x is number => x !== undefined);

  return {
    ok: run.ok,
    loadS: run.load && run.load.sessionCreateMs / 1000,
    initTokens: run.load?.initTokens,
    maxSeqLen: run.load?.maxSeqLen,
    turnS: run.turns.length ? sum(run.turns.map((t) => t.endedAt - t.startedAt)) / 1000 : undefined,
    ttftS: firstGen && firstGen.ttftMs / 1000,
    firstTokenWallS: firstTurn?.firstTokenWallMs !== undefined ? firstTurn.firstTokenWallMs / 1000 : undefined,
    modelCalls: gens.length,
    promptTokens: sum(gens.map((g) => g.promptTokens)),
    generatedTokens,
    decodeTps: decodeS > 0 ? generatedTokens / decodeS : undefined,
    kvPeak: Math.max(0, ...run.turns.map((t) => t.kvPosAfter ?? 0)) || undefined,
    toolCalls: run.tools.length,
    toolErrors: run.tools.filter((t) => !t.ok).length,
    toolS: sum(run.tools.map((t) => t.durationMs ?? 0)) / 1000,
    memIdleMB: mb(memIdle),
    memPeakMB: mb(memPeak),
    memDeltaMB: memIdle !== undefined && memPeak !== undefined ? mb(memPeak - memIdle) : undefined,
    memAvailMinMB: avail.length ? mb(Math.min(...avail)) : undefined,
    cpuPct,
    cpuPeakPct,
    thermalStart: all.find((s) => s.thermal)?.thermal,
    thermalMax,
    thermalElevatedS,
    powerIdleW,
    powerActiveW: energyJ !== undefined && activeS ? energyJ / activeS : undefined,
    energyJ,
    energyAboveIdleJ,
    joulesPerToken: energyJ !== undefined && generatedTokens > 0 ? energyJ / generatedTokens : undefined,
    batteryStart: batteries[0],
    batteryEnd: batteries.at(-1),
    charging: samples.some((s) => s.batteryState === 'charging' || s.batteryState === 'full'),
  };
}
