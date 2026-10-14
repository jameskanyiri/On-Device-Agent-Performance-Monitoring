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

describe('runOutcome: context full', () => {
  // dentist-plan with planning, 14 Oct: 7 calls from 1,351 tokens, then prefill failed.
  const tools: ToolRecord[] = [
    { turn: 0, name: 'todo', ok: true, args: { steps: [{ step: 'Find the dentist appointment in my notes.', done: false }, { step: 'Add a todo item to /todo.md with the date and time.', done: false }, { step: 'Save a reminder to /drafts/dentist-reminder.txt.', done: false }] }, resultChars: 255 },
    { turn: 0, name: 'read_file', ok: false, args: { file_path: '/notes' }, resultChars: 46 },
    { turn: 0, name: 'ls', ok: true, args: { path: '/notes' }, resultChars: 54 },
    { turn: 0, name: 'read_file', ok: true, args: { file_path: '/notes/health.md' }, resultChars: 100 },
    { turn: 0, name: 'todo', ok: true, args: { steps: [{ step: 'Find the dentist appointment in my notes.', done: true }, { step: 'Add a todo item to /todo.md with the date and time.', done: false }, { step: 'Save a reminder to /drafts/dentist-reminder.txt.', done: false }] }, resultChars: 279 },
    { turn: 0, name: 'write_file', ok: true, args: { content: 'Appointment on the 14th at 9am.', file_path: '/drafts/dentist-reminder.txt' }, resultChars: 41 },
    { turn: 0, name: 'write_file', ok: false, args: { content: 'Date: 14th, Time: 9am', file_path: '/todo.md' }, resultChars: 84 },
  ];
  const crashed = (error: string, initTokens: number) =>
    ({ ok: false, error, load: { sessionCreateMs: 1, initTokens, maxSeqLen: 2048 }, tools, turns: [{ ...turn('', 'error'), kvPosBefore: initTokens }] }) as unknown as RunResult;

  it('a failed prefill near the window is context full', () => {
    expect(runOutcome(crashed('LLMRunner.prefill: Failed: Error::Internal', 1351), fail)).toBe('context-full');
  });

  it('landlord-follow-up, 14 Oct: estimated at 1,810, but an identical run measured 1,978', () => {
    const landlord: ToolRecord[] = [
      { turn: 0, name: 'todo', ok: true, args: { steps: [{ step: 'keep what is there and add a sentence asking them to fix the tap by Friday to /drafts/letter.txt', done: false }, { step: 'add "Follow up with landlord" to /todo.md', done: false }] }, resultChars: 276 },
      { turn: 0, name: 'read_file', ok: true, args: { file_path: '/drafts/letter.txt' }, resultChars: 70 },
      { turn: 0, name: 'edit_file', ok: false, args: { file_path: '/drafts/letter.txt', old_string: '     1\tDear landlord,', new_string: 'Dear landlord, please fix the tap by Friday.' }, resultChars: 105 },
      { turn: 0, name: 'write_file', ok: false, args: { file_path: '/todo.md', content: '- [ ] Follow up with landlord' }, resultChars: 84 },
    ];
    const r = { ok: false, error: 'LLMRunner.prefill: Failed: Error::Internal', load: { sessionCreateMs: 1, initTokens: 1351, maxSeqLen: 2048 }, tools: landlord, turns: [{ ...turn('', 'error'), kvPosBefore: 1351 }] } as unknown as RunResult;
    expect(runOutcome(r, fail)).toBe('context-full');
  });

  it('the same failure far from the window, or another error, is a crash', () => {
    expect(runOutcome(crashed('LLMRunner.prefill: Failed: Error::Internal', 200), fail)).toBe('crashed');
    expect(runOutcome(crashed('Turn 1 timed out after 240 s', 1351), fail)).toBe('crashed');
  });
});

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

  it('nested arguments count: ticking a todo step is not a repeat (bug seen 14 Oct)', () => {
    const todo = (done: boolean) => call('todo', { steps: [{ step: 'find the budget', done }] });
    expect(toolRepeats([todo(false), todo(true)])).toEqual({ repeats: 0, looped: false });
    expect(toolRepeats([todo(false), todo(false)])).toEqual({ repeats: 1, looped: true });
  });

  it('argument order does not matter', () => {
    expect(toolRepeats([call('read_file', { path: '/a', offset: 1 }), call('read_file', { offset: 1, path: '/a' })]).looped).toBe(true);
  });
});
