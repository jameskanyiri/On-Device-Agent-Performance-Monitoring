import { fmtDur, fmtMB, fmtNum, fmtPct } from '../format';

/*
 * The numbers an eval run records (server/metrics.ts RunMetrics), labelled and
 * grouped the way the trace explorer's Columns menu groups them.
 */

export type EvalMetric = {
  key: string;
  group: (typeof METRIC_GROUPS)[number];
  label: string;
  hint?: string;
  fmt: (v: number) => string;
  /** Which way is better, for colouring changes; unset when neither is. */
  lowerIsBetter?: boolean;
};

export const METRIC_GROUPS = ['Model speed', 'Tokens & agent', 'Device impact', 'Heat', 'Power'] as const;

const secs = (v: number) => fmtDur(v * 1000);

export const EVAL_METRICS: EvalMetric[] = [
  { key: 'turnS', group: 'Model speed', label: 'Task time', hint: 'Prompt sent to final reply, all turns', fmt: secs, lowerIsBetter: true },
  { key: 'firstTokenWallS', group: 'Model speed', label: 'First token', hint: 'Prompt sent to the first word', fmt: secs, lowerIsBetter: true },
  { key: 'decodeTps', group: 'Model speed', label: 'Decode speed', hint: 'Tokens per second while writing', fmt: (v) => `${fmtNum(v, 1)} tok/s`, lowerIsBetter: false },
  { key: 'prefillTps', group: 'Model speed', label: 'Reading speed', hint: 'Prompt tokens read per second (prefill)', fmt: (v) => `${fmtNum(v)} tok/s`, lowerIsBetter: false },
  { key: 'prefillS', group: 'Model speed', label: 'Reading time', hint: 'Prefill, all model calls', fmt: secs, lowerIsBetter: true },
  { key: 'decodeS', group: 'Model speed', label: 'Writing time', hint: 'Decode, all model calls', fmt: secs, lowerIsBetter: true },
  { key: 'toolS', group: 'Model speed', label: 'Tool time', fmt: secs, lowerIsBetter: true },
  { key: 'otherS', group: 'Model speed', label: 'Other time', hint: 'Harness, parsing, scheduling', fmt: secs, lowerIsBetter: true },
  { key: 'loadS', group: 'Model speed', label: 'Model load', fmt: secs, lowerIsBetter: true },
  { key: 'modelCalls', group: 'Tokens & agent', label: 'Model calls', fmt: (v) => fmtNum(v, 1), lowerIsBetter: true },
  { key: 'initTokens', group: 'Tokens & agent', label: 'Prompt tokens at start', hint: 'System prompt + tool definitions', fmt: (v) => fmtNum(v), lowerIsBetter: true },
  { key: 'promptTokens', group: 'Tokens & agent', label: 'Prompt tokens read', hint: 'Every model call, tool results included', fmt: (v) => fmtNum(v), lowerIsBetter: true },
  { key: 'generatedTokens', group: 'Tokens & agent', label: 'Tokens out', fmt: (v) => fmtNum(v), lowerIsBetter: true },
  { key: 'kvPeak', group: 'Tokens & agent', label: 'Context used', hint: 'Most tokens in the model’s memory', fmt: (v) => fmtNum(v), lowerIsBetter: true },
  { key: 'toolCalls', group: 'Tokens & agent', label: 'Tool calls', fmt: (v) => fmtNum(v, 1) },
  { key: 'toolErrors', group: 'Tokens & agent', label: 'Tool errors', fmt: (v) => fmtNum(v, 1), lowerIsBetter: true },
  { key: 'memPeakMB', group: 'Device impact', label: 'Peak memory', fmt: fmtMB, lowerIsBetter: true },
  { key: 'memDeltaMB', group: 'Device impact', label: 'Memory added', hint: 'Peak minus idle before the run', fmt: fmtMB, lowerIsBetter: true },
  { key: 'memAvailMinMB', group: 'Device impact', label: 'Lowest headroom', hint: 'How close iOS came to stopping the app', fmt: fmtMB, lowerIsBetter: false },
  { key: 'cpuPct', group: 'Device impact', label: 'CPU', hint: '100% is one core', fmt: fmtPct, lowerIsBetter: true },
  { key: 'cpuPeakPct', group: 'Device impact', label: 'Peak CPU', hint: 'Busiest sampling interval', fmt: fmtPct, lowerIsBetter: true },
  { key: 'cpuFreqAvgMHz', group: 'Device impact', label: 'CPU frequency', hint: 'Android; drops when throttled', fmt: (v) => `${fmtNum(v)} MHz`, lowerIsBetter: false },
  { key: 'gpuFreqAvgMHz', group: 'Device impact', label: 'GPU frequency', hint: 'Android, where readable', fmt: (v) => `${fmtNum(v)} MHz`, lowerIsBetter: false },
  { key: 'thermalElevatedS', group: 'Heat', label: 'Time above nominal heat', fmt: secs, lowerIsBetter: true },
  { key: 'firstEscalationS', group: 'Heat', label: 'Time until warmer', hint: 'From model load to first leaving nominal', fmt: secs, lowerIsBetter: false },
  { key: 'thermalNominalS', group: 'Heat', label: 'Time nominal', fmt: secs },
  { key: 'thermalFairS', group: 'Heat', label: 'Time fair', hint: 'Android: light', fmt: secs, lowerIsBetter: true },
  { key: 'thermalModerateS', group: 'Heat', label: 'Time moderate', hint: 'Android only', fmt: secs, lowerIsBetter: true },
  { key: 'thermalSeriousS', group: 'Heat', label: 'Time serious', hint: 'Android: severe', fmt: secs, lowerIsBetter: true },
  { key: 'thermalCriticalS', group: 'Heat', label: 'Time critical', fmt: secs, lowerIsBetter: true },
  { key: 'batteryTempMaxC', group: 'Heat', label: 'Battery temperature', hint: 'Android, highest', fmt: (v) => `${fmtNum(v, 1)} °C`, lowerIsBetter: true },
  { key: 'thermalHeadroomMax', group: 'Heat', label: 'Thermal headroom', hint: 'Android forecast, highest (1 = severe)', fmt: (v) => fmtNum(v, 2), lowerIsBetter: true },
  { key: 'powerActiveW', group: 'Power', label: 'Average power', hint: 'Android only', fmt: (v) => `${fmtNum(v, 2)} W`, lowerIsBetter: true },
  { key: 'powerPeakW', group: 'Power', label: 'Peak power', hint: 'Android only', fmt: (v) => `${fmtNum(v, 2)} W`, lowerIsBetter: true },
  { key: 'energyJ', group: 'Power', label: 'Energy', hint: 'Android only', fmt: (v) => `${fmtNum(v, 1)} J`, lowerIsBetter: true },
  { key: 'energyAboveIdleJ', group: 'Power', label: 'Energy above idle', hint: 'Android only', fmt: (v) => `${fmtNum(v, 1)} J`, lowerIsBetter: true },
  { key: 'joulesPerToken', group: 'Power', label: 'Energy per token', hint: 'Android only', fmt: (v) => `${fmtNum(v * 1000)} mJ`, lowerIsBetter: true },
  { key: 'wattsPerTps', group: 'Power', label: 'Watts per tok/s', hint: 'Energy proportionality (lower is better)', fmt: (v) => fmtNum(v, 3), lowerIsBetter: true },
];

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

/** Sample standard deviation (n − 1); undefined below two values. */
export function stdev(xs: number[]): number | undefined {
  if (xs.length < 2) return undefined;
  const m = mean(xs)!;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Mean, spread and range of a set of runs, as the paper reports them. */
export function spread(xs: number[]) {
  const m = mean(xs);
  const sd = stdev(xs);
  return {
    n: xs.length,
    mean: m,
    sd,
    /** Coefficient of variation, in % (sd / mean). */
    cv: m && sd !== undefined ? (sd / Math.abs(m)) * 100 : undefined,
    min: xs.length ? Math.min(...xs) : undefined,
    max: xs.length ? Math.max(...xs) : undefined,
  };
}
