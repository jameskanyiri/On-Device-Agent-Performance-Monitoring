import { describe, expect, it } from 'vitest';

import type { RunResult } from '@/shared/protocol';
import { BARE_SUITE } from './bare';
import { NOTES } from './file-tools';
import { MULTI_STEP_SUITE } from './multi-step';
import { STEP_1_SUITE } from './step-1';

const TODO = NOTES['/todo.md'];
const run = (files: Record<string, string>, reply = 'Done.') => ({ turns: [{ reply }], workspaceAfter: { ...NOTES, ...files } }) as unknown as RunResult;
const check = (id: string, files: Record<string, string>, reply?: string) => MULTI_STEP_SUITE.find((t) => t.id === id)!.check(run(files, reply));

describe('multi-step checks', () => {
  it('dentist-plan: todo item with date and time, plus the reminder file', () => {
    const reminder = { '/drafts/dentist-reminder.txt': 'Reminder: dentist on the 14th at 9am.' };
    expect(check('dentist-plan', { '/todo.md': `${TODO}- [ ] Dentist on the 14th at 9am\n`, ...reminder }).pass).toBe(true);
    // No date in the new item.
    expect(check('dentist-plan', { '/todo.md': `${TODO}- [ ] Go to the dentist\n`, ...reminder }).pass).toBe(false);
    // Only ticked the existing "Book dentist" item.
    expect(check('dentist-plan', { '/todo.md': TODO.replace('[ ] Book dentist', '[x] Book dentist on the 14th at 9am'), ...reminder }).pass).toBe(false);
    // Rewrote the todo and lost items.
    expect(check('dentist-plan', { '/todo.md': '# Todo\n\n- [ ] Dentist on the 14th at 9am\n', ...reminder }).pass).toBe(false);
    // Said it saved the reminder but didn't.
    expect(check('dentist-plan', { '/todo.md': `${TODO}- [ ] Dentist on the 14th at 9am\n` }, 'Saved the reminder!').pass).toBe(false);
  });

  it('budget-handoff: summary with amount, owner and review; todo item', () => {
    const summary = { '/summaries/q4-budget.md': '# Q4 budget\n\n- Amount: $4,200\n- Owner: Wanjiru\n- Next review: November\n' };
    expect(check('budget-handoff', { ...summary, '/todo.md': `${TODO}- [ ] Review Q4 budget with Wanjiru\n` }).pass).toBe(true);
    expect(check('budget-handoff', { '/summaries/q4-budget.md': 'Budget: $4,200, owner Wanjiru.', '/todo.md': `${TODO}- [ ] Review Q4 budget with Wanjiru\n` }).pass).toBe(false);
    expect(check('budget-handoff', summary).pass).toBe(false);
  });

  it('drafts-index: both drafts described, and the count in the reply', () => {
    const index = { '/drafts/index.md': '- letter.txt: a letter to the landlord about a leaking tap\n- ideas.txt: a plant watering app idea\n' };
    expect(check('drafts-index', index, 'There are 2 drafts.').pass).toBe(true);
    expect(check('drafts-index', index, 'There are 3 drafts.').pass).toBe(false);
    expect(check('drafts-index', { '/drafts/index.md': '- letter.txt\n- ideas.txt\n' }, 'There are two drafts.').pass).toBe(false);
  });

  it('landlord-follow-up: letter kept and extended; todo item', () => {
    const letter = { '/drafts/letter.txt': 'Dear landlord,\n\nThe kitchen tap is leaking again. Could you please fix it by Friday?\n' };
    expect(check('landlord-follow-up', { ...letter, '/todo.md': `${TODO}- [ ] Follow up with landlord about the tap\n` }).pass).toBe(true);
    // Replaced the letter instead of keeping it.
    expect(check('landlord-follow-up', { '/drafts/letter.txt': 'Please fix the tap by Friday.', '/todo.md': `${TODO}- [ ] Follow up with landlord about the tap\n` }).pass).toBe(false);
    expect(check('landlord-follow-up', letter).pass).toBe(false);
  });

  it('the untouched workspace fails every task', () => {
    for (const task of MULTI_STEP_SUITE) expect(task.check(run({}, 'Done!')).pass, task.id).toBe(false);
  });
});

describe('step-1 suite', () => {
  it('has every task once: bare, file tools and multi-step', () => {
    const ids = STEP_1_SUITE.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([...BARE_SUITE.map((t) => t.id), 'find-fact', 'edit-todo', ...MULTI_STEP_SUITE.map((t) => t.id)]));
  });

  it('unseen-file counts "doesn’t exist" as honest (tools on, empty workspace)', () => {
    const unseen = BARE_SUITE.find((t) => t.id === 'unseen-file')!;
    expect(unseen.check(run({}, 'The file /notes/budget-sync.md doesn’t exist in your workspace.')).pass).toBe(true);
  });
});
