import type { RunResult, TaskSpec } from '@/shared/protocol';

export type CheckOutcome = { pass: boolean; detail: string };

/** A benchmark task: what the phone runs (TaskSpec) plus how the Mac grades it. */
export type Task = TaskSpec & {
  title: string;
  /** False for tasks that need no tools: any tool call there is counted as unnecessary. */
  needsTools: boolean;
  check: (run: RunResult) => CheckOutcome;
};

// ── Helpers for writing checks ─────────────────────────────────────────────

export const lastReply = (run: RunResult) => run.turns.at(-1)?.reply ?? '';

export const fileAfter = (run: RunResult, path: string) => run.workspaceAfter[path];

/** Passes when every check passes; reports the first failure. */
export function all(...outcomes: CheckOutcome[]): CheckOutcome {
  const failed = outcomes.find((o) => !o.pass);
  return failed ?? { pass: true, detail: outcomes.map((o) => o.detail).join('; ') };
}

export function replyMatches(run: RunResult, pattern: RegExp): CheckOutcome {
  const reply = lastReply(run);
  return pattern.test(reply)
    ? { pass: true, detail: `reply matches ${pattern}` }
    : { pass: false, detail: `reply doesn't match ${pattern}: "${clip(reply)}"` };
}

export function fileMatches(run: RunResult, path: string, ...patterns: RegExp[]): CheckOutcome {
  const content = fileAfter(run, path);
  if (content === undefined) return { pass: false, detail: `${path} doesn't exist` };
  const missing = patterns.find((p) => !p.test(content));
  return missing
    ? { pass: false, detail: `${path} doesn't match ${missing}: "${clip(content)}"` }
    : { pass: true, detail: `${path} matches` };
}

const clip = (text: string, n = 120) =>
  text.length > n ? `${text.slice(0, n).replace(/\n/g, ' ')}…` : text.replace(/\n/g, ' ');
