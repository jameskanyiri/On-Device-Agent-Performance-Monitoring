import type { RunResult, ToolRecord } from '@/shared/protocol';
import type { CheckOutcome } from './checks';

/*
 * How a run ended, beyond pass/fail: "with tools, it finishes X% of tasks" needs
 * to know why the rest didn't. Worked out from the run record on the Mac, so
 * old sessions get it too.
 */

export type RunOutcome = 'finished' | 'wrong' | 'gave-up' | 'asked' | 'tool-limit' | 'context-full' | 'crashed';

export const OUTCOMES: { id: RunOutcome; label: string; hint: string }[] = [
  { id: 'finished', label: 'Finished', hint: 'Did the task: the check passed' },
  { id: 'wrong', label: 'Wrong result', hint: 'Answered or acted, but the check failed' },
  { id: 'gave-up', label: 'Gave up', hint: 'Said it couldn’t do it, couldn’t find it or had no access' },
  { id: 'asked', label: 'Asked instead', hint: 'Asked the user a question without doing any work first' },
  { id: 'tool-limit', label: 'Hit tool limit', hint: 'Ran out of tool calls (maxToolTurns)' },
  { id: 'context-full', label: 'Context full', hint: 'The runtime failed reading more in, with the context estimated at 90%+ of the window' },
  { id: 'crashed', label: 'Crashed', hint: 'The run errored or timed out' },
];

const GAVE_UP = /\b(can['’]?t|cannot|could ?n['’]?o?t|unable to|not able to|wasn['’]?t able)\b.{0,40}\b(find|locate|access|open|read|see|do|complete|edit|create|save|tell|help|fulfill)|\b(do not|don['’]?t) have access|\b(doesn['’]?t|does not) (seem to )?exist|\bno such file|\bnot found\b/i;
const ASKS = /\b(could|can|would) you\b[^.?!]*\?|\bplease (provide|tell|specify|share|confirm|clarify|let me know)\b|\bwhat would you like\b|\bdo you want me to\b[^.?!]*\?|\bwhich (file|one|note)s?\b[^.?!]*\?/i;

export function runOutcome(run: RunResult, check: CheckOutcome): RunOutcome {
  const finish = run.turns.map((t) => t.finishReason);
  if (!run.ok || finish.includes('error') || finish.includes('timeout')) return contextFull(run) ? 'context-full' : 'crashed';
  if (finish.includes('maxToolTurns')) return 'tool-limit';
  if (check.pass) return 'finished';
  const reply = run.turns.at(-1)?.reply ?? '';
  // "Asked instead of acting" only if no tool call succeeded first: searching, finding
  // nothing and then asking is giving up.
  if (ASKS.test(reply) && !run.tools.some((t) => t.ok)) return 'asked';
  if (GAVE_UP.test(reply)) return 'gave-up';
  return 'wrong';
}

/**
 * A failed prefill with the context nearly full: the window ran out. The runtime rolls the
 * context back on failure, so it's estimated from the last turn's start, every tool call's
 * arguments and result (≈3 characters per token, measured 14 Oct), plus ~20 tokens of
 * chat-template markup per call.
 */
export function contextFull(run: RunResult): boolean {
  if (!/prefill/i.test(run.error ?? '') || !run.load?.maxSeqLen) return false;
  const last = run.turns.at(-1);
  const start = last?.kvPosBefore ?? run.load.initTokens;
  const calls = run.tools.filter((t) => t.turn === (last?.index ?? 0));
  const chars = calls.reduce((a, t) => a + JSON.stringify(t.args ?? {}).length + (t.resultChars ?? 0), 0);
  return start + chars / 3 + calls.length * 20 >= 0.9 * run.load.maxSeqLen;
}

/** JSON with object keys sorted at every depth, so argument order doesn't matter. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Doom loops: the same tool called with the same arguments again. `repeats` counts
 * every call beyond the first of its kind; `looped` is set when one call is made 3+
 * times, or twice in a row (nothing changed in between, so the second can't help).
 */
export function toolRepeats(tools: ToolRecord[]): { repeats: number; looped: boolean } {
  const key = (t: ToolRecord) => `${t.name} ${stableJson(t.args ?? {})}`;
  const counts = new Map<string, number>();
  let looped = false;
  tools.forEach((t, i) => {
    const k = key(t);
    const n = (counts.get(k) ?? 0) + 1;
    counts.set(k, n);
    if (n >= 3 || (i > 0 && key(tools[i - 1]!) === k)) looped = true;
  });
  const repeats = [...counts.values()].reduce((a, n) => a + n - 1, 0);
  return { repeats, looped };
}
