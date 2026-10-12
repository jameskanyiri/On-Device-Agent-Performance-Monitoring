import type { Scenario } from '@/shared/protocol';

/**
 * Harness configurations to compare. `baseline` is the bare model; every other
 * scenario switches on agent pieces, and the report shows each one's impact
 * against the baseline. Add a scenario here when you add a harness flag.
 */
export const SCENARIOS: Scenario[] = [
  { id: 'baseline', label: 'Bare model', harness: { fileTools: false } },
  { id: 'file-tools', label: 'File tools', harness: { fileTools: true } },
];

export const BASELINE_ID = 'baseline';
