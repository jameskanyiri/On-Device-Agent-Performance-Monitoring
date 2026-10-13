import type { GenerationRecord, RunResult } from '@/shared/protocol';

/*
 * What the model read, and how long reading took. executorch's chat session
 * reads the user's message in a separate prefill (timed as prefillMs) and then
 * generates from just the turn header, so on the first model call of a turn
 * its prompt tokens and time to first token cover only that header. Later
 * calls (after tools) read the tool results inside generate. Tokens read in a
 * turn = context growth minus what the model wrote; the first call gets what
 * the later ones didn't. Same as the app's readingPerCall (observe/chat-tracing.ts).
 */

export type Reading = { tokens: number | null; ms: number };

export function readingPerCall(gens: GenerationRecord[], kvBefore?: number, kvAfter?: number): { tokens: number | null; ms: number; calls: Reading[] } {
  const calls: Reading[] = gens.map((g) => ({ tokens: g.promptTokens, ms: (g.prefillMs ?? 0) + g.ttftMs }));
  const written = gens.reduce((a, g) => a + g.generatedTokens, 0);
  let tokens: number | null = null;
  if (kvBefore !== undefined && kvAfter !== undefined && kvAfter >= kvBefore) {
    tokens = Math.max(0, kvAfter - kvBefore - written);
    const later = calls.slice(1).reduce((a, c) => a + (c.tokens ?? 0), 0);
    if (calls[0]) calls[0].tokens = Math.max(0, tokens - later);
  } else if (calls[0]) {
    calls[0].tokens = null;
  }
  return { tokens, ms: calls.reduce((a, c) => a + c.ms, 0), calls };
}

/** Reading for each turn of a run: context before is recorded, or the previous turn's after (the load's for the first). */
export function runReading(run: RunResult) {
  return run.turns.map((t, i) => {
    const before = t.kvPosBefore ?? (i === 0 ? run.load?.initTokens : run.turns[i - 1]?.kvPosAfter);
    return readingPerCall(t.generations, before, t.kvPosAfter);
  });
}
