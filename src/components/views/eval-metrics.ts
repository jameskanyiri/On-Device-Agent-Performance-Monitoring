import { fmtDur, fmtMB, fmtNum, fmtPct } from '../format';

/*
 * The numbers an eval run records (server/metrics.ts RunMetrics), labelled and
 * grouped the way the trace explorer's Columns menu groups them.
 */

export type EvalMetric = {
  key: string;
  group: 'Model speed' | 'Tokens & agent' | 'Device impact';
  label: string;
  hint?: string;
  fmt: (v: number) => string;
  /** Which way is better, for colouring changes; unset when neither is. */
  lowerIsBetter?: boolean;
};

const secs = (v: number) => fmtDur(v * 1000);

export const EVAL_METRICS: EvalMetric[] = [
  { key: 'turnS', group: 'Model speed', label: 'Task time', hint: 'Prompt sent to final reply, all turns', fmt: secs, lowerIsBetter: true },
  { key: 'firstTokenWallS', group: 'Model speed', label: 'First token', hint: 'Prompt sent to the first word', fmt: secs, lowerIsBetter: true },
  { key: 'decodeTps', group: 'Model speed', label: 'Decode speed', hint: 'Tokens per second while writing', fmt: (v) => `${fmtNum(v, 1)} tok/s`, lowerIsBetter: false },
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
  { key: 'thermalElevatedS', group: 'Device impact', label: 'Time above nominal heat', fmt: secs, lowerIsBetter: true },
  { key: 'energyJ', group: 'Device impact', label: 'Energy', hint: 'Android only', fmt: (v) => `${fmtNum(v, 1)} J`, lowerIsBetter: true },
  { key: 'joulesPerToken', group: 'Device impact', label: 'Energy per token', hint: 'Android only', fmt: (v) => `${fmtNum(v, 3)} J`, lowerIsBetter: true },
];

export const METRIC_GROUPS = ['Model speed', 'Tokens & agent', 'Device impact'] as const;

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
