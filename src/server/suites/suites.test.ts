import { describe, expect, it } from 'vitest';

import type { RunResult } from '@/shared/protocol';
import { BARE_SUITE } from './bare';
import { CONTEXT_LENGTH_SUITE } from './context-length';

const withReply = (reply: string) => ({ turns: [{ reply }], workspaceAfter: {} }) as unknown as RunResult;
const check = (id: string, reply: string) => BARE_SUITE.find((t) => t.id === id)!.check(withReply(reply)).pass;

describe('bare suite checks', () => {
  it('counts bullet points exactly', () => {
    expect(check('three-bullets', '- Apple\n- Mango\n- Banana')).toBe(true);
    expect(check('three-bullets', 'Here you go:\n- Apple\n- Mango\n- Banana')).toBe(false);
    expect(check('three-bullets', '- Apple\n- Mango')).toBe(false);
  });
  it('wants JSON only, fenced or not', () => {
    expect(check('json-only', '{"city": "Tokyo", "country": "Japan"}')).toBe(true);
    expect(check('json-only', '```json\n{"city": "Tokyo", "country": "Japan"}\n```')).toBe(true);
    expect(check('json-only', 'Sure! {"city": "Tokyo", "country": "Japan"}')).toBe(false);
  });
  it('enforces the word limit', () => {
    expect(check('word-limit', 'Air scatters blue sunlight more than red, so the sky looks blue.')).toBe(true);
    expect(check('word-limit', 'The sky is blue because of Rayleigh scattering, where shorter wavelengths of sunlight are scattered much more by air molecules.')).toBe(false);
  });
  it('rewards admitting it cannot see a file, not inventing an answer', () => {
    expect(check('unseen-file', "I can't access your files.")).toBe(true);
    expect(check('unseen-file', 'The budget is $3,000.')).toBe(false);
  });
  it('checks arithmetic answers', () => {
    expect(check('pens-change', 'You can buy 14 pens and get 10 shillings change.')).toBe(true);
    expect(check('eggs-left', 'There are 31 eggs left.')).toBe(true);
  });
});

describe('context-length suite', () => {
  it('grows in the sizes it claims (≈ 4 characters per token) and stays under 2,048 tokens', () => {
    const sizes = CONTEXT_LENGTH_SUITE.map((t) => t.turns[0]!.length / 4);
    expect(sizes[0]).toBeGreaterThan(230);
    expect(sizes.at(-1)).toBeLessThan(1700);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThan(sizes[i - 1]!);
  });
  it('hides the answer in the middle', () => {
    const prompt = CONTEXT_LENGTH_SUITE[2]!.turns[0]!;
    const at = prompt.indexOf('$4,200') / prompt.length;
    expect(at).toBeGreaterThan(0.35);
    expect(at).toBeLessThan(0.65);
  });
});
