import type { Scenario } from '@/shared/protocol';

/**
 * Harness configurations to compare. `baseline` is the bare model; every other
 * scenario switches on agent pieces, and the report shows each one's impact
 * against the baseline. Add a scenario here when you add a harness flag.
 */
export const SCENARIOS: Scenario[] = [
  { id: 'baseline', label: 'Bare model', harness: { fileTools: false } },
  // Step 0, E0.4: does a system prompt alone change quality, and what does it cost?
  {
    id: 'prompt-short',
    label: 'Short system prompt',
    harness: { fileTools: false },
    systemPrompt: 'You are a helpful assistant. Answer accurately and concisely.',
  },
  {
    id: 'prompt-detailed',
    label: 'Detailed system prompt',
    harness: { fileTools: false },
    systemPrompt: [
      'You are a careful, helpful assistant running entirely on the user’s phone.',
      'Rules:',
      '- Answer accurately. If you are not sure, say so instead of guessing.',
      '- Follow format instructions exactly (number of items, word limits, JSON only when asked).',
      '- When the user gives you text, answer from that text and quote the relevant part.',
      '- For arithmetic, work it out step by step, then give the final number clearly.',
      '- You cannot see the user’s files or the internet. If asked about them, say you can’t see them.',
      '- Keep answers short unless the user asks for detail.',
    ].join('\n'),
  },
  { id: 'file-tools', label: 'File tools', harness: { fileTools: true } },
  // Step 2: the same tools plus the todo planning tool (the app's src/harness/planning.ts).
  { id: 'planning', label: 'File tools + planning', harness: { fileTools: true, planning: true } },
  // Step 3a: the same workspace through one bash tool (the app's src/harness/bash.ts) instead of the seven file tools.
  { id: 'bash', label: 'Bash tool', harness: { fileTools: false, bash: true } },
  { id: 'bash-planning', label: 'Bash tool + planning', harness: { fileTools: false, bash: true, planning: true } },
  // Step 3b: the same setups taught with one worked example per job (the app's src/harness/prompt.ts).
  { id: 'planning-examples', label: 'File tools + planning + examples', harness: { fileTools: true, planning: true, examples: true } },
  { id: 'bash-planning-examples', label: 'Bash tool + planning + examples', harness: { fileTools: false, bash: true, planning: true, examples: true } },
];

export const BASELINE_ID = 'baseline';
