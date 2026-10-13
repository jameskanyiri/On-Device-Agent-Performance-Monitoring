import { all, fileMatches, replyMatches, type Task } from '../checks';

/*
 * Tasks for the filesystem tools. Each starts from its own workspace, so the
 * bare model (no tools) can't see the files: the gap between scenarios is the
 * tools' impact. `capital-of-kenya` needs no files and measures what the tools
 * cost (and whether the model calls them needlessly) on ordinary questions.
 */

export const NOTES = {
  '/notes/budget-sync.md':
    '# Budget sync — 1 Oct\n\n- Agreed marketing budget: $4,200 for Q4\n- Owner: Wanjiru\n- Next review: November\n',
  '/notes/health.md': '# Health\n\n- Dentist appointment on the 14th at 9am\n- Refill allergy meds\n',
  '/notes/books.md': '# Books to read\n\n- The Overstory\n- Project Hail Mary\n',
  '/todo.md': '# Todo\n\n- [ ] Call mom\n- [ ] Book dentist\n- [ ] Renew passport\n',
  '/drafts/letter.txt': 'Dear landlord,\n\nThe kitchen tap is leaking again.\n',
  '/drafts/ideas.txt': 'App ideas: plant watering reminder\n',
};

export const FILE_TOOLS_SUITE: Task[] = [
  {
    id: 'find-fact',
    title: 'Answer from a note',
    needsTools: true,
    files: NOTES,
    turns: ['What marketing budget did we agree on in my budget sync notes?'],
    check: (run) => replyMatches(run, /4,?200/),
  },
  {
    id: 'create-note',
    title: 'Create a file',
    needsTools: true,
    turns: ['Create a file called /shopping.md that lists milk, eggs and bread.'],
    check: (run) => fileMatches(run, '/shopping.md', /milk/i, /eggs/i, /bread/i),
  },
  {
    id: 'edit-todo',
    title: 'Edit a file in place',
    needsTools: true,
    files: { '/todo.md': NOTES['/todo.md'] },
    turns: ["In my todo list at /todo.md, mark 'Book dentist' as done."],
    check: (run) =>
      fileMatches(
        run,
        '/todo.md',
        /-\s*\[x\]\s*Book dentist/i,
        /-\s*\[ \]\s*Call mom/i,
        /-\s*\[ \]\s*Renew passport/i
      ),
  },
  {
    id: 'search-notes',
    title: 'Search across files',
    needsTools: true,
    files: NOTES,
    turns: ['Which of my files mention the dentist?'],
    check: (run) => all(replyMatches(run, /health\.md/i), replyMatches(run, /todo\.md/i)),
  },
  {
    id: 'count-markdown',
    title: 'Find files by pattern',
    needsTools: true,
    files: NOTES,
    turns: ['How many markdown (.md) files are in my workspace?'],
    check: (run) => replyMatches(run, /\b(4|four)\b/i),
  },
  {
    id: 'two-step-edit',
    title: 'Create, then extend a file over two turns',
    needsTools: true,
    turns: [
      'Save a note to /ideas.md saying: build a habit tracker app.',
      'Now add a second idea to that same file: a recipe scaler.',
    ],
    check: (run) => fileMatches(run, '/ideas.md', /habit tracker/i, /recipe scaler/i),
  },
  {
    id: 'capital-of-kenya',
    title: 'Ordinary question (no files needed)',
    needsTools: false,
    files: NOTES,
    turns: ['What is the capital of Kenya? Answer in one sentence.'],
    check: (run) => replyMatches(run, /nairobi/i),
  },
];
