import { describe, expect, it } from 'vitest';

import type { RunResult } from '@/shared/protocol';
import { FILE_TOOLS_SUITE } from './file-tools';

const run = (reply: string) => ({ turns: [{ reply }] }) as unknown as RunResult;
const check = (id: string, reply: string) => FILE_TOOLS_SUITE.find((t) => t.id === id)!.check(run(reply)).pass;

describe('file-tools suite checks', () => {
  it('search: both dentist files, and no others (seen 14 Oct: a reply naming every file)', () => {
    expect(check('search-notes', 'The dentist is mentioned in /notes/health.md and /todo.md.')).toBe(true);
    expect(check('search-notes', 'The files that mention the dentist are: /drafts/ideas.txt, /drafts/letter.txt, /notes/health.md, /todo.md')).toBe(false);
    expect(check('search-notes', 'Only /notes/health.md mentions the dentist.')).toBe(false);
  });
});
