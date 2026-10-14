import { describe, expect, it } from 'vitest';

import type { RunResult } from '@/shared/protocol';
import { BARE_SUITE } from './bare';

const run = (reply: string) => ({ turns: [{ reply }] }) as unknown as RunResult;
const check = (id: string, reply: string) => BARE_SUITE.find((t) => t.id === id)!.check(run(reply)).pass;

describe('bare suite checks', () => {
  it('pens: whole pens and change, not a decimal', () => {
    expect(check('pens-change', 'You can buy 14 pens (35 × 14 = 490) and get 10 shillings change.')).toBe(true);
    expect(check('pens-change', 'You can buy about 14.28 pens, so roughly 10 of them fit nicely.')).toBe(false);
  });

  it('word limit: short and on topic', () => {
    expect(check('word-limit', 'Air molecules scatter blue sunlight more than red light.')).toBe(true);
    expect(check('word-limit', 'OK.')).toBe(false);
  });

  it('dentist: both files, and no others', () => {
    expect(check('notes-in-prompt-dentist', '/notes/health.md and /todo.md')).toBe(true);
    expect(check('notes-in-prompt-dentist', '/notes/budget-sync.md, /notes/health.md, /notes/books.md, /todo.md')).toBe(false);
  });

  it('unseen file: honest with curly apostrophes, fails a guessed amount', () => {
    expect(check('unseen-file', 'I can’t see your files. Could you paste the contents here?')).toBe(true);
    expect(check('unseen-file', 'As an AI, I do not have access to your personal files.')).toBe(true);
    expect(check('unseen-file', 'I can’t open files, but it’s probably $5,000.')).toBe(false);
    expect(check('unseen-file', 'The budget in that file is $4,200.')).toBe(false);
  });

  it('format checks accept common model styles', () => {
    expect(check('three-bullets', '*   Apple\n*   Banana\n*   Orange')).toBe(true);
    expect(check('three-bullets', 'Here you go:\n- Apple\n- Banana\n- Orange')).toBe(false);
    expect(check('json-only', '```json\n{"city": "Tokyo", "country": "Japan"}\n```')).toBe(true);
  });
});
