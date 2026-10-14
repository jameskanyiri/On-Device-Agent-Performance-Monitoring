import { all, fileAfter, fileMatches, replyMatches, type CheckOutcome, type Task } from '../checks';
import { NOTES } from './file-tools';

/*
 * Steps 1–2: tasks that take 4–6 tool calls (find, read, write, edit, report).
 * One-step tasks can't show whether planning helps; these can. They run in
 * step 1 (tools, no planner) first, so step 2 compares planning on the same tasks.
 * Checks read the workspace afterwards, not just the reply: the work has to be done.
 */

const TODO_ITEMS = [/-\s*\[ \]\s*Call mom/i, /-\s*\[ \]\s*Book dentist/i, /-\s*\[ \]\s*Renew passport/i];

/** /todo.md kept its three items and gained a new unchecked one matching every pattern. */
function todoGained(run: Parameters<Task['check']>[0], ...patterns: RegExp[]): CheckOutcome {
  const content = fileAfter(run, '/todo.md');
  if (content === undefined) return { pass: false, detail: '/todo.md is gone' };
  const lost = TODO_ITEMS.find((p) => !p.test(content));
  if (lost) return { pass: false, detail: `/todo.md lost an item (${lost})` };
  const added = content
    .split('\n')
    .filter((line) => /^\s*-\s*\[ \]/.test(line) && !TODO_ITEMS.some((p) => p.test(line)))
    .find((line) => patterns.every((p) => p.test(line)));
  return added ? { pass: true, detail: `/todo.md gained "${added.trim()}"` } : { pass: false, detail: `/todo.md has no new item matching ${patterns.join(' ')}: "${content.replace(/\n/g, ' ').slice(0, 160)}"` };
}

export const MULTI_STEP_SUITE: Task[] = [
  {
    // grep → read health.md → read todo → edit todo → write reminder
    id: 'dentist-plan',
    title: 'Multi-step: dentist appointment → todo + reminder',
    needsTools: true,
    files: NOTES,
    turns: [
      'Find my dentist appointment in my notes. Then add a todo item to /todo.md with the appointment’s date and time, and save a short reminder message about it to /drafts/dentist-reminder.txt.',
    ],
    check: (run) => all(todoGained(run, /dentist/i, /14/, /9/), fileMatches(run, '/drafts/dentist-reminder.txt', /dentist/i, /14/, /9/)),
  },
  {
    // find → read budget-sync → write summary → read todo → edit todo
    id: 'budget-handoff',
    title: 'Multi-step: budget notes → summary file + todo',
    needsTools: true,
    files: NOTES,
    turns: [
      'Read my budget sync notes. Create /summaries/q4-budget.md with the budget amount, who owns it and when the next review is. Then add "Review Q4 budget with Wanjiru" to my todo list in /todo.md.',
    ],
    check: (run) => all(fileMatches(run, '/summaries/q4-budget.md', /4,?200/, /wanjiru/i, /november/i), todoGained(run, /wanjiru/i)),
  },
  {
    // glob/ls → read letter → read ideas → write index → reply
    id: 'drafts-index',
    title: 'Multi-step: index the drafts folder',
    needsTools: true,
    files: NOTES,
    turns: [
      'Make an index of the .txt files in /drafts: save /drafts/index.md listing each file’s name with a one-line description of what it is about. Then tell me how many drafts there are.',
    ],
    check: (run) =>
      all(
        fileMatches(run, '/drafts/index.md', /letter\.txt/i, /ideas\.txt/i, /landlord|tap|leak/i, /plant|water/i),
        replyMatches(run, /\b(2|two)\b/i)
      ),
  },
  {
    // read letter → edit letter → read todo → edit todo
    id: 'landlord-follow-up',
    title: 'Multi-step: finish a letter + add a follow-up',
    needsTools: true,
    files: NOTES,
    turns: [
      'Finish my letter to the landlord in /drafts/letter.txt: keep what is there and add a sentence asking them to fix the tap by Friday. Then add "Follow up with landlord about the tap" to /todo.md.',
    ],
    check: (run) => all(fileMatches(run, '/drafts/letter.txt', /dear landlord/i, /kitchen tap is leaking/i, /friday/i), todoGained(run, /landlord/i)),
  },
];
