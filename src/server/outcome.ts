import type { RunResult, ToolRecord } from '@/shared/protocol';
import type { CheckOutcome } from './checks';

/*
 * How a run ended, beyond pass/fail: "with tools, it finishes X% of tasks" needs
 * to know why the rest didn't. Worked out from the run record on the Mac, so
 * old sessions get it too.
 */

export type RunOutcome = 'finished' | 'wrong' | 'gave-up' | 'asked' | 'tool-limit' | 'crashed';

export const OUTCOMES: { id: RunOutcome; label: string; hint: string }[] = [
  { id: 'finished', label: 'Finished', hint: 'Did the task: the check passed' },
  { id: 'wrong', label: 'Wrong result', hint: 'Answered or acted, but the check failed' },
  { id: 'gave-up', label: 'Gave up', hint: 'Said it couldn’t do it or couldn’t find it' },
  { id: 'asked', label: 'Asked instead', hint: 'Asked the user a question instead of acting' },
  { id: 'tool-limit', label: 'Hit tool limit', hint: 'Ran out of tool calls (maxToolTurns)' },
  { id: 'crashed', label: 'Crashed', hint: 'The run errored or timed out' },
];

const GAVE_UP = /\b(can['’]?t|cannot|couldn['’]?t|unable to|not able to|wasn['’]?t able)\b.{0,40}\b(find|locate|access|open|read|see|do|complete|edit|create|save)|\b(doesn['’]?t|does not) (seem to )?exist|\bno such file|\bnot found\b/i;
const ASKS = /\b(could|can|would) you\b[^.?!]*\?|\bplease (provide|tell|specify|share|confirm|clarify|let me know)\b|\bwhat would you like\b|\bdo you want me to\b[^.?!]*\?|\bwhich (file|one|note)s?\b[^.?!]*\?/i;

export function runOutcome(run: RunResult, check: CheckOutcome): RunOutcome {
  const finish = run.turns.map((t) => t.finishReason);
  if (!run.ok || finish.includes('error') || finish.includes('timeout')) return 'crashed';
  if (finish.includes('maxToolTurns')) return 'tool-limit';
  if (check.pass) return 'finished';
  const reply = run.turns.at(-1)?.reply ?? '';
  if (ASKS.test(reply)) return 'asked';
  if (GAVE_UP.test(reply)) return 'gave-up';
  return 'wrong';
}

/**
 * Doom loops: the same tool called with the same arguments again. `repeats` counts
 * every call beyond the first of its kind; `looped` is set when one call is made 3+
 * times, or twice in a row (nothing changed in between, so the second can't help).
 */
export function toolRepeats(tools: ToolRecord[]): { repeats: number; looped: boolean } {
  const key = (t: ToolRecord) => `${t.name} ${JSON.stringify(t.args ?? {}, Object.keys(t.args ?? {}).sort())}`;
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
