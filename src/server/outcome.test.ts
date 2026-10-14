import { describe, expect, it } from 'vitest';

import type { RunResult, ToolRecord, TurnRecord } from '@/shared/protocol';
import { runOutcome, toolRepeats } from './outcome';

const turn = (reply: string, finishReason: TurnRecord['finishReason'] = 'stop'): TurnRecord => ({
  index: 0,
  prompt: 'p',
  reply,
  finishReason,
  startedAt: 0,
  endedAt: 1,
  generations: [],
});
const run = (turns: TurnRecord[], ok = true, tools: ToolRecord[] = []) => ({ ok, turns, tools }) as unknown as RunResult;
const pass = { pass: true, detail: '' };
const fail = { pass: false, detail: '' };

describe('runOutcome', () => {
  it('finished when the check passes', () => {
    expect(runOutcome(run([turn('Done: /shopping.md now lists milk, eggs and bread.')]), pass)).toBe('finished');
  });

  it('crashed on errors and time-outs, before anything else', () => {
    expect(runOutcome(run([turn('')], false), fail)).toBe('crashed');
    expect(runOutcome(run([turn('partial', 'timeout')], false), fail)).toBe('crashed');
  });

  it('hit the tool limit even when the reply looks fine', () => {
    expect(runOutcome(run([turn('Let me check again.', 'maxToolTurns')]), fail)).toBe('tool-limit');
  });

  it('asked instead of acting', () => {
    expect(runOutcome(run([turn('Could you tell me which file holds your budget notes?')]), fail)).toBe('asked');
    expect(runOutcome(run([turn('What would you like the reminder to say?')]), fail)).toBe('asked');
    expect(runOutcome(run([turn('Please provide the file path.')]), fail)).toBe('asked');
  });

  it('gave up, with curly apostrophes too', () => {
    expect(runOutcome(run([turn('I couldn’t find any notes about the dentist.')]), fail)).toBe('gave-up');
    expect(runOutcome(run([turn('The file /notes/budget.md does not exist.')]), fail)).toBe('gave-up');
  });

  it('gave up: no access, cannot tell, cannot fulfil (seen on the phone, 14 Oct)', () => {
    expect(runOutcome(run([turn('I am sorry, but I do not have access to your workspace or files. Therefore, I cannot tell you how many.')]), fail)).toBe('gave-up');
    expect(runOutcome(run([turn('I am sorry, but I cannot fulfill that request.')]), fail)).toBe('gave-up');
  });

  it('searched, found nothing, then asked: gave up, not asked instead', () => {
    const glob: ToolRecord = { turn: 0, name: 'glob', ok: true, args: { pattern: '**/budget_sync_notes.md' } };
    const reply = 'I could not find any file named `budget_sync_notes.md`. Could you please check the file name?';
    expect(runOutcome(run([turn(reply)], true, [glob]), fail)).toBe('gave-up');
    // A failed call is no work done: still asked instead.
    const failed: ToolRecord = { turn: 0, name: 'read_file', ok: false, args: { file_path: '/notes' } };
    expect(runOutcome(run([turn('Could you please run ls on /notes first?')], true, [failed]), fail)).toBe('asked');
  });

  it('claimed it made changes after its edits failed: wrong, not asked', () => {
    const tools: ToolRecord[] = [
      { turn: 0, name: 'read_file', ok: true, args: { file_path: '/drafts/letter.txt' } },
      { turn: 0, name: 'edit_file', ok: false, args: { file_path: '/drafts/letter.txt' } },
    ];
    const reply = 'I have made the following changes: I edited /drafts/letter.txt. Would you like me to do anything else?';
    expect(runOutcome(run([turn(reply)], true, tools), fail)).toBe('wrong');
  });

  it('wrong when it confidently answers and the check fails', () => {
    expect(runOutcome(run([turn('The budget is $5,000.')]), fail)).toBe('wrong');
    expect(runOutcome(run([turn('29')]), fail)).toBe('wrong');
  });
});

const call = (name: string, args: Record<string, unknown>): ToolRecord => ({ turn: 0, name, ok: true, args });

describe('toolRepeats', () => {
  it('no repeats for distinct calls', () => {
    expect(toolRepeats([call('grep', { pattern: 'dentist' }), call('read_file', { path: '/todo.md' })])).toEqual({ repeats: 0, looped: false });
  });

  it('the same call twice in a row is a loop', () => {
    expect(toolRepeats([call('read_file', { path: '/todo.md' }), call('read_file', { path: '/todo.md' })])).toEqual({ repeats: 1, looped: true });
  });

  it('a call made three times is a loop, even with others in between', () => {
    const r = call('ls', { path: '/' });
    expect(toolRepeats([r, call('glob', { pattern: '*.md' }), r, call('grep', { pattern: 'x' }), r])).toEqual({ repeats: 2, looped: true });
  });

  it('a call made twice with work in between is a repeat but not a loop', () => {
    const r = call('read_file', { path: '/todo.md' });
    expect(toolRepeats([r, call('edit_file', { path: '/todo.md', old: 'a', new: 'b' }), r])).toEqual({ repeats: 1, looped: false });
  });

  it('argument order does not matter', () => {
    expect(toolRepeats([call('read_file', { path: '/a', offset: 1 }), call('read_file', { offset: 1, path: '/a' })]).looped).toBe(true);
  });
});
