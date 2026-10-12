export const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function fmtDur(ms: number | null | undefined): string {
  if (!isNum(ms)) return '–';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  return `${m}m ${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`;
}

export const fmtNum = (x: number | null | undefined, digits = 0) =>
  isNum(x) ? x.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '–';

export const fmtMB = (x: number | null | undefined) =>
  isNum(x) ? (x >= 1000 ? `${(x / 1000).toFixed(2)} GB` : `${Math.round(x)} MB`) : '–';

export const fmtPct = (x: number | null | undefined) => (isNum(x) ? `${Math.round(x)}%` : '–');

export const fmtClock = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const fmtDate = (t: number | string) =>
  new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function ago(t: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return fmtDate(t);
}

export const clipText = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Thermal states → status color + label (status colors always ship with a label). */
export const THERMAL: Record<string, [StatusTone, string]> = {
  nominal: ['good', 'Nominal'],
  fair: ['warning', 'Fair'],
  light: ['warning', 'Light'],
  moderate: ['serious', 'Moderate'],
  serious: ['serious', 'Serious'],
  severe: ['serious', 'Severe'],
  critical: ['critical', 'Critical'],
  emergency: ['critical', 'Emergency'],
  shutdown: ['critical', 'Shutdown'],
};

export type StatusTone = 'good' | 'warning' | 'serious' | 'critical';
