import { describe, expect, it } from 'vitest';

import type { RunResult } from '@/shared/protocol';
import { CONTEXT_LENGTH_SUITE } from './context-length';

const run = (reply: string) => ({ turns: [{ reply }] }) as unknown as RunResult;

describe('context-length suite', () => {
  it('keeps the largest prompt well inside the 2,048-token window', () => {
    // ~3 characters per token for these notes; leave room for the template and the reply.
    const longest = Math.max(...CONTEXT_LENGTH_SUITE.map((t) => t.turns[0]!.length));
    expect(longest / 3).toBeLessThan(1700);
  });

  it('hides the answer only once, and the filler never contains it', () => {
    for (const task of CONTEXT_LENGTH_SUITE) expect(task.turns[0]!.match(/4,200/g)).toHaveLength(1);
  });

  it('passes the right budget and fails a filler amount', () => {
    const task = CONTEXT_LENGTH_SUITE[0]!;
    expect(task.check(run('The agreed Q4 marketing budget is $4,200.')).pass).toBe(true);
    expect(task.check(run('The budget is 420 shillings.')).pass).toBe(false);
  });
});
